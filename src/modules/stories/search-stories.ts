import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { storyFilterGroups } from './story-filters';
import { storyCardInclude, storyCardOmit, storyOrder } from './stories.queries';
import { findSourceTiers, findWorkStories, getSourceSearch } from './search-references';
import type { SourceReference } from './source-reference-parser';
import { catalogSearch, findSimilarTitles, queryWords, rankStoryCandidates } from './search-retrieval';
import { readResultSet, saveResultSet, SearchPageError, type SearchResultSet } from './search-result-sets';
import { SEARCH_PAGE_SIZE, type CursorSearchInput, type CursorStoriesPage } from './stories.validators';

type Start = Exclude<CursorSearchInput, { cursor: unknown }>;
type Metadata = CursorStoriesPage['searchMeta'];
type Selection = Pick<SearchResultSet, 'ids' | 'metadata'>;
type SourceLevel = NonNullable<Metadata['sourceMatch']>;

/** מסיר מזהים כפולים תוך שמירה על הסדר, ומגדיר את סטטוס החיפוש שיוחזר ללקוח. */
function finish(ids: string[], metadata?: Partial<Metadata>): Selection {
  return { ids: [...new Set(ids)], metadata: {
    status: ids.length ? 'complete' : 'no_useful_match', matches: {}, ...metadata,
  } };
}

/** קובע מה יוצג ליד כל תוצאה לפי רמת הדיוק של ההפניה שנמצאה. */
function sourceMetadata(level: SourceLevel, ids: string[]): Metadata['matches'] {
  return Object.fromEntries(ids.map((id) => [id, level === 'exact'
    ? { matchType: 'direct', reasonCode: 'source_match' }
    : { matchType: 'close', reasonCode: 'nearby_source' },
  ]));
}

/** מחזיר את הסיפורים מטווח המקור הראשון שבו נמצאו התאמות במסגרת המסננים. */
async function searchBySource(references: SourceReference[], filteredIds?: string[]): Promise<Selection | undefined> {
  if (!references.length) return;
  const tiers = await findSourceTiers(references);

  // בלי מסננים, קוראים מהקטלוג רק את המזהים שנמצאו לפי המקור כדי לקבל את סדר הספרים.
  let orderedIds = filteredIds;
  if (orderedIds === undefined) {
    const candidateIds = [...new Set(tiers.flatMap(({ counts }) => [...counts.keys()]))];
    if (!candidateIds.length) return finish([], { sourceMatch: 'exact' });
    orderedIds = await selectStoryIds({ id: { in: candidateIds } });
  }

  for (const { level, counts } of tiers) {
    // בטווח שנבחר, מקדימים סיפורים שמתאימים ליותר הפניות מהשאילתה.
    const ids = orderedIds.filter((id) => counts.has(id))
      .sort((a, b) => counts.get(b)! - counts.get(a)!);
    if (ids.length) return finish(ids, { sourceMatch: level, matches: sourceMetadata(level, ids) });
  }
  return finish([], { sourceMatch: 'exact' });
}

/** מציג התאמות למקור ולתוכן יחד תחילה, אחריהן התאמות למקור בלבד ולבסוף התאמות לתוכן בלבד. */
function combineSourceAndContent(source: Selection, content: Selection): Selection {
  const sourceIds = new Set(source.ids);
  const matchingBoth = content.ids.filter((id) => sourceIds.has(id));
  return finish([...matchingBoth, ...source.ids, ...content.ids], {
    sourceMatch: source.ids.length ? source.metadata.sourceMatch : undefined,
    matches: { ...content.metadata.matches, ...source.metadata.matches },
    ...(content.metadata.status === 'partial' && { status: 'partial' as const }),
  });
}

/** טוען רק את המזהים שעומדים במסננים, לפי הסדר בספרים. */
async function selectStoryIds(scope: Prisma.StoryWhereInput): Promise<string[]> {
  const rows = await prisma.story.findMany({ where: scope, orderBy: storyOrder, select: { id: true } });
  return rows.map(({ id }) => id);
}

/** מחפש לפי הטקסט שנשאר, או לפי השאילתה המלאה אם לא זוהתה הפניה. */
async function searchRemainingText(
  text: string,
  { signal, hasReferences, filteredIds }: {
    signal: AbortSignal;
    hasReferences: boolean;
    filteredIds?: string[];
  },
): Promise<Selection | undefined> {
  if (!text) return;

  // בודקים את הטקסט מול הכותרות, הנושאים ושמות הספרים. התאמה מדויקת מחזירה את כל הסיפורים התואמים.
  const catalog = await catalogSearch(text, filteredIds);
  const exactMatches = catalog.filter(({ exactRank }) => exactRank != null);
  if (exactMatches.length) return finish(exactMatches.map(({ id }) => id));

  // בלי מילות חיפוש, אין תוצאות נוספות מעבר להתאמות שכבר נבדקו בקטלוג.
  if (!queryWords(text).length) return finish([]);

  // משתמשים שוב בהתאמות מהמסד ומוסיפים כותרות דומות שלא הופיעו בהן.
  const catalogIds = new Set(catalog.map(({ id }) => id));
  const similarTitles = await findSimilarTitles(text, filteredIds);
  const catalogHits = [...catalog, ...similarTitles.filter(({ id }) => !catalogIds.has(id))];

  signal.throwIfAborted();
  const { rankedIds, providerFailures } = await rankStoryCandidates(
    text, { signal, rewrite: !hasReferences }, { allowed: filteredIds, catalog: catalogHits, limit: 60 },
  );
  // אם נראה בשימוש שהתוצאות אינן מספיק רלוונטיות, אפשר להוסיף כאן אימות של המועמדים.
  return finish(rankedIds, providerFailures.length ? { status: 'partial' } : undefined);
}

/** מפריד מקור מטקסט, מפעיל את החיפושים ומאחד את התוצאות לפי סדר התצוגה. */
async function selectStories(params: Start, signal: AbortSignal): Promise<Selection> {
  const { q } = params;
  const filterGroups = storyFilterGroups(params);
  const filterScope = filterGroups.length ? { AND: filterGroups } : undefined;

  // טוענים מזהים רק כשנבחרו מסננים. בחיפוש בלי טקסט מחזירים אותם לפי סדר הספרים.
  const filteredIds = filterScope ? await selectStoryIds(filterScope) : undefined;
  // אם המסננים לא השאירו אף סיפור, אין טעם לפענח את ההפניה או לחפש לפי הטקסט.
  if (filteredIds?.length === 0) return finish([]);

  if (!q) return finish(filteredIds ?? []);


  // למשל, בחיפוש „בבא מציעא דף כ״א — מצאתי ארנק”, הדף משמש לחיפוש לפי מקור והמילים על הארנק לחיפוש לפי תוכן.
  const { references, works, remainder } = await getSourceSearch(q);
  if (works.length) {
    const [preferred, content] = await Promise.all([
      findWorkStories(works),
      searchRemainingText(remainder, { signal, hasReferences: true, filteredIds }),
    ]);
    if (!content) {
      const candidates = [...preferred];
      const ids = filteredIds
        ? filteredIds.filter((id) => preferred.has(id))
        : candidates.length ? await selectStoryIds({ id: { in: candidates } }) : [];
      return finish(ids, { sourceMatch: 'exact', matches: sourceMetadata('exact', ids) });
    }

    // התאמה למקור מקדמת תוצאה קיימת בלי להוסיף סיפורים שאין בהם התאמה לתוכן.
    const positions = content.ids.map((id, rank) => ({ id, rank: rank - (preferred.has(id) ? SEARCH_PAGE_SIZE : 0) }));
    return { ...content, ids: positions.sort((a, b) => a.rank - b.rank).map(({ id }) => id) };
  }
  const hasReferences = references.length > 0;

  // מעבירים לכל חיפוש את החלק שלו. כשנמצאו גם הפניה וגם מילות חיפוש, שני החיפושים רצים במקביל.
  const [bySource, byContent] = await Promise.all([
    searchBySource(references, filteredIds),
    searchRemainingText(remainder, { signal, hasReferences, filteredIds }),
  ]);
  if (bySource && byContent) return combineSourceAndContent(bySource, byContent);
  return bySource ?? byContent ?? finish([]);
}

/** טוען כרטיסים ציבוריים עבור חלון אחד ומשחזר את סדר הדירוג לפי רשימת המזהים. */
async function pageFrom(result: Omit<SearchResultSet, 'expiresAt'>, resultSetId: string | undefined, offset: number) {
  const nextOffset = offset + SEARCH_PAGE_SIZE;
  const window = result.ids.slice(offset, nextOffset);
  const rows = window.length ? await prisma.story.findMany({
    where: { id: { in: window } }, include: storyCardInclude, omit: storyCardOmit,
  }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const stories = window.flatMap((id) => byId.get(id) ?? []);
  const matches = Object.fromEntries(stories.flatMap(({ id }) =>
    result.metadata.matches[id] ? [[id, result.metadata.matches[id]]] : [],
  ));
  return {
    stories, total: result.ids.length, pageSize: SEARCH_PAGE_SIZE,
    nextCursor: resultSetId && nextOffset < result.ids.length ? { resultSetId, offset: nextOffset } : null,
    searchMeta: { ...result.metadata, matches },
  } satisfies CursorStoriesPage;
}

/** פותח חיפוש ושומר את סדר התוצאות כשיש עוד עמודים, או ממשיך חיפוש קיים באמצעות סמן. */
export async function searchStoryCards(params: CursorSearchInput, account: string, signal: AbortSignal) {
  // המשך עימוד קורא את הרשימה שנשמרה לחשבון ומדלג על האחזור והדירוג.
  if ('cursor' in params) {
    const { resultSetId, offset } = params.cursor;
    const result = await readResultSet(resultSetId, account);
    if (offset >= result.ids.length || offset % SEARCH_PAGE_SIZE !== 0) throw new SearchPageError(422, 'invalid_search_cursor');
    return pageFrom(result, resultSetId, offset);
  }
  const selection = await selectStories(params, signal);
  signal.throwIfAborted();
  const result = { ...selection, account };
  const resultSetId = result.ids.length > SEARCH_PAGE_SIZE ? await saveResultSet(result) : undefined;
  return pageFrom(result, resultSetId, 0);
}
