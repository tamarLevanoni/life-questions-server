import { SQL } from 'bun';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { embedSearchInputs, getSearchEmbeddingModel, SEARCH_EMBEDDING_MODELS, type SearchEmbeddingModel } from '../src/lib/search-ai';
import {
  buildStorySearchDocuments,
  countSearchWords,
  SEARCH_INDEX_LAYOUTS,
  SEARCH_RECIPE_VERSION,
  SEARCH_WORD_LIMITS,
  storySearchTexts,
  type SearchDocument,
  type SearchIndexLayout,
  type StorySearchContent,
} from '../src/modules/stories/search-index';

const STORY_BATCH_SIZE = 50;
const EMBEDDING_BATCH_SIZE = 32;
const USAGE = `Usage:
  bun run scripts/search-index.ts migrate
  bun run scripts/search-index.ts status --version <version> [--model <model>] [--layout <layout>]
  bun run scripts/search-index.ts backfill --version <version> [--model <model>] [--layout <layout>]

Set SEARCH_INDEX_DATABASE_URL to the database targeted by the command.
Models: ${SEARCH_EMBEDDING_MODELS.join(', ')}
Layouts: ${SEARCH_INDEX_LAYOUTS.join(', ')} (default: split)`;

interface IndexConfig {
  version: string;
  model: SearchEmbeddingModel;
  layout: SearchIndexLayout;
}

interface CatalogStory extends StorySearchContent {
  id: string;
}

interface StoredDocument {
  story_id: string;
  kind: SearchDocument['kind'];
  part: number;
  content_hash: string;
  embedding_model: string | null;
  has_embedding: boolean;
}

interface PendingDocument extends SearchDocument {
  storyId: string;
  vector: string | null;
}

interface WorkItem {
  story: CatalogStory;
  documents: SearchDocument[];
  pending: PendingDocument[];
  obsolete: StoredDocument[];
}

function documentKey(document: { kind: string; part: number }): string {
  return `${document.kind}:${document.part}`;
}

function getWork(story: CatalogStory, stored: StoredDocument[], config: IndexConfig): WorkItem {
  const documents = buildStorySearchDocuments(story, config.layout);
  const byKey = new Map(stored.map((document) => [documentKey(document), document]));
  const expectedKeys = new Set(documents.map(documentKey));
  const pending = documents.filter((document) => {
    const existing = byKey.get(documentKey(document));
    return existing?.content_hash !== document.contentHash
      || existing.has_embedding !== document.embed
      || existing.embedding_model !== (document.embed ? config.model : null);
  });
  return {
    story,
    documents,
    pending: pending.map((document) => ({ ...document, storyId: story.id, vector: null })),
    obsolete: stored.filter((document) => !expectedKeys.has(documentKey(document))),
  };
}

async function verifyVersion(sql: SQL, config: IndexConfig, create: boolean): Promise<boolean> {
  if (create) {
    await sql`
      INSERT INTO story_search_index_versions (index_version, embedding_model, layout, recipe_version)
      VALUES (${config.version}, ${config.model}, ${config.layout}, ${SEARCH_RECIPE_VERSION})
      ON CONFLICT (index_version) DO NOTHING
    `;
  }
  const [record] = await sql<{ embedding_model: string; layout: string; recipe_version: number }[]>`
    SELECT embedding_model, layout, recipe_version FROM story_search_index_versions
    WHERE index_version = ${config.version}
  `;
  if (!record) return false;
  if (record.embedding_model !== config.model || record.layout !== config.layout || record.recipe_version !== SEARCH_RECIPE_VERSION) {
    throw new Error('This index version already uses a different model, layout, or document recipe. Choose a new version.');
  }
  return true;
}

async function embedPending(work: WorkItem[], model: SearchEmbeddingModel): Promise<number | null> {
  const pending = work.flatMap((item) => item.pending.filter((document) => document.embed));
  const uniqueInputs = [...new Map(pending.map((document) => [document.contentHash, document])).values()];
  const vectors = new Map<string, string>();
  let inputTokens: number | null = 0;
  for (let start = 0; start < uniqueInputs.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = uniqueInputs.slice(start, start + EMBEDDING_BATCH_SIZE);
    const result = await embedSearchInputs(model, batch.map((document) => document.content), 'document');
    inputTokens = inputTokens === null || result.inputTokens === null ? null : inputTokens + result.inputTokens;
    batch.forEach((document, index) => vectors.set(document.contentHash, JSON.stringify(result.vectors[index])));
  }
  for (const document of pending) {
    const vector = vectors.get(document.contentHash);
    if (!vector) throw new Error('Missing embedding for a search document.');
    document.vector = vector;
  }
  return inputTokens;
}

async function writeWork(sql: SQL, work: WorkItem[], config: IndexConfig): Promise<number> {
  const changed = work.filter((item) => item.pending.length || item.obsolete.length);
  if (changed.length === 0) return 0;

  return sql.begin(async (tx) => {
    const currentStories = await tx<CatalogStory[]>`
      SELECT id, title, "storyBody", "legalQuestion", "shortAnswer", "summaryAi",
             "conceptsFromIndex", "conceptsAi", expansion
      FROM stories
      WHERE id IN ${tx(changed.map((item) => item.story.id))}
      ORDER BY id
      FOR UPDATE
    `;
    const byId = new Map(currentStories.map((story) => [story.id, story]));
    const ready = changed.filter((item) => {
      const story = byId.get(item.story.id);
      if (!story) return false;
      const current = buildStorySearchDocuments(story, config.layout);
      return current.length === item.documents.length && current.every((document, index) => (
        documentKey(document) === documentKey(item.documents[index]) && document.contentHash === item.documents[index].contentHash
      ));
    });

    const pending = ready.flatMap((item) => item.pending);
    if (pending.length) {
      await tx`
        INSERT INTO story_search_documents
          (story_id, index_version, kind, part, content, content_hash, embedding_model, embedding)
        SELECT source."storyId", ${config.version}, source.kind, source.part, source.content, source."contentHash",
               CASE WHEN source.embed THEN ${config.model} ELSE NULL END, source.vector::vector
        FROM jsonb_to_recordset(${JSON.stringify(pending)}::text::jsonb) AS source(
          "storyId" TEXT, kind TEXT, part INTEGER, content TEXT, "contentHash" TEXT, embed BOOLEAN, vector TEXT
        )
        ON CONFLICT (story_id, index_version, kind, part) DO UPDATE SET
          content = EXCLUDED.content,
          content_hash = EXCLUDED.content_hash,
          embedding_model = EXCLUDED.embedding_model,
          embedding = EXCLUDED.embedding
        WHERE story_search_documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash
           OR story_search_documents.embedding_model IS DISTINCT FROM EXCLUDED.embedding_model
           OR (story_search_documents.embedding IS NULL) <> (EXCLUDED.embedding IS NULL)
      `;
    }

    const obsolete = ready.flatMap((item) => item.obsolete.map(({ story_id, kind, part }) => ({ story_id, kind, part })));
    if (obsolete.length) {
      await tx`
        DELETE FROM story_search_documents AS document
        USING jsonb_to_recordset(${JSON.stringify(obsolete)}::text::jsonb) AS old(story_id TEXT, kind TEXT, part INTEGER)
        WHERE document.index_version = ${config.version}
          AND document.story_id = old.story_id AND document.kind = old.kind AND document.part = old.part
      `;
    }
    return changed.length - ready.length;
  });
}

async function scan(sql: SQL, config: IndexConfig, write: boolean) {
  const versionExists = await verifyVersion(sql, config, write);
  let afterId = '';
  let skippedChangedStories = 0;
  let incompleteStories = 0;
  let storyCount = 0;
  let inputTokens: number | null = 0;
  let pendingDocuments = 0;
  let obsoleteDocuments = 0;
  const documentsByKind = { scenario: 0, principle: 0, expansion: 0, combined: 0 };
  const overWordLimit = { scenario: 0, principle: 0, expansion: 0 };
  const maxSourceWords = { scenario: 0, principle: 0, expansion: 0 };

  while (true) {
    const stories = await sql<CatalogStory[]>`
      SELECT id, title, "storyBody", "legalQuestion", "shortAnswer", "summaryAi",
             "conceptsFromIndex", "conceptsAi", expansion
      FROM stories WHERE id > ${afterId} ORDER BY id LIMIT ${STORY_BATCH_SIZE}
    `;
    if (stories.length === 0) break;
    afterId = stories[stories.length - 1].id;
    storyCount += stories.length;

    const stored = versionExists ? await sql<StoredDocument[]>`
      SELECT story_id, kind, part, content_hash, embedding_model, embedding IS NOT NULL AS has_embedding
      FROM story_search_documents
      WHERE index_version = ${config.version} AND story_id IN ${sql(stories.map((story) => story.id))}
    ` : [];
    const storedById = new Map<string, StoredDocument[]>();
    for (const document of stored) {
      const bucket = storedById.get(document.story_id) ?? [];
      bucket.push(document);
      storedById.set(document.story_id, bucket);
    }

    const work = stories.map((story) => getWork(story, storedById.get(story.id) ?? [], config));
    for (const item of work) {
      if (item.pending.length || item.obsolete.length || item.documents.length === 0) incompleteStories++;
      pendingDocuments += item.pending.length;
      obsoleteDocuments += item.obsolete.length;
      for (const document of item.documents) documentsByKind[document.kind]++;
      const sources = storySearchTexts(item.story);
      for (const kind of ['scenario', 'principle', 'expansion'] as const) {
        const words = countSearchWords(sources[kind]);
        if (words > SEARCH_WORD_LIMITS[kind]) overWordLimit[kind]++;
        maxSourceWords[kind] = Math.max(maxSourceWords[kind], words);
      }
    }

    if (write) {
      const batchTokens = await embedPending(work, config.model);
      inputTokens = inputTokens === null || batchTokens === null ? null : inputTokens + batchTokens;
      skippedChangedStories += await writeWork(sql, work, config);
      console.error(`Scanned ${storyCount} stories for ${config.version}.`);
    }
  }

  return {
    versionExists,
    storyCount,
    incompleteStories,
    pendingDocuments,
    obsoleteDocuments,
    skippedChangedStories,
    documentsByKind,
    overWordLimit,
    maxSourceWords,
    inputTokens,
  };
}

async function main(): Promise<void> {
  const { positionals: [command, ...rest], values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'string' },
      model: { type: 'string' },
      layout: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (rest.length || (command !== 'migrate' && command !== 'status' && command !== 'backfill')) {
    throw new Error(USAGE);
  }
  const databaseUrl = process.env.SEARCH_INDEX_DATABASE_URL;
  if (!databaseUrl) throw new Error('Set SEARCH_INDEX_DATABASE_URL to the target database.');
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('SEARCH_INDEX_DATABASE_URL must be a PostgreSQL URL.');

  const sql = new SQL(databaseUrl);
  try {
    if (command === 'migrate') {
      await sql.file(fileURLToPath(new URL('../story_search_migration.sql', import.meta.url)));
      console.log('Story search migration applied.');
      return;
    }

    const version = values.version;
    const model = SEARCH_EMBEDDING_MODELS.find((name) => name === (values.model ?? getSearchEmbeddingModel()));
    const layout = SEARCH_INDEX_LAYOUTS.find((name) => name === (values.layout ?? 'split'));
    if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version) || !model || !layout) throw new Error(USAGE);
    const config = { version, model, layout };
    const initial = await scan(sql, config, command === 'backfill');
    const final = command === 'backfill' ? await scan(sql, config, false) : initial;
    const ready = final.versionExists && final.storyCount > 0 && final.incompleteStories === 0;
    console.log(JSON.stringify({
      ...config,
      ...final,
      inputTokens: initial.inputTokens,
      skippedChangedStories: initial.skippedChangedStories,
      ready,
    }, null, 2));
    if (command === 'backfill' && !ready) process.exitCode = 1;
  } finally {
    await sql.close();
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Search indexing failed';
  const databaseUrl = process.env.SEARCH_INDEX_DATABASE_URL;
  console.error(databaseUrl ? message.replaceAll(databaseUrl, '[database URL]') : message);
  process.exitCode = 1;
});
