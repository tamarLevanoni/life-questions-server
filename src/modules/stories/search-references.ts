import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import contract from './search-index-contract.json';
import { normalizeSearchText } from './search-text';

import {
  parseSourceCitations, parseSourceSearch, SECTION_CONTEXT_NAMES, sourceNames,
  type SourceCatalog, type SourceReference,
} from './source-reference-parser';

/** טוען את שמות המקורות הדרושים לפענוח ומפריד את ההפניות מהטקסט לפני שמחפשים סיפורים. */
export async function getSourceSearch(query: string) {
  if (!/[א-ת]/u.test(query)) {
    return { references: [], works: [], remainder: query };
  }
  const catalog = await prisma.$queryRaw<SourceCatalog[]>`
    SELECT id, name, 'shas' AS kind FROM masechtot
    UNION ALL
    SELECT id, name, 'shu' AS kind FROM shu_sections
  `;
  return parseSourceSearch(query, catalog);
}

type Coordinates = { number: number; subdivision?: number | null };

/** קורא את הקישורים המובנים של המקרים ליחידות בחיבור, כולל מקור מרכזי כשיש כזה. */
function structuredSources(ref: SourceCatalog) {
  return prisma.$queryRaw<({ id: string; primary?: boolean } & Coordinates)[]>(ref.kind === 'shas' ? Prisma.sql`
    SELECT link."storyId" AS id, page.daf AS number,
      CASE WHEN page.amud IN ('א', 'a', '1') THEN 1
        WHEN page.amud IN ('ב', 'b', '2') THEN 2 ELSE NULL END AS subdivision
    FROM story_to_shas link
    JOIN shas_pages page ON page.id = link."shasPageId"
    WHERE page."masechetId" = ${ref.id}
  ` : Prisma.sql`
    SELECT link."storyId" AS id, siman.siman AS number, link.seif AS subdivision, FALSE AS primary
    FROM story_to_shu link
    JOIN shu_simanim siman ON siman.id = link."shuSimanId"
    WHERE siman."sectionId" = ${ref.id}
    UNION ALL
    SELECT s.id, siman.siman AS number, NULL AS subdivision, TRUE AS primary
    FROM stories s
    JOIN shu_simanim siman ON siman.id = s."centralShuSimanId"
    WHERE siman."sectionId" = ${ref.id}
  `);
}

/** בודק התאמה למספר היחידה, ודורש גם התאמה לתת־היחידה אם צוינה. */
function matchesReference(candidate: Coordinates, ref: Coordinates) {
  return candidate.number === ref.number && (ref.subdivision == null || candidate.subdivision === ref.subdivision);
}

/** מזהה מספרי יחידה שונים או תתי־יחידה שונים כששניהם ידועים. */
function contradictsSource(candidate: Coordinates, other: Coordinates) {
  return candidate.number !== other.number
    || (candidate.subdivision != null && other.subdivision != null && candidate.subdivision !== other.subdivision);
}

/** אוסף לפי מזהה מקרה את הקישורים המובנים ואת ההפניות שבטקסט הקטלוג או ההרחבה. */
async function loadSourceEvidence(ref: SourceCatalog) {
  const anchors = [...new Set(sourceNames(ref).map(normalizeSearchText))];
  /** בונה תנאי מקדים שמחפש את שמות המקור בטקסט לפני ניתוח ההפניה המלאה. */
  const anchorCondition = (value: Prisma.Sql, terms = anchors) => Prisma.join(terms.map(
    (anchor) => Prisma.sql`strpos(${value}, ${anchor}) > 0`,
  ), ' OR ');
  /** מאפשר לזהות אזכור כללי כשהמקור המרכזי של המקרה קובע את החלק שאליו הוא שייך. */
  const inSectionContext = (id: Prisma.Sql, text: Prisma.Sql) => ref.kind === 'shu'
    ? Prisma.sql`OR (EXISTS (
        SELECT 1 FROM stories owner JOIN shu_simanim main ON main.id = owner."centralShuSimanId"
        WHERE owner.id = ${id} AND main."sectionId" = ${ref.id}
      ) AND (${anchorCondition(text, SECTION_CONTEXT_NAMES.map(normalizeSearchText))}))`
    : Prisma.empty;
  const expansionRows = Prisma.sql`SELECT story_id AS id, content, 'expansion' AS kind
    FROM story_search_documents d
    WHERE index_version = ${contract.indexId} AND kind = 'expansion'
      AND (${anchorCondition(Prisma.sql`normalize_story_search_text(content)`)}
      ${inSectionContext(Prisma.sql`d.story_id`, Prisma.sql`normalize_story_search_text(content)`)})`;
  const [structured, textRows] = await Promise.all([
    structuredSources(ref),
    prisma.$queryRaw<{ id: string; content: string; kind: 'catalog' | 'expansion' }[]>(Prisma.sql`
      SELECT id, "sourceReferencesText" AS content, 'catalog' AS kind
      FROM stories
      WHERE "sourceReferencesText" IS NOT NULL
        AND (${anchorCondition(Prisma.sql`normalize_story_search_text("sourceReferencesText")`)})
      UNION ALL
      ${expansionRows}
    `),
  ]);
  const coordinatesByStory = new Map<string, Coordinates[]>();
  for (const row of structured) {
    const coordinates = coordinatesByStory.get(row.id) ?? [];
    coordinates.push(row);
    coordinatesByStory.set(row.id, coordinates);
  }
  const primary = new Set(structured.filter((row) => row.primary).map(({ id }) => id));
  const citations = new Map<string, Coordinates[]>();
  const catalogCitations = new Map<string, Coordinates[]>();
  for (const { id, content, kind } of textRows) {
    const parsed = parseSourceCitations(content, ref, primary.has(id));
    if (parsed.length) citations.set(id, [...(citations.get(id) ?? []), ...parsed]);
    if (kind === 'catalog' && parsed.length) catalogCitations.set(id, parsed);
  }
  return { linked: coordinatesByStory, citations, catalogCitations };
}

type SourceEvidence = Awaited<ReturnType<typeof loadSourceEvidence>>;

/** מקבל ראיה תואמת מהטקסט או מקישור מובנה, ובודק אם אזכור יחיד בקטלוג סותר את הקישור. */
function sourceMatches(evidence: SourceEvidence, ref: SourceReference) {
  const matches = new Set<string>();
  for (const [id, coordinates] of evidence.citations) {
    if (coordinates.some((coordinate) => matchesReference(coordinate, ref))) matches.add(id);
  }
  for (const [id, linked] of evidence.linked) {
    if (!linked.some((coordinate) => matchesReference(coordinate, ref))) continue;
    const catalog = evidence.catalogCitations.get(id);
    if (catalog?.length === 1 && new Set(linked.map(({ number }) => number)).size === 1
        && linked.every((coordinate) => contradictsSource(coordinate, catalog[0]))) continue;
    matches.add(id);
  }
  return matches;
}

/** מגדיר שלוש רמות לפי הסדר, מההפניה עצמה ליחידה בשלמותה וליחידות שלפניה ואחריה. */
function sourceTiers(references: SourceReference[]) {
  return [
    { level: 'exact', refs: references },
    { level: 'same_location', refs: references.filter((ref) => ref.subdivision !== undefined)
      .map((ref) => ({ ...ref, subdivision: undefined })) },
    { level: 'nearby', refs: references.flatMap((ref) => [ref.number - 1, ref.number + 1]
      .filter((number) => number >= (ref.kind === 'shas' ? 2 : 1))
      .map((number) => ({ ...ref, number, subdivision: undefined }))) },
  ] as const;
}

/** טוען ראיות פעם אחת לכל חיבור וסופר לכל מקרה כמה הפניות הוא מקיים בכל רמה. */
export async function findSourceTiers(references: SourceReference[]) {
  const works = new Map(references.map((ref) => [ref.id, ref]));
  const evidence = new Map(await Promise.all([...works].map(async ([id, ref]) => [
    id, await loadSourceEvidence(ref),
  ] as const)));
  return sourceTiers(references).map(({ level, refs }) => {
    const counts = new Map<string, number>();
    const keys = new Set<string>();
    for (const ref of refs) {
      const key = [ref.id, ref.number, ref.subdivision].join(':');
      if (keys.has(key)) continue;
      keys.add(key);
      for (const id of sourceMatches(evidence.get(ref.id)!, ref)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return { level, counts };
  });
}

/** מחזיר סיפורים עם קישור או ציטוט מכל מקום במקורות שנמצאו. */
export async function findWorkStories(works: SourceCatalog[]) {
  const evidence = await Promise.all(works.map(loadSourceEvidence));
  return new Set(evidence.flatMap(({ linked, citations }) => [...linked.keys(), ...citations.keys()]));
}
