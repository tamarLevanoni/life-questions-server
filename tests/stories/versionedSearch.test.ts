import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import * as searchAi from '../../src/lib/search-ai';
import { cleanDb, linkStoryToShas, seedMasechet, seedShasPage, seedStory, seedTopic } from '../helpers/seed';

const embed = jest.spyOn(searchAi, 'embedSearchInputs');
const rerank = jest.spyOn(searchAi, 'rerankSearch');
const secret = process.env.API_SECRET ?? 'test-secret';
const indexVersion = 'search-tests-active';
const shadowVersion = 'search-tests-shadow';
const originalEnv = process.env;

const search = (body: Record<string, unknown>) => request(app)
  .post('/api/stories/search')
  .set('x-api-secret', secret)
  .send(body);

function vectorAt(coordinate: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => i === coordinate ? 1 : 0);
}

async function addDocument(
  storyId: string, kind: string, content: string,
  options: { version?: string; vector?: number[]; model?: string; part?: number } = {},
) {
  const vector = options.vector ? `[${options.vector.join(',')}]` : null;
  const model = vector ? options.model ?? 'text-embedding-3-small' : null;
  await prisma.$executeRaw`
    INSERT INTO story_search_documents (story_id, index_version, kind, part, content, content_hash, embedding_model, embedding)
    VALUES (${storyId}, ${options.version ?? indexVersion}, ${kind}, ${options.part ?? 0}, ${content}, 'hash', ${model}, ${vector}::vector)
  `;
}

beforeEach(async () => {
  await cleanDb();
  process.env = {
    ...originalEnv,
    SEARCH_INDEX_VERSION: indexVersion,
    SEARCH_EMBEDDING_MODEL: 'text-embedding-3-small',
    SEARCH_RERANK_ENABLED: 'false',
    SEARCH_REWRITE_ENABLED: 'false',
  };
  delete process.env.SEARCH_EMBEDDING_MAX_DISTANCE;
  delete process.env.SEARCH_RERANK_MIN_SCORE;
  embed.mockReset().mockRejectedValue(new Error('Provider unavailable'));
  rerank.mockReset();
  await prisma.$executeRaw`
    INSERT INTO story_search_index_versions (index_version, embedding_model, layout, recipe_version)
    VALUES (${indexVersion}, 'text-embedding-3-small', 'split', 1), (${shadowVersion}, 'text-embedding-3-small', 'split', 1)
    ON CONFLICT (index_version) DO NOTHING
  `;
});

afterEach(() => {
  process.env = originalEnv;
});

afterAll(() => {
  embed.mockRestore();
  rerank.mockRestore();
});

describe('POST /api/stories/search with a versioned index', () => {
  it('finds a term in an expansion during an embedding outage and returns only the story card', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { title: 'חבר טוב מאכיל את החבר', expansion: 'הדיון עוסק ביאוש שלא מדעת.' });
    await addDocument(story.id, 'expansion', 'הדיון עוסק ביאוש שלא מדעת.');
    await addDocument(story.id, 'expansion', 'חזרה על יאוש שלא מדעת.', { part: 1 });
    const unrelated = await seedStory(topic.id);
    await addDocument(unrelated.id, 'expansion', 'יאוש שלא מדעת', { version: shadowVersion });

    const res = await search({ q: 'יֵאוּש שלא מדעת' });

    assertSuccess(res);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.stories[0].id).toBe(story.id);
    expect(res.body.data.stories[0]).not.toHaveProperty('expansion');
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('prioritizes a normalized exact title and returns an exact topic without the providers', async () => {
    const topic = await seedTopic({ name: 'הלכות פקדון' });
    const story = await seedStory(topic.id, { title: 'כיצד שומרים על הפיקדון' });
    await seedStory(topic.id, { title: 'דוגמה נוספת' });

    const exact = await search({ q: 'כֵּיצַד שומרים על הפיקדון' });
    const byTopic = await search({ q: 'סיפורים על הלכות פקדון' });

    assertSuccess(exact);
    assertSuccess(byTopic);
    expect(exact.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([story.id]);
    expect(byTopic.body.data.total).toBe(2);
    expect(embed).not.toHaveBeenCalled();
  });

  it('normalizes a source in structured and textual evidence and excludes conflicting evidence', async () => {
    const topic = await seedTopic();
    const tractate = await seedMasechet({ name: 'בבא מציעא' });
    const daf36 = await seedShasPage(tractate.id, 36, 'b');
    const daf37 = await seedShasPage(tractate.id, 37, 'b');
    const linked = await seedStory(topic.id);
    const text = await seedStory(topic.id);
    const wrong = await seedStory(topic.id);
    const conflict = await seedStory(topic.id, { sourceReferencesText: 'בבא מציעא דף ל״ז ע״ב' });
    await linkStoryToShas(linked.id, daf36.id);
    await linkStoryToShas(wrong.id, daf37.id);
    await linkStoryToShas(conflict.id, daf36.id);
    await addDocument(text.id, 'expansion', 'כמובא בבבא מציעא לו: בדברי השומרים.');

    const res = await search({ q: 'מסכת ב״מ ל״ו ע״ב' });

    assertSuccess(res);
    expect(res.body.data.stories.map(({ id }: { id: string }) => id).sort()).toEqual([linked.id, text.id].sort());
    expect(embed).not.toHaveBeenCalled();
  });

  it('requires both parts of a source and topic query before applying the separate OR filters', async () => {
    const topic = await seedTopic();
    const filter = await seedTopic();
    const tractate = await seedMasechet({ name: 'בבא מציעא' });
    const page = await seedShasPage(tractate.id, 36, '');
    const both = await seedStory(topic.id);
    const byTopic = await seedStory(topic.id);
    const bySource = await seedStory(topic.id);
    const byFilter = await seedStory(filter.id);
    await linkStoryToShas(both.id, page.id);
    await linkStoryToShas(bySource.id, page.id);
    await addDocument(both.id, 'principle', 'שומר שמסר לשומר');
    await addDocument(byTopic.id, 'principle', 'שומר שמסר לשומר');

    const res = await search({ q: 'סיפור לכיתה על שומר שמסר לשומר מבבא מציעא ל״ו', topicIds: [filter.id] });

    assertSuccess(res);
    expect(res.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([both.id, byFilter.id]);
  });

  it('reuses one query vector across case and principle while excluding other model spaces', async () => {
    const topic = await seedTopic();
    const scenario = await seedStory(topic.id);
    const principle = await seedStory(topic.id);
    const wrongModel = await seedStory(topic.id);
    const distant = await seedStory(topic.id);
    const queryVector = vectorAt(0);
    await addDocument(scenario.id, 'scenario', 'תיאור מקרה שונה', { vector: queryVector });
    await addDocument(principle.id, 'principle', 'עיקרון דומה', { vector: queryVector });
    await addDocument(wrongModel.id, 'principle', 'מחוץ למרחב', { vector: queryVector, model: 'text-embedding-3-large' });
    await addDocument(distant.id, 'scenario', 'מחוץ לסף', { vector: vectorAt(1) });
    embed.mockResolvedValue({ vectors: [queryVector], inputTokens: 7 });

    const res = await search({ q: 'אופניים שנמסרו לחבר ונגנבו' });

    assertSuccess(res);
    expect(res.body.data.stories.map(({ id }: { id: string }) => id).sort()).toEqual([scenario.id, principle.id].sort());
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('keeps the relevance order and OR facet results across pages when reranking times out', async () => {
    process.env.SEARCH_RERANK_ENABLED = 'true';
    rerank.mockRejectedValue(new Error('Provider unavailable'));
    const topic = await seedTopic();
    const facet = await seedTopic();
    const match = await seedStory(topic.id);
    const byFacet = await seedStory(facet.id);
    await addDocument(match.id, 'principle', 'זכויות שוכר דירה');
    const body = { q: 'זכויות שוכר', topicIds: [facet.id], limit: 1 };

    const first = await search(body);
    const second = await search({ ...body, page: 2 });

    assertSuccess(first);
    assertSuccess(second);
    expect(first.body.data).toMatchObject({ total: 2, stories: [{ id: match.id }] });
    expect(second.body.data).toMatchObject({ total: 2, stories: [{ id: byFacet.id }] });
    expect(rerank).toHaveBeenCalledTimes(2);
  });

  it('requires the API secret before querying the index', async () => {
    const res = await request(app).post('/api/stories/search').send({ q: 'זכויות שוכר' });
    expect(res.status).toBe(401);
    expect(embed).not.toHaveBeenCalled();
  });
});

function assertSuccess(res: request.Response) {
  if (res.status !== 200) throw new Error(`Search returned ${res.status}: ${JSON.stringify(res.body)}`);
}
