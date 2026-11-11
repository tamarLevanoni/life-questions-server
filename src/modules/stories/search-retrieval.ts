import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  embedSearchInputs, rerankSearch, rewriteSearchQuery, type SearchEmbeddingModel,
} from '../../lib/search-ai';
import { Sentry } from '../../lib/sentry';
import { findSourceStories, getSourceSearch } from './search-references';
import { normalizeSearchText } from './search-text';

const SEARCH_CANDIDATE_LIMIT = 50;
const SEARCH_TIMEOUT_MS = 1800;
const MAX_QUERY_LENGTH = 2000;
const RRF_OFFSET = 60;
const SEARCH_WORDS = new Set([
  'סיפור', 'סיפורים', 'מקרה', 'מקרים', 'מחפש', 'מחפשת', 'תן', 'תני', 'תביא', 'תביאי',
  'אני', 'לי', 'יש', 'על', 'של', 'עם', 'את', 'או', 'אם', 'מה', 'מי', 'איך', 'האם',
  'שאלה', 'בנושא', 'לכיתה', 'לשיעור', 'דוגמה', 'דוגמא', 'למשל', 'מסכת', 'מקור', 'מקורות',
]);

export type VersionedSearchOptions = {
  indexVersion: string;
  model: SearchEmbeddingModel;
  rerank?: boolean;
  rewrite?: boolean;
  rerankMinScore?: number;
  maxVectorDistance?: number;
  limit?: number;
};

type RankedDocument = { id: string; kind: string; part: number };
type LexicalHit = RankedDocument & { score: number };
type VectorHit = RankedDocument & { distance: number };
type CatalogHit = { id: string; strength: number };
type ProviderStep = 'embedding' | 'rerank' | 'rewrite';

function queryWords(query: string): string[] {
  return [...new Set(normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => !SEARCH_WORDS.has(word)).slice(0, 48);
}

function inSources(column: Prisma.Sql, allowed: string[] | undefined) {
  if (!allowed) return Prisma.empty;
  if (allowed.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${column} IN (${Prisma.join(allowed)})`;
}

async function catalogSearch(query: string) {
  const normalized = normalizeSearchText(query);
  const terms = queryWords(query).join(' ');
  if (!normalized) return [];
  return prisma.$queryRaw<CatalogHit[]>(Prisma.sql`
    WITH catalog AS (
      SELECT s.id,
        CASE
          WHEN normalize_story_search_text(s.title) = ${normalized} THEN 4
          WHEN normalize_story_search_text(t.name) = ${normalized}
            OR normalize_story_search_text(b.name) = ${normalized}
            OR (length(${terms}) >= 2 AND (
              normalize_story_search_text(t.name) = ${terms}
              OR normalize_story_search_text(b.name) = ${terms}
            )) THEN 3
          WHEN length(${normalized}) >= 2
            AND strpos(normalize_story_search_text(s.title), ${normalized}) > 0 THEN 2
          WHEN length(${normalized}) >= 2 AND (
            strpos(normalize_story_search_text(t.name), ${normalized}) > 0
            OR strpos(normalize_story_search_text(b.name), ${normalized}) > 0
            OR strpos(normalize_story_search_text(coalesce(s."sourceReferencesText", '')), ${normalized}) > 0
            OR EXISTS (
              SELECT 1 FROM unnest(s."conceptsFromIndex" || s."keywordsFromIndex" || s."conceptsAi" || s."keywordsAi") AS term
              WHERE normalize_story_search_text(term) = ${normalized}
            )
          ) THEN 1
          ELSE 0
        END AS strength
      FROM stories s
      JOIN topics t ON t.id = s."topicId"
      JOIN books b ON b.id = s."bookId"
    )
    SELECT id, strength
    FROM catalog
    WHERE strength > 0
    ORDER BY strength DESC, id
  `);
}

async function lexicalSearch(
  words: string[],
  indexVersion: string,
  limit: number,
  allowed?: string[],
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
      WHERE d.index_version = ${indexVersion}
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

async function vectorSearch(
  vector: number[],
  options: VersionedSearchOptions,
  limit: number,
  allowed?: string[],
) {
  const literal = `[${vector.join(',')}]`;
  return prisma.$queryRaw<VectorHit[]>(Prisma.sql`
    WITH best AS (
      SELECT DISTINCT ON (d.story_id, d.kind) d.story_id AS id, d.kind, d.part,
        d.embedding <=> ${literal}::vector AS distance
      FROM story_search_documents d
      WHERE d.index_version = ${options.indexVersion}
        AND d.embedding_model = ${options.model}
        AND d.embedding IS NOT NULL
        ${inSources(Prisma.sql`d.story_id`, allowed)}
      ORDER BY d.story_id, d.kind, distance, d.part
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY kind ORDER BY distance, id) AS rank FROM best
    )
    SELECT id, kind, part, distance FROM ranked WHERE rank <= ${limit} ORDER BY kind, rank
  `);
}

function recordProviderFailure(step: ProviderStep) {
  Sentry.captureMessage(`Story search ${step} unavailable`, {
    level: 'warning', tags: { feature: 'story-search', step },
  });
}

async function getSemanticMatches(
  query: string,
  options: VersionedSearchOptions,
  limit: number,
  allowed?: string[],
) {
  let embedding;
  try {
    embedding = await embedSearchInputs(options.model, [query], 'query', AbortSignal.timeout(SEARCH_TIMEOUT_MS));
  } catch {
    recordProviderFailure('embedding');
    return { hits: [], inputTokens: null, available: false };
  }
  return {
    hits: await vectorSearch(embedding.vectors[0], options, limit, allowed),
    inputTokens: embedding.inputTokens, available: true,
  };
}

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

async function getRerankDocuments(
  candidateIds: string[],
  indexVersion: string,
  lexical: LexicalHit[],
  semantic: VectorHit[],
) {
  const parts = new Map<string, number>();
  for (const { id, kind, part } of [...semantic, ...lexical]) parts.set(`${id}:${kind}`, part);
  const [stories, docs] = await Promise.all([
    prisma.story.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, title: true, legalQuestion: true, shortAnswer: true },
    }),
    prisma.$queryRaw<(RankedDocument & { content: string })[]>(Prisma.sql`
      SELECT story_id AS id, kind, part, content FROM story_search_documents
      WHERE index_version = ${indexVersion} AND story_id IN (${Prisma.join(candidateIds)})
      ORDER BY story_id, kind, part
    `),
  ]);
  const byId = new Map(stories.map((story) => [story.id, story]));
  const passages = new Map<string, { core: string[]; expansion?: string }>();
  for (const { id, kind, part, content } of docs) {
    if (kind === 'combined') continue;
    const relevantPart = parts.get(`${id}:${kind}`);
    if (part !== (relevantPart ?? 0) || (kind === 'expansion' && relevantPart === undefined)) continue;
    const chunks = passages.get(id) ?? { core: [] };
    if (kind === 'expansion') chunks.expansion = content;
    else chunks.core.push(content);
    passages.set(id, chunks);
  }
  return candidateIds.map((id) => {
    const story = byId.get(id);
    const chunks = passages.get(id);
    const core = chunks?.core.length ? chunks.core : [story?.title, story?.legalQuestion, story?.shortAnswer];
    return [...core, chunks?.expansion]
      .filter(Boolean).join('\n');
  });
}

async function rankCandidates(
  query: string,
  candidateIds: string[],
  fallbackIds: string[],
  options: VersionedSearchOptions,
  lexical: LexicalHit[],
  semantic: VectorHit[],
  providerFailures: ProviderStep[],
) {
  if (!options.rerank || candidateIds.length === 0) return fallbackIds;
  const documents = await getRerankDocuments(candidateIds, options.indexVersion, lexical, semantic);
  try {
    const ranked = await rerankSearch(query, documents, AbortSignal.timeout(SEARCH_TIMEOUT_MS));
    return ranked
      .filter(({ score }) => options.rerankMinScore === undefined || score >= options.rerankMinScore)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ index }) => candidateIds[index]);
  } catch {
    recordProviderFailure('rerank');
    providerFailures.push('rerank');
    return fallbackIds;
  }
}

export async function searchVersionedStories(q: string, options: VersionedSearchOptions) {
  const query = Array.from(q).slice(0, MAX_QUERY_LENGTH).join('').trim();
  const limit = Math.max(1, Math.min(options.limit ?? SEARCH_CANDIDATE_LIMIT, SEARCH_CANDIDATE_LIMIT));
  const providerFailures: ProviderStep[] = [];
  const empty = { candidateIds: [], rankedIds: [], inputTokens: 0, providerFailures };
  if (!query) return empty;

  const [catalog, source] = await Promise.all([catalogSearch(query), getSourceSearch(query)]);
  const exact = catalog.filter(({ strength }) => strength >= 3).map(({ id }) => id);
  if (exact.length > 0) {
    const strongest = catalog[0].strength;
    const rankedIds = catalog.filter(({ strength }) => strength === strongest).map(({ id }) => id);
    return { ...empty, candidateIds: rankedIds, rankedIds };
  }
  const allowed = source.references.length ? await findSourceStories(source.references, options.indexVersion) : undefined;
  if (allowed?.length === 0) return empty;
  const words = queryWords(source.remainder);
  if (allowed && words.length === 0) {
    const rankedIds = [...allowed].sort();
    return { ...empty, candidateIds: rankedIds, rankedIds };
  }
  const retrievalQuery = source.remainder || query;
  const [lexical, semantic] = await Promise.all([
    lexicalSearch(words, options.indexVersion, limit, allowed),
    getSemanticMatches(retrievalQuery, options, limit, allowed),
  ]);
  if (!semantic.available) providerFailures.push('embedding');
  let rewritten: typeof semantic = { hits: [], inputTokens: 0, available: false };
  if (options.rewrite && words.length >= 4 && semantic.available) {
    const rewrite = await rewriteSearchQuery(retrievalQuery, AbortSignal.timeout(SEARCH_TIMEOUT_MS)).catch(() => {
      recordProviderFailure('rewrite');
      providerFailures.push('rewrite');
      return null;
    });
    if (rewrite && normalizeSearchText(rewrite) !== normalizeSearchText(retrievalQuery)) {
      rewritten = await getSemanticMatches(rewrite, options, limit, allowed);
      if (!rewritten.available) providerFailures.push('embedding');
    }
  }
  const fusedIds = fuse(allowed ? [] : catalog, lexical, semantic.hits, rewritten.hits);
  const candidateIds = fusedIds.slice(0, limit);
  const acceptable = new Set([
    ...(allowed ? [] : catalog), ...lexical,
    ...[...semantic.hits, ...rewritten.hits].filter(({ distance }) => distance <= (options.maxVectorDistance ?? 0.6)),
  ].map(({ id }) => id));
  const fallbackIds = fusedIds.filter((id) => acceptable.has(id)).slice(0, limit);
  const rerankIds = options.rerankMinScore === undefined ? fallbackIds : candidateIds;
  const rankedIds = await rankCandidates(
    query, rerankIds, fallbackIds, options, lexical, [...semantic.hits, ...rewritten.hits], providerFailures,
  );
  const inputTokens = semantic.inputTokens === null || rewritten.inputTokens === null
    ? null
    : semantic.inputTokens + rewritten.inputTokens;
  return { candidateIds, rankedIds, inputTokens, providerFailures };
}
