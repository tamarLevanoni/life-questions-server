import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { SEARCH_EMBEDDING_MODELS, type SearchEmbeddingModel } from '../src/lib/search-ai';
import { scoreSearch } from './search-eval-metrics';

const intents = ['case', 'principle', 'source', 'title', 'topic', 'expansion', 'no-match'] as const;
const fixtureSchema = z.object({
  judgmentStatus: z.enum(['draft', 'reviewed']),
  notes: z.string(),
  queries: z.array(z.object({
    id: z.string().min(1),
    split: z.enum(['tune', 'holdout']),
    intent: z.enum(intents),
    query: z.string().trim().min(1),
    judgments: z.array(z.object({
      book: z.number().int().positive(),
      order: z.number().int().positive(),
      title: z.string().min(1),
      grade: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    })),
  })).min(1),
});
type SearchFixture = z.infer<typeof fixtureSchema>;
type Query = SearchFixture['queries'][number];
type Arm = { name: string; legacy: true } | {
  name: string;
  legacy: false;
  indexVersion: string;
  model: SearchEmbeddingModel;
  rerank: boolean;
  rewrite: boolean;
  rerankMinScore?: number;
};
type Observation = ReturnType<typeof scoreSearch> & {
  elapsedMs: number;
  embeddingInputTokens: number | null;
  providerFailures: ('embedding' | 'rerank' | 'rewrite')[] | null;
};

const usage = `Usage: bun run scripts/search-eval.ts [--split tune|holdout|all] [--fixture PATH]
  --check-fixture     Validate the fixture locally
  --arm legacy        Measure the existing search
  --arm NAME=VERSION,MODEL[,rerank][,rewrite][,minScore=0.0]
Set SEARCH_EVAL_DATABASE_URL to the isolated catalog before running a benchmark.`;

function parseArm(input: string): Arm {
  if (input === 'legacy') return { name: 'legacy', legacy: true };
  const delimiter = input.indexOf('=');
  const name = input.slice(0, delimiter);
  const [indexVersion, model, ...flags] = input.slice(delimiter + 1).split(',');
  if (delimiter < 1 || !/^[a-z0-9_-]+$/i.test(name) || !indexVersion) {
    throw new Error(`Invalid benchmark arm: ${input}`);
  }
  const modelName = z.enum(SEARCH_EMBEDDING_MODELS).safeParse(model);
  if (!modelName.success) throw new Error(`Unsupported model in benchmark arm "${name}"`);

  const rerank = flags.includes('rerank');
  const rewrite = flags.includes('rewrite');
  const thresholds = flags.filter(flag => /^minScore=(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(flag));
  const knownFlags = Number(rerank) + Number(rewrite) + thresholds.length;
  if (knownFlags !== flags.length || thresholds.length > 1 || (thresholds.length && !rerank)) {
    throw new Error(`Invalid flags for benchmark arm "${name}"`);
  }

  return {
    name, legacy: false, indexVersion, model: modelName.data, rerank, rewrite,
    rerankMinScore: thresholds.length ? Number(thresholds[0].slice('minScore='.length)) : undefined,
  };
}

function validateFixture(fixture: SearchFixture) {
  const ids = new Set<string>();
  const questions = new Set<string>();
  for (const query of fixture.queries) {
    if (ids.has(query.id)) throw new Error(`Duplicate query ID: ${query.id}`);
    const normalizedQuestion = normalizeTitle(query.query);
    if (questions.has(normalizedQuestion)) throw new Error(`Duplicate question: ${query.id}`);
    ids.add(query.id);
    questions.add(normalizedQuestion);
    const judgedStories = new Set(query.judgments.map(story => `${story.book}:${story.order}`));
    if (judgedStories.size !== query.judgments.length) {
      throw new Error(`Duplicate story judgment in query ${query.id}`);
    }
    const hasRelevant = query.judgments.some(({ grade }) => grade > 0);
    if (hasRelevant === (query.intent === 'no-match')) {
      throw new Error(`Query ${query.id} has inconsistent relevance judgments`);
    }
  }
}

function normalizeTitle(title: string) {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function storyKey(story: Query['judgments'][number]) {
  return JSON.stringify([story.book, story.order, normalizeTitle(story.title)]);
}

function summarize(rows: Observation[]) {
  const average = (key: 'recallAt50' | 'precisionAt3' | 'ndcgAt10' | 'noMatchFalsePositive') => {
    const values = rows.map(row => row[key]).filter(value => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const times = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  const percentile = (p: number) => times[Math.ceil(times.length * p) - 1] ?? null;
  const tokens = rows.map(row => row.embeddingInputTokens).filter(value => value !== null);
  const providerFailures = rows.map(row => row.providerFailures).filter(value => value !== null);
  const counts = rows.reduce(
    (sum, row) => ({ judged: sum.judged + row.judgedInTop10, returned: sum.returned + row.returnedInTop10 }),
    { judged: 0, returned: 0 },
  );
  return {
    queries: rows.length,
    recallAt50: average('recallAt50'),
    precisionAt3: average('precisionAt3'),
    ndcgAt10: average('ndcgAt10'),
    noMatchFalsePositiveRate: average('noMatchFalsePositive'),
    top10JudgmentCoverage: counts.returned ? counts.judged / counts.returned : null,
    latencyP50Ms: percentile(0.5),
    latencyP95Ms: percentile(0.95),
    measuredEmbeddingInputTokens: tokens.length ? tokens.reduce((sum, value) => sum + value, 0) : null,
    queriesWithEmbeddingTokenCounts: tokens.length,
    queriesWithProviderFailures: providerFailures.length
      ? providerFailures.filter(failures => failures.length > 0).length
      : null,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean' },
      fixture: { type: 'string' },
      'check-fixture': { type: 'boolean' },
      split: { type: 'string', default: 'tune' },
      arm: { type: 'string', multiple: true },
    },
  });
  if (values.help) return console.log(usage);
  const fixturePath = values.fixture
    ? resolve(values.fixture)
    : new URL('../tests/fixtures/story-search-eval.json', import.meta.url);
  const fixture = fixtureSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
  validateFixture(fixture);
  if (values['check-fixture']) {
    console.log(JSON.stringify({
      judgmentStatus: fixture.judgmentStatus,
      tune: fixture.queries.filter(query => query.split === 'tune').length,
      holdout: fixture.queries.filter(query => query.split === 'holdout').length,
    }));
    return;
  }

  const split = z.enum(['tune', 'holdout', 'all']).parse(values.split);
  const queries = fixture.queries.filter(query => split === 'all' || query.split === split);
  if (!queries.length) throw new Error(`Fixture has no queries for split "${split}"`);
  const arms = (values.arm?.length ? values.arm : ['legacy']).map(parseArm);
  if (new Set(arms.map(arm => arm.name)).size !== arms.length) {
    throw new Error('Benchmark arm names must be unique');
  }
  const connectionString = process.env.SEARCH_EVAL_DATABASE_URL;
  if (!connectionString) throw new Error('SEARCH_EVAL_DATABASE_URL must point to the isolated catalog');
  if (process.env.NODE_ENV === 'test') process.env.DATABASE_URL_TESTS = connectionString;
  else process.env.DATABASE_URL = connectionString;

  const { prisma } = await import('../src/lib/prisma');
  try {
    for (const arm of arms) {
      if (arm.legacy) continue;
      const [version] = await prisma.$queryRaw<{ embedding_model: string; has_documents: boolean }[]>`
        SELECT embedding_model, EXISTS (
          SELECT 1 FROM story_search_documents d WHERE d.index_version = v.index_version
        ) AS has_documents
        FROM story_search_index_versions v WHERE index_version = ${arm.indexVersion}
      `;
      if (!version?.has_documents || version.embedding_model !== arm.model) {
        throw new Error(`Benchmark arm "${arm.name}" needs a populated index version with the selected model`);
      }
    }
    const [legacy, versioned] = await Promise.all([
      import('../src/modules/stories/stories.service'),
      import('../src/modules/stories/search-retrieval'),
    ]);
    const refs = queries.flatMap(query => query.judgments);
    const stories = await prisma.story.findMany({
      where: {
        book: { orderIndex: { in: [...new Set(refs.map(story => story.book))] } },
        storyOrder: { in: [...new Set(refs.map(story => story.order))] },
      },
      select: { id: true, storyOrder: true, title: true, book: { select: { orderIndex: true } } },
    });
    const resolved = new Map<string, string | null>();
    for (const story of stories) {
      const key = storyKey({ book: story.book.orderIndex, order: story.storyOrder, title: story.title, grade: 0 });
      resolved.set(key, resolved.has(key) ? null : story.id);
    }
    const unresolved = [...new Set(refs.filter(story => !resolved.get(storyKey(story))).map(storyKey))];
    if (unresolved.length) {
      throw new Error(`Missing or ambiguous fixture stories in the selected catalog: ${unresolved.join(', ')}`);
    }

    const resultRows: {
      id: string;
      intent: Query['intent'];
      arm: string;
      candidateIds: string[];
      rankedIds: string[];
      observation: Observation;
    }[] = [];
    for (const [position, query] of queries.entries()) {
      const judgments = query.judgments.map(ref => ({ id: resolved.get(storyKey(ref))!, grade: ref.grade }));
      // Rotate the first arm to reduce systematic timing bias from warmed caches.
      const startArm = position % arms.length;
      for (const arm of [...arms.slice(startArm), ...arms.slice(0, startArm)]) {
        const started = performance.now();
        let result: {
          candidateIds: string[];
          rankedIds: string[];
          inputTokens: number | null;
          providerFailures: Observation['providerFailures'];
        };
        if (arm.legacy) {
          const search = await legacy.searchLegacyStories({ q: query.query, page: 1, limit: 50 });
          const ids = search.stories.map(story => story.id);
          result = { candidateIds: ids, rankedIds: ids, inputTokens: null, providerFailures: null };
        } else {
          result = await versioned.searchVersionedStories(query.query, { ...arm, limit: 50 });
        }
        const elapsedMs = performance.now() - started;
        resultRows.push({
          id: query.id,
          intent: query.intent,
          arm: arm.name,
          candidateIds: result.candidateIds,
          rankedIds: result.rankedIds,
          observation: {
            ...scoreSearch(judgments, result.candidateIds, result.rankedIds),
            elapsedMs,
            embeddingInputTokens: result.inputTokens,
            providerFailures: result.providerFailures,
          },
        });
      }
    }
    console.log(JSON.stringify({
      split,
      judgmentStatus: fixture.judgmentStatus,
      notes: fixture.notes,
      configuration: arms,
      metrics: Object.fromEntries(arms.map(arm => {
        const armRows = resultRows.filter(row => row.arm === arm.name);
        return [arm.name, {
          ...summarize(armRows.map(row => row.observation)),
          byIntent: Object.fromEntries(intents.map(intent => [
            intent,
            summarize(armRows.filter(row => row.intent === intent).map(row => row.observation)),
          ])),
        }];
      })),
      results: resultRows,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : 'Search evaluation failed';
  const connectionString = process.env.SEARCH_EVAL_DATABASE_URL;
  console.error(connectionString ? message.replaceAll(connectionString, '[database URL]') : message);
  process.exitCode = 1;
});
