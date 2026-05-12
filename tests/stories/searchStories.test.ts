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

const authed = (url: string) =>
  request(app).get(url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await cleanDb();
});

describe('GET /api/stories', () => {
  it('returns empty list when no stories exist', async () => {
    const res = await authed('/api/stories');

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

    const res = await authed('/api/stories');

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(3);
    expect(res.body.data.total).toBe(3);
  });

  it('filters by masechetId and returns only stories with that tractate reference', async () => {
    const topic = await seedTopic();
    const masechet = await seedMasechet({ name: 'בבא קמא' });
    const otherMasechet = await seedMasechet({ name: 'בבא מציעא' });
    const page = await seedShasPage(masechet.id, 7, 'a');
    const otherPage = await seedShasPage(otherMasechet.id, 2, 'b');

    const storyWithRef = await seedStory(topic.id, { title: 'סיפור בבא קמא' });
    const storyOther = await seedStory(topic.id, { title: 'סיפור בבא מציעא' });
    await seedStory(topic.id, { title: 'סיפור ללא מסכת' });

    await linkStoryToShas(storyWithRef.id, page.id);
    await linkStoryToShas(storyOther.id, otherPage.id);

    const res = await authed(`/api/stories?masechetId=${masechet.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyWithRef.id);
  });

  it('filters by masechetId and daf', async () => {
    const topic = await seedTopic();
    const masechet = await seedMasechet();
    const daf7 = await seedShasPage(masechet.id, 7, 'a');
    const daf10 = await seedShasPage(masechet.id, 10, 'b');

    const storyDaf7 = await seedStory(topic.id);
    const storyDaf10 = await seedStory(topic.id);

    await linkStoryToShas(storyDaf7.id, daf7.id);
    await linkStoryToShas(storyDaf10.id, daf10.id);

    const res = await authed(`/api/stories?masechetId=${masechet.id}&daf=7`);

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyDaf7.id);
  });

  it('filters by Shulchan Aruch siman', async () => {
    const topic = await seedTopic();
    const section = await seedShuSection('אורח חיים');
    const siman328 = await seedShuSiman(section.id, 328, 'הלכות שבת');
    const siman1 = await seedShuSiman(section.id, 1);

    const storySiman328 = await seedStory(topic.id, { title: 'הלכות שבת - סימן שכח' });
    const storyOther = await seedStory(topic.id);

    await linkStoryToShu(storySiman328.id, siman328.id, 2);
    await linkStoryToShu(storyOther.id, siman1.id, 1);

    const res = await authed(`/api/stories?simanId=${siman328.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storySiman328.id);
  });

  it('filters by Shulchan Aruch section (shuSectionId)', async () => {
    const topic = await seedTopic();
    const sectionOC = await seedShuSection('אורח חיים');
    const sectionYD = await seedShuSection('יורה דעה');
    const simanOC = await seedShuSiman(sectionOC.id, 1);
    const simanYD = await seedShuSiman(sectionYD.id, 1);

    const storyOC = await seedStory(topic.id);
    const storyYD = await seedStory(topic.id);

    await linkStoryToShu(storyOC.id, simanOC.id, 1);
    await linkStoryToShu(storyYD.id, simanYD.id, 1);

    const res = await authed(`/api/stories?shuSectionId=${sectionOC.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyOC.id);
  });

  it('filters by concept tag (conceptsAi)', async () => {
    const topic = await seedTopic();
    const storyWithConcept = await seedStory(topic.id, { conceptsAi: ['ריבית', 'הלוואה'] });
    await seedStory(topic.id, { conceptsAi: ['גנבה'] });
    await seedStory(topic.id);

    const res = await authed('/api/stories?concept=ריבית');

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(storyWithConcept.id);
  });

  it('filters by concept tag from conceptsFromIndex', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { conceptsFromIndex: ['כיבוד אב'] });
    await seedStory(topic.id, { conceptsAi: ['גנבה'] });

    const res = await authed('/api/stories?concept=כיבוד אב');

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(story.id);
  });

  it('searches by text using ILIKE fallback (no vector embedding in test env)', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { title: 'מעשה בסוחר ירושלמי' });
    await seedStory(topic.id, { title: 'עניין אחר לגמרי' });

    const res = await authed('/api/stories?q=סוחר ירושלמי');

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(story.id);
  });

  it('text search is case-insensitive', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { title: 'הלכות שבת ויום טוב' });

    const res = await authed('/api/stories?q=שבת');

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].id).toBe(story.id);
  });

  it('paginates results correctly', async () => {
    const topic = await seedTopic();
    for (let i = 0; i < 25; i++) {
      await seedStory(topic.id);
    }

    const page1 = await authed('/api/stories?limit=10&page=1');
    expect(page1.status).toBe(200);
    expect(page1.body.data.stories).toHaveLength(10);
    expect(page1.body.data.total).toBe(25);
    expect(page1.body.data.page).toBe(1);

    const page2 = await authed('/api/stories?limit=10&page=2');
    expect(page2.body.data.stories).toHaveLength(10);

    const page3 = await authed('/api/stories?limit=10&page=3');
    expect(page3.body.data.stories).toHaveLength(5);
  });

  it('returns 422 when query params are invalid', async () => {
    const res = await authed('/api/stories?masechetId=not-a-uuid');

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/stories');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
