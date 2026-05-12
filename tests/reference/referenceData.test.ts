import request from 'supertest';
import { app } from '../../src/app';
import { cache } from '../../src/lib/cache';
import {
  cleanDb,
  seedTopic,
  seedStory,
  seedMasechet,
  seedShasPage,
  seedShuSection,
  seedShuSiman,
} from '../helpers/seed';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (url: string) =>
  request(app).get(url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await cleanDb();
  cache.clear();
});

describe('GET /api/reference/masechtot', () => {
  it('returns all tractates sorted by orderIndex', async () => {
    await seedMasechet({ name: 'בבא קמא', orderIndex: 2 });
    await seedMasechet({ name: 'ברכות', orderIndex: 1 });
    await seedMasechet({ name: 'סנהדרין', orderIndex: 3 });

    const res = await authed('/api/reference/masechtot');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].name).toBe('ברכות');
    expect(res.body.data[1].name).toBe('בבא קמא');
    expect(res.body.data[2].name).toBe('סנהדרין');
  });

  it('returns empty array when no tractates exist', async () => {
    const res = await authed('/api/reference/masechtot');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/reference/masechtot');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/masechtot/:id/pages', () => {
  it('returns pages for a tractate sorted by daf then amud', async () => {
    const masechet = await seedMasechet({ name: 'שבת' });
    await seedShasPage(masechet.id, 10, 'b');
    await seedShasPage(masechet.id, 5, 'a');
    await seedShasPage(masechet.id, 5, 'b');

    const res = await authed(`/api/reference/masechtot/${masechet.id}/pages`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toMatchObject({ daf: 5, amud: 'a' });
    expect(res.body.data[1]).toMatchObject({ daf: 5, amud: 'b' });
    expect(res.body.data[2]).toMatchObject({ daf: 10, amud: 'b' });
  });

  it('returns empty array for tractate with no pages', async () => {
    const masechet = await seedMasechet();
    const res = await authed(`/api/reference/masechtot/${masechet.id}/pages`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await authed('/api/reference/masechtot/not-a-uuid/pages');
    expect(res.status).toBe(400);
  });

  it('returns 401 without api-secret header', async () => {
    const masechet = await seedMasechet();
    const res = await request(app).get(`/api/reference/masechtot/${masechet.id}/pages`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/shu-sections', () => {
  it('returns sections with nested simanim sorted by siman number', async () => {
    const section = await seedShuSection('אורח חיים');
    await seedShuSiman(section.id, 328, 'הלכות שבת');
    await seedShuSiman(section.id, 1, 'יישכיל אדם');

    const res = await authed('/api/reference/shu-sections');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('אורח חיים');
    expect(res.body.data[0].simanim).toHaveLength(2);
    expect(res.body.data[0].simanim[0].siman).toBe(1);
    expect(res.body.data[0].simanim[1].siman).toBe(328);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/reference/shu-sections');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/shu-sections/:sectionId/simanim', () => {
  it('returns simanim for a section sorted by siman number', async () => {
    const section = await seedShuSection('יורה דעה');
    const other = await seedShuSection('חושן משפט');
    await seedShuSiman(section.id, 87);
    await seedShuSiman(section.id, 1);
    await seedShuSiman(other.id, 1);

    const res = await authed(`/api/reference/shu-sections/${section.id}/simanim`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].siman).toBe(1);
    expect(res.body.data[1].siman).toBe(87);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await authed('/api/reference/shu-sections/not-a-uuid/simanim');
    expect(res.status).toBe(400);
  });

  it('returns 401 without api-secret header', async () => {
    const section = await seedShuSection();
    const res = await request(app).get(`/api/reference/shu-sections/${section.id}/simanim`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/topics', () => {
  it('returns topics sorted by bookNumber then orderIndex', async () => {
    await seedTopic({ bookNumber: 2, name: 'שבת', orderIndex: 1 });
    await seedTopic({ bookNumber: 1, name: 'נזיקין', orderIndex: 2 });
    await seedTopic({ bookNumber: 1, name: 'ברכות', orderIndex: 1 });

    const res = await authed('/api/reference/topics');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].name).toBe('ברכות');
    expect(res.body.data[1].name).toBe('נזיקין');
    expect(res.body.data[2].name).toBe('שבת');
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/reference/topics');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/concepts', () => {
  it('returns distinct sorted concepts from stories', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id, { conceptsAi: ['ריבית', 'גנבה'] });
    await seedStory(topic.id, { conceptsAi: ['גנבה'], conceptsFromIndex: ['כיבוד אב'] });

    const res = await authed('/api/reference/concepts');

    expect(res.status).toBe(200);
    const concepts: string[] = res.body.data;
    expect(concepts).toContain('ריבית');
    expect(concepts).toContain('גנבה');
    expect(concepts).toContain('כיבוד אב');
    // 'גנבה' appears twice in DB but should appear once
    expect(concepts.filter((c) => c === 'גנבה')).toHaveLength(1);
  });

  it('returns empty array when no stories have concepts', async () => {
    const topic = await seedTopic();
    await seedStory(topic.id);

    const res = await authed('/api/reference/concepts');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/reference/concepts');
    expect(res.status).toBe(401);
  });
});
