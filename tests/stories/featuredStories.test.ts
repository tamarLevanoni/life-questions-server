import request from 'supertest';
import { app } from '../../src/app';
import { cleanDb, seedTopic, seedStory } from '../helpers/seed';

const SECRET = process.env.API_SECRET ?? 'test-secret';

// שולח בקשת בדיקה עם מפתח השרת כדי לבדוק את בחירת הדוגמאות.
const authed = (url: string) => request(app).get(url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await cleanDb();
});

describe('GET /api/stories/featured', () => {
  it('returns 3 random full stories when the DB has more than 3', async () => {
    const topic = await seedTopic({ name: 'נזיקין' });
    for (let i = 0; i < 6; i++) {
      await seedStory(topic.id, { title: `סיפור ${i}`, expansion: `הרחבה ${i}` });
    }

    const res = await authed('/api/stories/featured');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);

    for (const story of res.body.data) {
      expect(story.id).toBeDefined();
      expect(story.title).toBeDefined();
      expect(story.storyBody).toBeDefined();
      expect(story.shortAnswer).toBeDefined();
      expect(story.expansion).toBeNull();
      expect(story.hasExpansion).toBe(true);
      expect(story.topic).toBeDefined();
      expect(story.topic.name).toBe('נזיקין');
      expect(Array.isArray(story.shasRefs)).toBe(true);
      expect(Array.isArray(story.shuRefs)).toBe(true);
      expect(story.neighbors).toBeUndefined();
    }
  });

  it('returns all available stories when DB has fewer than 3', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id);
    await seedStory(topic.id);

    const res = await authed('/api/stories/featured');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns an empty array when no stories exist', async () => {
    const res = await authed('/api/stories/featured');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/stories/featured');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
