import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import * as searchAi from '../../src/lib/search-ai';
import contract from '../../src/modules/stories/search-index-contract.json';
import { cleanDb, linkStoryToShas, seedMasechet, seedShasPage, seedStory, seedTopic } from '../helpers/seed';

const embed = jest.spyOn(searchAi, 'embedSearchInputs');
const rewrite = jest.spyOn(searchAi, 'rewriteSearchQuery');
const secret = process.env.API_SECRET ?? 'test-secret';
const shadowVersion = 'search-tests-shadow';

// שולח חיפוש עבור חשבון הבדיקה דרך אותו נתיב שה־BFF מפעיל.
const search = (body: Record<string, unknown>) => request(app)
  .post('/api/stories/search')
  .set('x-api-secret', secret)
  .set('x-search-account', 'a'.repeat(64))
  .send(body);

/** מייצר וקטור עם רכיב פעיל אחד כדי שמרחקי הבדיקה יהיו צפויים. */
function vectorAt(coordinate: number): number[] {
  return Array.from({ length: contract.embeddingDimensions }, (_, i) => i === coordinate ? 1 : 0);
}

/** מכניס מסמך בדיקה לגרסת האינדקס הרצויה, עם וקטור או עם טקסט בלבד. */
async function addDocument(
  storyId: string, kind: string, content: string,
  options: { version?: string; vector?: number[]; model?: string; part?: number } = {},
) {
  const vector = options.vector ? `[${options.vector.join(',')}]` : null;
  const model = vector ? options.model ?? contract.embeddingModel : null;
  await prisma.$executeRaw`
    INSERT INTO story_search_documents (story_id, index_version, kind, part, content, content_hash, embedding_model, embedding)
    VALUES (${storyId}, ${options.version ?? contract.indexId}, ${kind}, ${options.part ?? 0}, ${content}, 'hash', ${model}, ${vector}::vector)
  `;
}

beforeEach(async () => {
  await cleanDb();
  embed.mockReset().mockRejectedValue(new Error('Provider unavailable'));
  rewrite.mockReset().mockResolvedValue(null);
  await prisma.$executeRaw`
    INSERT INTO story_search_index_versions (index_version, embedding_model, layout, recipe_version)
    VALUES
      (${contract.indexId}, ${contract.embeddingModel}, 'split', 1),
      (${shadowVersion}, ${contract.embeddingModel}, 'split', 1)
    ON CONFLICT (index_version) DO NOTHING
  `;
});

afterAll(() => {
  embed.mockRestore();
  rewrite.mockRestore();
});

describe('POST /api/stories/search with an indexed catalog', () => {
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
    const byTopic = await search({ q: 'הלכות פקדון' });

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

  it('ranks combined source and text matches before source-only matches within the selected topic', async () => {
    const topic = await seedTopic();
    const filter = await seedTopic();
    const tractate = await seedMasechet({ name: 'בבא מציעא' });
    const page = await seedShasPage(tractate.id, 36, '');
    const both = await seedStory(filter.id);
    const byTopic = await seedStory(topic.id);
    const bySource = await seedStory(filter.id);
    await seedStory(filter.id);
    await linkStoryToShas(both.id, page.id);
    await linkStoryToShas(bySource.id, page.id);
    await addDocument(both.id, 'principle', 'שומר שמסר לשומר');
    await addDocument(byTopic.id, 'principle', 'שומר שמסר לשומר');

    const res = await search({ q: 'שומר שמסר לשומר מבבא מציעא ל״ו', topicIds: [filter.id] });

    assertSuccess(res);
    expect(res.body.data.stories.map(({ id }: { id: string }) => id)).toEqual([both.id, bySource.id]);
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

  it('filters weak matches when the leading results share a phrase from the query', async () => {
    const topic = await seedTopic();
    const matches = [];
    for (let i = 0; i < 9; i++) {
      const story = await seedStory(topic.id);
      matches.push(story.id);
      await addDocument(story.id, 'principle', 'להדליק נרות שבת בבית.');
    }

    const sharedWords = await seedStory(topic.id);
    const incidentalPhrase = await seedStory(topic.id);
    const vectorOnly = await seedStory(topic.id);
    const vector = vectorAt(0);
    await addDocument(sharedWords.id, 'principle', 'חייב לשלם על מלאכה שעשה בשבת. שבת.');
    await addDocument(incidentalPhrase.id, 'expansion', 'ליד החלון עמדו נרות שבת.');
    await addDocument(vectorOnly.id, 'scenario', 'דנו בפרטי העבודה.', { vector });
    embed.mockResolvedValue({ vectors: [vector], inputTokens: 7 });

    const res = await search({ q: 'האם גבר חייב להדליק נרות שבת?' });

    assertSuccess(res);
    expect(res.body.data.total).toBe(9);
    expect(res.body.data.nextCursor).toBeNull();
    expect(res.body.data.stories.map(({ id }: { id: string }) => id).sort()).toEqual(matches.sort());
  });

  it('requires the API secret before querying the index', async () => {
    const res = await request(app).post('/api/stories/search').send({ q: 'זכויות שוכר' });
    expect(res.status).toBe(401);
    expect(embed).not.toHaveBeenCalled();
  });
});

/** מציג את גוף השגיאה אם חיפוש באינטגרציה נכשל לפני בדיקת התוצאות. */
function assertSuccess(res: request.Response) {
  if (res.status !== 200) throw new Error(`Search returned ${res.status}: ${JSON.stringify(res.body)}`);
}
