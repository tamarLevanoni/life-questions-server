import request from 'supertest';
import { app } from '../../src/app';
import { cleanDb, seedStory, seedTopic } from '../helpers/seed';

// מבקש עמוד ממפת האתר עם מפתח שרת ומאפשר להחליף את הפרמטרים בכל בדיקה.
const list = (query: object = {}) => request(app)
  .get('/api/stories/sitemap')
  .set('x-api-secret', process.env.API_SECRET ?? 'test-secret')
  .query(query);

it('returns only story IDs in stable, numbered pages for the sitemap', async () => {
  await cleanDb();
  const topic = await seedTopic();
  const first = await seedStory(topic.id, { storyOrder: 1 });
  const second = await seedStory(topic.id, { storyOrder: 2 });

  const pageOne = await list({ page: 1, limit: 1 }).expect(200);
  expect(pageOne.body.data).toEqual({ stories: [{ id: first.id }], hasMore: true });

  const pageTwo = await list({ page: 2, limit: 1 }).expect(200);
  expect(pageTwo.body.data).toEqual({ stories: [{ id: second.id }], hasMore: false });
});

it.each([{ page: 0 }, { page: 1.5 }, { limit: 51 }, { q: 'search' }])(
  'rejects parameters outside the sitemap listing contract: %j',
  async (query) => {
    await list(query).expect(422);
  },
);

it('requires the API secret to list story IDs', async () => {
  await request(app).get('/api/stories/sitemap').expect(401);
});
