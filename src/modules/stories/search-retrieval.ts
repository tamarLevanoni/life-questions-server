import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  embedSearchInputs, rewriteSearchQuery,
} from '../../lib/search-ai';
import { Sentry } from '../../lib/sentry';
import contract from './search-index-contract.json';
import { storyOrder } from './stories.queries';
import { normalizeSearchText } from './search-text';

const PROVIDER_TIMEOUT_MS = { embedding: 5_800, rewrite: 5_000 };
const MAX_VECTOR_DISTANCE = 0.6;
const RRF_OFFSET = 60;
const PHRASE_SAMPLE_SIZE = 10;
const TOPIC_ALIASES: Record<string, string> = {
  'השבת אבידה': 'הלכות אבידה ומציאה',
  'השבת אבדה': 'הלכות אבידה ומציאה',
};
const SEARCH_WORDS = new Set([
  'סיפור', 'סיפורים', 'מקרה', 'מקרים', 'מחפש', 'מחפשת', 'תן', 'תני', 'תביא', 'תביאי',
  'אני', 'לי', 'יש', 'על', 'של', 'עם', 'את', 'או', 'אם', 'מה', 'מי', 'איך', 'האם',
  'שאלה', 'בנושא', 'לכיתה', 'לשיעור', 'דוגמה', 'דוגמא', 'למשל', 'מסכת', 'מקור', 'מקורות',
  'מתוך', 'לפי',
]);

type SearchOptions = {
  rewrite?: boolean;
  signal: AbortSignal;
};

type RankedDocument = { id: string; kind: string; part: number };
type LexicalHit = RankedDocument & { score: number };
type VectorHit = RankedDocument & { distance: number };
type CatalogHit = { id: string; strength: number };
type CatalogMatch = CatalogHit & { exactRank: 1 | 2 | null };
type ProviderStep = 'embedding' | 'rewrite';

/** מחלץ מונחי אחזור ייחודיים מהטקסט המנורמל ומסיר מילים שכיחות לפי רשימה קבועה. */
export function queryWords(query: string): string[] {
  return [...new Set(normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => !SEARCH_WORDS.has(word)).slice(0, 48);
}

/** חיפוש ללא טווח שסופק סורק את כל האינדקס. רשימה ריקה מייצגת טווח ללא מועמדים. */
function inSources(column: Prisma.Sql, allowed: string[] | undefined) {
  if (allowed === undefined) return Prisma.empty;
  if (allowed.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${column} IN (${Prisma.join(allowed)})`;
}

/** מחזיר סיפורים שהתאימו לקטלוג, עם התאמות מדויקות בראש הרשימה לפי סדר הספרים. */
export async function catalogSearch(query: string, allowed: string[] | undefined) {
  const normalized = normalizeSearchText(query);
  if (!normalized || allowed?.length === 0) return [];

  const terms = queryWords(query).join(' ');
  const topicName = TOPIC_ALIASES[normalized] ?? normalized;

  return prisma.$queryRaw<CatalogMatch[]>(Prisma.sql`
    WITH catalog AS (
      SELECT s.id, b."orderIndex" AS book_order, s."storyOrder" AS story_order,
        normalize_story_search_text(s.title) AS title,
        normalize_story_search_text(t.name) AS topic,
        normalize_story_search_text(b.name) AS book,
        s."sourceReferencesText" AS source_text,
        s."conceptsFromIndex" || s."keywordsFromIndex" || s."conceptsAi" || s."keywordsAi" AS tags
      FROM stories s
      JOIN topics t ON t.id = s."topicId"
      JOIN books b ON b.id = s."bookId"
      WHERE TRUE ${inSources(Prisma.sql`s.id`, allowed)}
    ), matches AS (
      SELECT id, book_order, story_order,
        CASE
          WHEN title = ${normalized} THEN 1
          WHEN topic = ${topicName} OR book = ${normalized} THEN 2
        END AS exact_rank,
        CASE
          WHEN title = ${normalized} THEN 4
          WHEN topic = ${topicName} OR topic = ${normalized} OR book = ${normalized}
            OR (length(${terms}) >= 2 AND (topic = ${terms} OR book = ${terms})) THEN 3
          WHEN length(${normalized}) >= 2 AND strpos(title, ${normalized}) > 0 THEN 2
          WHEN length(${normalized}) >= 2 AND (
            strpos(topic, ${normalized}) > 0
            OR strpos(book, ${normalized}) > 0
            OR strpos(normalize_story_search_text(coalesce(source_text, '')), ${normalized}) > 0
            OR EXISTS (
              SELECT 1 FROM unnest(tags) AS term
              WHERE normalize_story_search_text(term) = ${normalized}
            )
          ) THEN 1
          ELSE 0
        END AS strength
      FROM catalog
    )
    SELECT id, strength, exact_rank AS "exactRank"
    FROM matches
    WHERE strength > 0
    ORDER BY exact_rank NULLS LAST,
      CASE WHEN exact_rank IS NOT NULL THEN book_order END,
      CASE WHEN exact_rank IS NOT NULL THEN story_order END,
      CASE WHEN exact_rank IS NOT NULL THEN id END,
      strength DESC, id
  `);
}

/** מחלק כותרת לרצפים של שלושה תווים כדי להשוות גם כותרות עם שגיאת הקלדה. */
function trigrams(value: string) {
  const padded = `  ${value} `;
  return new Set(Array.from({ length: padded.length - 2 }, (_, i) => padded.slice(i, i + 3)));
}

/** מודד איזה חלק מהרצפים משותף לשאילתה ולכותרת, ביחס לאורך שתיהן. */
function fuzzyTitleScore(needle: Set<string>, title: string) {
  const words = trigrams(title);
  let shared = 0;
  for (const gram of needle) if (words.has(gram)) shared++;
  return (2 * shared) / (needle.size + words.size);
}

/** מחפש כותרות דומות אחרי שבדיקת הקטלוג לא מצאה התאמה מדויקת. */
export async function findSimilarTitles(query: string, allowed?: string[]): Promise<CatalogHit[]> {
  const normalized = normalizeSearchText(query);
  // בודקים רק שאילתות עם לפחות שישה תווים ועד שש מילות חיפוש אחרי הסרת מילים שכיחות.
  if (normalized.length < 6 || queryWords(query).length > 6) return [];

  const rows = await prisma.story.findMany({
    where: allowed ? { id: { in: allowed } } : undefined,
    orderBy: storyOrder,
    select: { id: true, title: true },
  });

  // משווים רצפים חופפים של שלושה תווים ושומרים עד עשר כותרות עם ציון דמיון של 0.65 ומעלה.
  const grams = trigrams(normalized);
  return rows.map(({ id, title }) => ({ id, score: fuzzyTitleScore(grams, normalizeSearchText(title)) }))
    .filter(({ score }) => score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ id }) => ({ id, strength: 2 }));
}

/** מגביל את הזמן של כל קריאת ספק ומאפשר לבקשת החיפוש לבטל אותה מוקדם יותר. */
function providerSignal(signal: AbortSignal, step: ProviderStep) {
  return AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS[step])]);
}

/** מדרג מסמכים באינדקס לפי חפיפת מילים ומחזיר את החלק הטוב ביותר לכל מקרה וסוג מסמך. */
async function lexicalSearch(
  words: string[],
  limit: number,
  allowed: string[] | undefined,
) {
  if (words.length === 0) return [];
  // The parser above allows letters and digits only. The database still receives the terms as parameters.
  const anyWords = words.join(' | ');
  const allWords = words.join(' ');
  const minimumMatches = words.length <= 2 ? words.length : Math.max(2, Math.ceil(words.length / 4));
  return prisma.$queryRaw<LexicalHit[]>(Prisma.sql`
    WITH query AS (
      SELECT to_tsquery('simple', ${anyWords}) AS any_words,
        plainto_tsquery('simple', ${allWords}) AS all_words
    ), best AS (
      SELECT DISTINCT ON (d.story_id, d.kind)
        d.story_id AS id, d.kind, d.part,
        ts_rank_cd(d.search_vector, q.any_words, 32)
          + CASE WHEN d.search_vector @@ q.all_words THEN 1 ELSE 0 END AS score
      FROM story_search_documents d
      CROSS JOIN query q
      WHERE d.index_version = ${contract.indexId}
        AND d.kind <> 'combined'
        AND d.search_vector @@ q.any_words
        AND (SELECT count(*) FROM unnest(tsvector_to_array(to_tsvector('simple', ${allWords}))) AS term
          WHERE term = ANY(tsvector_to_array(d.search_vector))) >= ${minimumMatches}
        ${inSources(Prisma.sql`d.story_id`, allowed)}
      ORDER BY d.story_id, d.kind, score DESC, d.part
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY kind ORDER BY score DESC, id) AS rank FROM best
    )
    SELECT id, kind, part, score FROM ranked WHERE rank <= ${limit} ORDER BY kind, rank
  `);
}

/** מאתר את חלקי המסמכים הקרובים לשאילתה לפי מרחק קוסינוס, באינדקס הסיפורים ובמודל ששימש לבנייתו. */
async function vectorSearch(
  vector: number[],
  limit: number,
  allowed: string[] | undefined,
) {
  const literal = `[${vector.join(',')}]`;
  return prisma.$queryRaw<VectorHit[]>(Prisma.sql`
    WITH best AS (
      SELECT DISTINCT ON (d.story_id, d.kind) d.story_id AS id, d.kind, d.part,
        d.embedding <=> ${literal}::vector AS distance
      FROM story_search_documents d
      WHERE d.index_version = ${contract.indexId}
        AND d.embedding_model = ${contract.embeddingModel}
        AND d.embedding IS NOT NULL
        ${inSources(Prisma.sql`d.story_id`, allowed)}
      ORDER BY d.story_id, d.kind, distance, d.part
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY kind ORDER BY distance, id) AS rank FROM best
    )
    SELECT id, kind, part, distance FROM ranked WHERE rank <= ${limit} ORDER BY kind, rank
  `);
}

/** מדווח על שלב האחזור שנכשל ומדפיס פרטי אבחון בפיתוח מקומי. */
function recordProviderFailure(step: ProviderStep, error: unknown, signal: AbortSignal) {
  Sentry.captureMessage(`Story search ${step} unavailable`, {
    level: 'warning', tags: { feature: 'story-search', step },
  });

  if ((process.env.NODE_ENV ?? 'development') === 'development') {
    const timedOut = signal.aborted && signal.reason?.name === 'TimeoutError';
    console.warn('[story search] OpenAI request failed', {
      step,
      reason: timedOut ? 'timeout' : signal.aborted ? 'request_aborted' : 'provider_error',
      timeoutMs: PROVIDER_TIMEOUT_MS[step],
      errorName: error instanceof Error ? error.name : undefined,
      httpStatus: error instanceof Error && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined,
    });
  }
}

/** ממיר את השאילתה לווקטור ומאחזר באמצעותו מועמדים. כשל בהטמעה משאיר את האחזור המילולי זמין. */
async function getSemanticMatches(
  query: string,
  limit: number,
  allowed: string[] | undefined,
  options: SearchOptions,
) {
  const signal = providerSignal(options.signal, 'embedding');
  let embedding;
  try {
    embedding = await embedSearchInputs([query], signal);
  } catch (error) {
    recordProviderFailure('embedding', error, signal);
    return { hits: [], available: false };
  }
  return {
    hits: await vectorSearch(embedding.vectors[0], limit, allowed),
    available: true,
  };
}

/** מאחד רשימות לפי המיקום בכל ערוץ ומשקלו, כי הציונים הגולמיים נמדדים בסולמות שונים. */
function fuse(
  catalog: CatalogHit[],
  lexical: LexicalHit[],
  semantic: VectorHit[],
  rewritten: VectorHit[],
) {
  const score = new Map<string, number>();
  for (const [matches, weight] of [
    [catalog.map((hit) => ({ ...hit, kind: 'catalog' })), 1.35],
    [lexical, 1.1],
    [semantic, 1],
    [rewritten, 0.6],
  ] as const) {
    const channelRanks = new Map<string, number>();
    for (const { id, kind } of matches) {
      const rank = (channelRanks.get(kind) ?? 0) + 1;
      channelRanks.set(kind, rank);
      const kindWeight = kind === 'expansion' ? 0.85 : 1;
      score.set(id, (score.get(id) ?? 0) + weight * kindWeight / (RRF_OFFSET + rank));
    }
  }
  return Array.from(score.keys()).sort((a, b) => score.get(b)! - score.get(a)! || a.localeCompare(b));
}

/** מצמצם תוצאות חלשות כשביטוי מהשאילתה חוזר ברוב התוצאות הראשונות. */
async function focusOnSharedPhrase(ranked: string[], words: string[], semantic: VectorHit[]) {
  if (words.length < 4 || ranked.length <= PHRASE_SAMPLE_SIZE) return ranked;
  const phrases = words.slice(1).map((word, index) => words[index] + ' ' + word);
  const leadingIds = new Set(ranked.slice(0, PHRASE_SAMPLE_SIZE));
  const closeIds = new Set(semantic.map(({ id }) => id));

  const rows = await prisma.$queryRaw<{ id: string; phrase: string; hasAnotherTerm: boolean }[]>(Prisma.sql`
    WITH phrases AS (
      SELECT phrase, phraseto_tsquery('simple', phrase) AS query
      FROM unnest(ARRAY[${Prisma.join(phrases)}]::text[]) AS inputs(phrase)
    )
    SELECT d.story_id AS id, p.phrase,
      bool_or((SELECT count(*) FROM unnest(tsvector_to_array(d.search_vector)) AS terms(term)
        WHERE term IN (${Prisma.join(words)})) > 2) AS "hasAnotherTerm"
    FROM story_search_documents d
    JOIN phrases p ON d.search_vector @@ p.query
    WHERE d.index_version = ${contract.indexId} AND d.kind <> 'combined'
      AND d.story_id IN (${Prisma.join(ranked)})
    GROUP BY d.story_id, p.phrase
  `);
  const storyIdsByPhrase = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const { id, phrase, hasAnotherTerm } of rows) {
    if (!hasAnotherTerm && !closeIds.has(id)) continue;
    const ids = storyIdsByPhrase.get(phrase) ?? new Set<string>();
    ids.add(id);
    storyIdsByPhrase.set(phrase, ids);
    if (leadingIds.has(id)) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const strongest = phrases.reduce((best, phrase) =>
    (counts.get(phrase) ?? 0) > (counts.get(best) ?? 0) ? phrase : best, phrases[0]);
  if ((counts.get(strongest) ?? 0) <= PHRASE_SAMPLE_SIZE / 2) return ranked;
  const focusedIds = storyIdsByPhrase.get(strongest)!;
  return ranked.filter((id) => focusedIds.has(id));
}

/** משלב אחזור מילולי וסמנטי בתוך הטווח הנתון ומסנן לפי חוזק ההתאמה לפני הדירוג הסופי. */
export async function rankStoryCandidates(
  retrievalQuery: string,
  options: SearchOptions,
  scope: {
    allowed: string[] | undefined;
    catalog: CatalogHit[];
    limit: number;
  },
) {
  const { allowed, catalog, limit } = scope;
  const providerFailures: ProviderStep[] = [];
  const words = queryWords(retrievalQuery);
  // מפעילים את הערוצים במקביל כדי שהשלב המילולי יתקדם גם בזמן חישוב ההטמעה.
  const [originalLexical, semantic] = await Promise.all([
    lexicalSearch(words, limit, allowed),
    getSemanticMatches(retrievalQuery, limit, allowed, options),
  ]);
  let lexical = originalLexical;
  if (!semantic.available) providerFailures.push('embedding');
  const catalogHits = allowed ? catalog.filter(({ id }) => allowed.includes(id)) : catalog;
  const semanticHits = semantic.hits.filter(({ distance }) => distance <= MAX_VECTOR_DISTANCE);
  let rewrittenHits: VectorHit[] = [];
  const initialAcceptable = new Set([
    ...catalogHits, ...lexical, ...semanticHits,
  ].map(({ id }) => id));
  // מנסים ניסוח נוסף כשיש מעט מועמדים שעברו את סף ההתאמה.
  if (options.rewrite && initialAcceptable.size < 3 && words.length > 0 && !options.signal.aborted) {
    const signal = providerSignal(options.signal, 'rewrite');
    const rewrite = await rewriteSearchQuery(retrievalQuery, signal).catch((error: unknown) => {
      recordProviderFailure('rewrite', error, signal);
      providerFailures.push('rewrite');
      return null;
    });
    if (rewrite && normalizeSearchText(rewrite) !== normalizeSearchText(retrievalQuery)) {
      const [vector, text] = await Promise.all([
        getSemanticMatches(rewrite, limit, allowed, options),
        lexicalSearch(queryWords(rewrite), limit, allowed),
      ]);
      rewrittenHits = vector.hits.filter(({ distance }) => distance <= MAX_VECTOR_DISTANCE);
      const seen = new Set(lexical.map(({id, kind}) => `${id}:${kind}`));
      lexical = [...lexical, ...text.filter(({id, kind}) => !seen.has(`${id}:${kind}`))];
      if (!vector.available) providerFailures.push('embedding');
    }
  }
  // רק התאמות סמנטיות שעברו את סף הקרבה משתתפות בדירוג.
  const ranked = fuse(catalogHits, lexical, semanticHits, rewrittenHits).slice(0, limit);
  const rankedIds = await focusOnSharedPhrase(ranked, words, [...semanticHits, ...rewrittenHits]);
  return { rankedIds, providerFailures };
}
