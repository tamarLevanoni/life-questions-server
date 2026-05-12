import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { cleanDb, seedTopic, seedStory } from '../helpers/seed';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (url: string) =>
  request(app).get(url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await cleanDb();
});

describe('GET /api/stories/:id/neighbors', () => {
  it('returns prev and next for a middle story', async () => {
    const topic = await seedTopic();
    const s1 = await seedStory(topic.id, { bookNumber: 1, storyOrder: 10, title: 'ראשון' });
    const s2 = await seedStory(topic.id, { bookNumber: 1, storyOrder: 20, title: 'אמצעי' });
    const s3 = await seedStory(topic.id, { bookNumber: 1, storyOrder: 30, title: 'אחרון' });

    const res = await authed(`/api/stories/${s2.id}/neighbors`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prev).toMatchObject({ id: s1.id, title: 'ראשון' });
    expect(res.body.data.next).toMatchObject({ id: s3.id, title: 'אחרון' });
  });

  it('returns null prev for the first story', async () => {
    const topic = await seedTopic();
    const s1 = await seedStory(topic.id, { bookNumber: 1, storyOrder: 10 });
    await seedStory(topic.id, { bookNumber: 1, storyOrder: 20 });

    const res = await authed(`/api/stories/${s1.id}/neighbors`);

    expect(res.status).toBe(200);
    expect(res.body.data.prev).toBeNull();
    expect(res.body.data.next).not.toBeNull();
  });

  it('returns null next for the last story', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id, { bookNumber: 1, storyOrder: 10 });
    const s2 = await seedStory(topic.id, { bookNumber: 1, storyOrder: 20 });

    const res = await authed(`/api/stories/${s2.id}/neighbors`);

    expect(res.status).toBe(200);
    expect(res.body.data.prev).not.toBeNull();
    expect(res.body.data.next).toBeNull();
  });

  it('returns both null for a sole story in the book', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { bookNumber: 1, storyOrder: 10 });

    const res = await authed(`/api/stories/${story.id}/neighbors`);

    expect(res.status).toBe(200);
    expect(res.body.data.prev).toBeNull();
    expect(res.body.data.next).toBeNull();
  });

  it('does not cross book boundaries', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id, { bookNumber: 1, storyOrder: 10 });
    const story = await seedStory(topic.id, { bookNumber: 2, storyOrder: 20 });
    await seedStory(topic.id, { bookNumber: 3, storyOrder: 30 });

    const res = await authed(`/api/stories/${story.id}/neighbors`);

    expect(res.status).toBe(200);
    expect(res.body.data.prev).toBeNull();
    expect(res.body.data.next).toBeNull();
  });

  it('returns 404 for a non-existent story', async () => {
    const res = await authed(`/api/stories/${uuidv4()}/neighbors`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for an invalid UUID', async () => {
    const res = await authed('/api/stories/not-a-uuid/neighbors');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 without api-secret header', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id);

    const res = await request(app).get(`/api/stories/${story.id}/neighbors`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
