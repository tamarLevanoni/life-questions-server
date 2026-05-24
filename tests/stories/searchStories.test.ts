import request from 'supertest';
import { app } from '../../src/app';
import {
  cleanDb,
  seedTopic,
  seedStory,
  seedMasechet,
  seedShasPage,
  seedShuSection,
  seedShuSiman,
  linkStoryToShas,
  linkStoryToShu,
} from '../helpers/seed';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const search = (body: object = {}) =>
  request(app)
    .post('/api/stories/search')
    .set('x-api-secret', SECRET)
    .send(body);

beforeEach(async () => {
  await cleanDb();
});

describe('POST /api/stories/search', () => {
  it('returns empty list when no stories exist', async () => {
    const res = await search();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stories).toHaveLength(0);
    expect(res.body.data.total).toBe(0);
  });

  it('returns all stories without filters', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id);
    await seedStory(topic.id);
    await seedStory(topic.id);

    const res = await search();

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(3);
    expect(res.body.data.total).toBe(3);
  });

  it('filters by a single bookId', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id);

    const res = await search({ bookIds: [story.bookId] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories.every((s: { bookId: string }) => s.bookId === story.bookId)).toBe(true);
  });

  it('filters by multiple bookIds', async () => {
    const topic1 = await seedTopic();
    const topic2 = await seedTopic();
    const story1 = await seedStory(topic1.id);
    const story2 = await seedStory(topic2.id);

    const res = await search({ bookIds: [story1.bookId, story2.bookId] });

    expect(res.status).toBe(200);
    const ids = res.body.data.stories.map((s: { id: string }) => s.id);
    expect(ids).toContain(story1.id);
    expect(ids).toContain(story2.id);
  });

  it('filters by a single masechet', async () => {
    const topic = await seedTopic();
    const masechet = await seedMasechet({ name: 'בבא קמא' });
    const otherMasechet = await seedMasechet({ name: 'בבא מציעא' });
    const page = await seedShasPage(masechet.id, 7, 'a');
    const otherPage = await seedShasPage(otherMasechet.id, 2, 'b');

    const storyBK = await seedStory(topic.id, { title: 'בבא קמא' });
    const storyBM = await seedStory(topic.id, { title: 'בבא מציעא' });
    await seedStory(topic.id, { title: 'ללא מסכת' });

    await linkStoryToShas(storyBK.id, page.id);
    await linkStoryToShas(storyBM.id, otherPage.id);

    const res = await search({ shasRefs: [{ masechetId: masechet.id }] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyBK.id);
  });

  it('filters by multiple masechetim in shasRefs', async () => {
    const topic = await seedTopic();
    const masechet1 = await seedMasechet({ name: 'בבא קמא' });
    const masechet2 = await seedMasechet({ name: 'בבא מציעא' });
    const masechet3 = await seedMasechet({ name: 'סנהדרין' });
    const page1 = await seedShasPage(masechet1.id, 7, 'a');
    const page2 = await seedShasPage(masechet2.id, 3, 'b');
    const page3 = await seedShasPage(masechet3.id, 10, 'a');

    const story1 = await seedStory(topic.id);
    const story2 = await seedStory(topic.id);
    const story3 = await seedStory(topic.id);

    await linkStoryToShas(story1.id, page1.id);
    await linkStoryToShas(story2.id, page2.id);
    await linkStoryToShas(story3.id, page3.id);

    const res = await search({
      shasRefs: [{ masechetId: masechet1.id }, { masechetId: masechet2.id }],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(2);
    const ids = res.body.data.stories.map((s: { id: string }) => s.id);
    expect(ids).toContain(story1.id);
    expect(ids).toContain(story2.id);
    expect(ids).not.toContain(story3.id);
  });

  it('filters by masechet + daf', async () => {
    const topic = await seedTopic();
    const masechet = await seedMasechet();
    const daf7 = await seedShasPage(masechet.id, 7, 'a');
    const daf10 = await seedShasPage(masechet.id, 10, 'b');

    const storyDaf7 = await seedStory(topic.id);
    const storyDaf10 = await seedStory(topic.id);

    await linkStoryToShas(storyDaf7.id, daf7.id);
    await linkStoryToShas(storyDaf10.id, daf10.id);

    const res = await search({ shasRefs: [{ masechetId: masechet.id, daf: 7 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyDaf7.id);
  });

  it('filters by Shulchan Aruch section only (shuSectionId)', async () => {
    const topic = await seedTopic();
    const sectionOC = await seedShuSection('אורח חיים');
    const sectionYD = await seedShuSection('יורה דעה');
    const simanOC = await seedShuSiman(sectionOC.id, 1);
    const simanYD = await seedShuSiman(sectionYD.id, 1);

    const storyOC = await seedStory(topic.id);
    const storyYD = await seedStory(topic.id);

    await linkStoryToShu(storyOC.id, simanOC.id, 1);
    await linkStoryToShu(storyYD.id, simanYD.id, 1);

    const res = await search({ shuRefs: [{ shuSectionId: sectionOC.id }] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyOC.id);
  });

  it('filters by siman within a section', async () => {
    const topic = await seedTopic();
    const section = await seedShuSection('אורח חיים');
    const siman328 = await seedShuSiman(section.id, 328, 'הלכות שבת');
    const siman1 = await seedShuSiman(section.id, 1);

    const storySiman328 = await seedStory(topic.id);
    const storyOther = await seedStory(topic.id);

    await linkStoryToShu(storySiman328.id, siman328.id, 2);
    await linkStoryToShu(storyOther.id, siman1.id, 1);

    const res = await search({ shuRefs: [{ shuSectionId: section.id, simanId: siman328.id }] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storySiman328.id);
  });

  it('filters by siman + seif', async () => {
    const topic = await seedTopic();
    const section = await seedShuSection('חושן משפט');
    const siman = await seedShuSiman(section.id, 379);

    const storySeif1 = await seedStory(topic.id);
    const storySeif2 = await seedStory(topic.id);

    await linkStoryToShu(storySeif1.id, siman.id, 1);
    await linkStoryToShu(storySeif2.id, siman.id, 2);

    const res = await search({ shuRefs: [{ shuSectionId: section.id, simanId: siman.id, seif: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storySeif2.id);
  });

  it('filters by multiple shuRefs', async () => {
    const topic = await seedTopic();
    const section = await seedShuSection('חושן משפט');
    const siman1 = await seedShuSiman(section.id, 1);
    const siman2 = await seedShuSiman(section.id, 2);
    const siman3 = await seedShuSiman(section.id, 3);

    const story1 = await seedStory(topic.id);
    const story2 = await seedStory(topic.id);
    const story3 = await seedStory(topic.id);

    await linkStoryToShu(story1.id, siman1.id, 1);
    await linkStoryToShu(story2.id, siman2.id, 1);
    await linkStoryToShu(story3.id, siman3.id, 1);

    const res = await search({
      shuRefs: [
        { shuSectionId: section.id, simanId: siman1.id },
        { shuSectionId: section.id, simanId: siman2.id },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(2);
    const ids = res.body.data.stories.map((s: { id: string }) => s.id);
    expect(ids).toContain(story1.id);
    expect(ids).toContain(story2.id);
    expect(ids).not.toContain(story3.id);
  });

  it('returns 422 when seif is sent without simanId', async () => {
    const section = await seedShuSection('חושן משפט');
    const res = await search({ shuRefs: [{ shuSectionId: section.id, seif: 3 }] });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('filters by a single concept tag', async () => {
    const topic = await seedTopic();
    const storyWithConcept = await seedStory(topic.id, { conceptsAi: ['ריבית', 'הלוואה'] });
    await seedStory(topic.id, { conceptsAi: ['גנבה'] });
    await seedStory(topic.id);

    const res = await search({ concepts: ['ריבית'] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyWithConcept.id);
  });

  it('filters by multiple concepts — returns stories matching any of them', async () => {
    const topic = await seedTopic();
    const storyRibit = await seedStory(topic.id, { conceptsAi: ['ריבית'] });
    const storyGanav = await seedStory(topic.id, { conceptsAi: ['גנבה'] });
    await seedStory(topic.id, { conceptsAi: ['שבת'] });

    const res = await search({ concepts: ['ריבית', 'גנבה'] });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(2);
    const ids = res.body.data.stories.map((s: { id: string }) => s.id);
    expect(ids).toContain(storyRibit.id);
    expect(ids).toContain(storyGanav.id);
  });

  it('searches by text using ILIKE fallback (no vector embedding in test env)', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { title: 'מעשה בסוחר ירושלמי' });
    await seedStory(topic.id, { title: 'עניין אחר לגמרי' });

    const res = await search({ q: 'סוחר ירושלמי' });

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(story.id);
  });

  it('paginates results correctly', async () => {
    const topic = await seedTopic();
    for (let i = 0; i < 25; i++) {
      await seedStory(topic.id);
    }

    const page1 = await search({ limit: 10, page: 1 });
    expect(page1.status).toBe(200);
    expect(page1.body.data.stories).toHaveLength(10);
    expect(page1.body.data.total).toBe(25);
    expect(page1.body.data.page).toBe(1);

    const page2 = await search({ limit: 10, page: 2 });
    expect(page2.body.data.stories).toHaveLength(10);

    const page3 = await search({ limit: 10, page: 3 });
    expect(page3.body.data.stories).toHaveLength(5);
  });

  it('returns 422 when body contains invalid UUIDs', async () => {
    const res = await search({ shasRefs: [{ masechetId: 'not-a-uuid' }] });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).post('/api/stories/search').send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
