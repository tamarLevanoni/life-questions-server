import request from 'supertest';
import { app } from '../../src/app';
import { cleanDb, seedTopic, seedStory } from '../helpers/seed';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (url: string) => request(app).get(url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await cleanDb();
});

describe('GET /api/stories/weekly', () => {
  it('returns a story that has a video', async () => {
    const topic = await seedTopic({ name: 'נזיקין' });
    await seedStory(topic.id, { title: 'ללא וידאו' });
    const withVideo = await seedStory(topic.id, { title: 'עם וידאו', videoUrl: 'https://example.com/video.mp4' });

    const res = await authed('/api/stories/weekly');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(withVideo.id);
    expect(res.body.data.videoUrl).toBe('https://example.com/video.mp4');
    expect(res.body.data.topic).toBeDefined();
    expect(res.body.data.topic.name).toBe('נזיקין');
    expect(Array.isArray(res.body.data.shasRefs)).toBe(true);
    expect(Array.isArray(res.body.data.shuRefs)).toBe(true);
    expect(res.body.data.neighbors).toBeUndefined();
  });

  it('is deterministic: returns the same story on repeated calls within the same week', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id, { videoUrl: 'https://example.com/1.mp4' });
    await seedStory(topic.id, { videoUrl: 'https://example.com/2.mp4' });
    await seedStory(topic.id, { videoUrl: 'https://example.com/3.mp4' });

    const first = await authed('/api/stories/weekly');
    const second = await authed('/api/stories/weekly');

    expect(first.body.data.id).toBe(second.body.data.id);
  });

  it('returns null when no story has a video', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id);

    const res = await authed('/api/stories/weekly');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/stories/weekly');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
