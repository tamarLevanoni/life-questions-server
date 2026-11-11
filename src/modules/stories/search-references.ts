import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { normalizeSearchText } from './search-text';

type SourceCatalog = { id: string; name: string; kind: 'shas' | 'shu' };

type SourceReference = SourceCatalog & {
  number: number;
  subdivision?: number;
};

const SECTION_ALIASES: Record<string, string[]> = {
  'חושן משפט': ['חו"מ', 'חומ'],
  'אורח חיים': ['או"ח', 'אוח'],
  'יורה דעה': ['יו"ד', 'יוד'],
  'אבן העזר': ['אה"ע', 'אהע'],
};

const TRACTATE_ALIASES: Record<string, string[]> = {
  'בבא קמא': ['ב"ק', 'בק'],
  'בבא מציעא': ['ב"מ', 'במ'],
  'בבא בתרא': ['ב"ב', 'בב'],
  'מועד קטן': ['מו"ק', 'מוק'],
  'ראש השנה': ['ר"ה', 'רה'],
  'עבודה זרה': ['ע"ז', 'עז'],
};

const HEBREW_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400];
const HEBREW_NUMBERS = Object.fromEntries(
  [...'אבגדהוזחטיכלמנסעפצקרשת'].map((letter, index) => [letter, HEBREW_VALUES[index]]),
);
const NUMERAL = String.raw`(?:\d{1,4}|[א-ת](?:["']?[א-ת]){0,5}['"]?)`;
const SOURCE_END = String.raw`(?=$|[^\p{L}\p{N}])`;
const MAX_REFERENCES = 5;

function sourceText(text: string) {
  return text.normalize('NFC')
    .replace(/[\u0591-\u05BD\u05BF-\u05C2\u05C4\u05C5\u05C7]/g, '')
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text) || undefined;
  const letters = text.replace(/["']/g, '');
  const values = Array.from(letters, (letter) => HEBREW_NUMBERS[letter]);
  if (values.some((value, i) => !value || (i > 0 && value > values[i - 1]))) return undefined;
  return values.reduce((sum, value) => sum + value, 0) || undefined;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceNames(catalog: SourceCatalog): string[] {
  const aliases = catalog.kind === 'shu' ? SECTION_ALIASES : TRACTATE_ALIASES;
  return [catalog.name, ...(aliases[catalog.name] ?? [])];
}

function referenceMatches(text: string, catalog: SourceCatalog) {
  const names = sourceNames(catalog).map((name) => escapeRegex(sourceText(name))).join('|');
  const beginning = String.raw`(?<![\p{L}\p{N}])ו?[במל]?(?:${names})\s+`;
  const suffix = catalog.kind === 'shas'
    ? String.raw`(?:(דף)\s+)?(${NUMERAL})${SOURCE_END}(?:\s*(?:(?:עמוד\s+|ע(?:מ?["']?))([אב12])${SOURCE_END}|([.:])))?`
    : String.raw`(?:(סימן|סי['"]?)\s*)?(${NUMERAL})${SOURCE_END}(?:\s+ס(?:עיף\s+|["']\s*)(${NUMERAL})${SOURCE_END})?`;
  return Array.from(text.matchAll(new RegExp(beginning + suffix, 'giu'))).flatMap((match) => {
    const [, marker, numeral, subdivision, punctuation] = match;
    // Bare Hebrew numerals need citation punctuation or the end of the phrase.
    if (!marker && !subdivision && !punctuation && !/[0-9"']/.test(numeral)
      && /[\p{L}\p{N}]/u.test(text.slice(match.index + match[0].length))) return [];
    const number = parseNumber(numeral);
    if (!number) return [];
    const sub = punctuation ? (punctuation === ':' ? 2 : 1)
      : subdivision ? parseNumber(subdivision) : undefined;
    if (subdivision && !sub) return [];
    return [{ start: match.index, end: match.index + match[0].length, reference: {
      ...catalog, number, subdivision: sub,
    } }];
  });
}

export function parseSourceSearch(query: string, catalog: SourceCatalog[]) {
  const text = sourceText(query);
  const matches = catalog.flatMap((source) => referenceMatches(text, source))
    .sort((a, b) => b.start - a.start);
  const references: SourceReference[] = [];
  const seen = new Set<string>();
  let remainder = text;
  let nextMatchStart = text.length;
  for (const match of matches) {
    const { reference, start, end } = match;
    if (end > nextMatchStart) continue;
    const key = [reference.kind, reference.id, reference.number, reference.subdivision].join(':');
    if (!seen.has(key)) {
      if (references.length >= MAX_REFERENCES) continue;
      seen.add(key);
      references.push(reference);
    }
    remainder = remainder.slice(0, start) + ' ' + remainder.slice(end);
    nextMatchStart = start;
  }
  return { references, remainder: remainder.trim() };
}

export async function getSourceSearch(query: string) {
  if (!/\d|[א-ת]['״"׳][א-ת]|[א-ת]\s*$/.test(query) || !/\s/u.test(query)) {
    return { references: [], remainder: query };
  }
  const catalog = await prisma.$queryRaw<SourceCatalog[]>`
    SELECT id, name, 'shas' AS kind FROM masechtot
    UNION ALL
    SELECT id, name, 'shu' AS kind FROM shu_sections
  `;
  return parseSourceSearch(query, catalog);
}

type Coordinates = { number: number; subdivision?: number | null };

function structuredSources(ref: SourceReference) {
  return prisma.$queryRaw<({ id: string } & Coordinates)[]>(ref.kind === 'shas' ? Prisma.sql`
    SELECT link."storyId" AS id, page.daf AS number,
      CASE WHEN page.amud IN ('א', 'a', '1') THEN 1
        WHEN page.amud IN ('ב', 'b', '2') THEN 2 ELSE NULL END AS subdivision
    FROM story_to_shas link
    JOIN shas_pages page ON page.id = link."shasPageId"
    WHERE page."masechetId" = ${ref.id}
  ` : Prisma.sql`
    SELECT link."storyId" AS id, siman.siman AS number, link.seif AS subdivision
    FROM story_to_shu link
    JOIN shu_simanim siman ON siman.id = link."shuSimanId"
    WHERE siman."sectionId" = ${ref.id}
    UNION ALL
    SELECT s.id, siman.siman AS number, NULL AS subdivision
    FROM stories s
    JOIN shu_simanim siman ON siman.id = s."centralShuSimanId"
    WHERE siman."sectionId" = ${ref.id}
  `);
}

function matchesReference(candidate: Coordinates, ref: Coordinates) {
  return candidate.number === ref.number && (ref.subdivision == null || candidate.subdivision === ref.subdivision);
}

function contradictsSource(candidate: Coordinates, other: Coordinates) {
  return candidate.number !== other.number
    || (candidate.subdivision != null && other.subdivision != null && candidate.subdivision !== other.subdivision);
}

export async function findSourceStories(references: SourceReference[], indexVersion: string) {
  const matching = await Promise.all(references.map(async (ref) => {
    const anchors = [...new Set(sourceNames(ref).map(normalizeSearchText))];
    const anchorCondition = (value: Prisma.Sql) => Prisma.join(anchors.map(
      (anchor) => Prisma.sql`strpos(${value}, ${anchor}) > 0`,
    ), ' OR ');
    const [structured, textRows] = await Promise.all([
      structuredSources(ref),
      prisma.$queryRaw<{ id: string; content: string; kind: 'catalog' | 'expansion' }[]>(Prisma.sql`
        SELECT id, "sourceReferencesText" AS content, 'catalog' AS kind
        FROM stories
        WHERE "sourceReferencesText" IS NOT NULL
          AND (${anchorCondition(Prisma.sql`normalize_story_search_text("sourceReferencesText")`)})
        UNION ALL
        SELECT story_id AS id, content, 'expansion' AS kind
        FROM story_search_documents
        WHERE index_version = ${indexVersion} AND kind = 'expansion'
          AND (${anchorCondition(Prisma.sql`normalize_story_search_text(content)`)})
      `),
    ]);
    const coordinatesByStory = new Map<string, Coordinates[]>();
    const matches = new Set<string>();
    for (const row of structured) {
      const coordinates = coordinatesByStory.get(row.id) ?? [];
      coordinates.push(row);
      coordinatesByStory.set(row.id, coordinates);
      if (matchesReference(row, ref)) matches.add(row.id);
    }
    const conflicts = new Set<string>();
    for (const { id, content, kind } of textRows) {
      const parsed = referenceMatches(sourceText(content), ref).map(({ reference }) => reference);
      if (parsed.some((coordinates) => matchesReference(coordinates, ref))) matches.add(id);
      const linked = coordinatesByStory.get(id);
      // An expansion can cite more than one passage from the same work. Treat
      // incompatible, single-coordinate catalog metadata as the conflict.
      if (kind === 'catalog' && parsed.length === 1 && linked
        && new Set(linked.map(({ number }) => number)).size === 1
        && linked.every((coordinates) => contradictsSource(coordinates, parsed[0]))) conflicts.add(id);
    }
    return new Set([...matches].filter((id) => !conflicts.has(id)));
  }));
  return [...(matching[0] ?? [])].filter((id) => matching.every((ids) => ids.has(id)));
}
