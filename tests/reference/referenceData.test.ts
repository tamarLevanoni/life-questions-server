import request from 'supertest';
import { app } from '../../src/app';
import { cache } from '../../src/lib/cache';
import {
  cleanDb,
  seedBook,
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

// cache.clear() runs first so it always executes even if cleanDb throws
beforeEach(async () => {
  cache.clear();
  await cleanDb();
});

describe('GET /api/reference/books', () => {
  it('returns books sorted alphabetically by name', async () => {
    const b1 = await seedBook('ג-שלישי');
    const b2 = await seedBook('א-ראשון');
    const b3 = await seedBook('ב-שני');

    const res = await authed('/api/reference/books');

    expect(res.status).toBe(200);
    const ids = new Set([b1.id, b2.id, b3.id]);
    const seeded: { id: string; name: string }[] =
      res.body.data.filter((b: { id: string }) => ids.has(b.id));

    expect(seeded).toHaveLength(3);
    expect(seeded[0].name).toBe('א-ראשון');
    expect(seeded[1].name).toBe('ב-שני');
    expect(seeded[2].name).toBe('ג-שלישי');
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/reference/books');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/masechtot', () => {
  it('returns all tractates sorted by orderIndex with nested pages', async () => {
    const m1 = await seedMasechet({ name: 'בבא קמא', orderIndex: 2 });
    const m2 = await seedMasechet({ name: 'ברכות', orderIndex: 1 });
    const m3 = await seedMasechet({ name: 'סנהדרין', orderIndex: 3 });
    await seedShasPage(m2.id, 2, 'a');
    await seedShasPage(m2.id, 2, 'b');
    await seedShasPage(m2.id, 10, 'a');

    const res = await authed('/api/reference/masechtot');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const ids = new Set([m1.id, m2.id, m3.id]);
    const seeded: { id: string; name: string; orderIndex: number; pages: { daf: number; amud: string }[] }[] =
      res.body.data.filter((m: { id: string }) => ids.has(m.id));

    expect(seeded).toHaveLength(3);
    expect(seeded[0].name).toBe('ברכות');
    expect(seeded[1].name).toBe('בבא קמא');
    expect(seeded[2].name).toBe('סנהדרין');

    // pages are nested and sorted
    expect(seeded[0].pages).toHaveLength(3);
    expect(seeded[0].pages[0]).toMatchObject({ daf: 2, amud: 'a' });
    expect(seeded[0].pages[1]).toMatchObject({ daf: 2, amud: 'b' });
    expect(seeded[0].pages[2]).toMatchObject({ daf: 10, amud: 'a' });

    // tractates without pages return empty array
    expect(seeded[1].pages).toHaveLength(0);
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

describe('GET /api/reference/shu-sections', () => {
  it('returns sections with nested simanim sorted by siman number', async () => {
    const section = await seedShuSection('אורח חיים');
    await seedShuSiman(section.id, 328, 'הלכות שבת');
    await seedShuSiman(section.id, 1, 'יישכיל אדם');

    const res = await authed('/api/reference/shu-sections');

    expect(res.status).toBe(200);

    const seeded: { id: string; name: string; simanim: unknown[] }[] =
      res.body.data.filter((s: { id: string }) => s.id === section.id);

    expect(seeded).toHaveLength(1);
    expect(seeded[0].name).toBe('אורח חיים');
    expect(seeded[0].simanim).toHaveLength(2);
    expect((seeded[0].simanim[0] as { siman: number }).siman).toBe(1);
    expect((seeded[0].simanim[1] as { siman: number }).siman).toBe(328);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/reference/shu-sections');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reference/topics', () => {
  it('returns topics sorted by book name then orderIndex', async () => {
    const bookA = await seedBook('A-first-book');
    const bookB = await seedBook('B-second-book');

    const t1 = await seedTopic({ bookId: bookB.id, name: 'שבת', orderIndex: 1 });
    const t2 = await seedTopic({ bookId: bookA.id, name: 'נזיקין', orderIndex: 2 });
    const t3 = await seedTopic({ bookId: bookA.id, name: 'ברכות', orderIndex: 1 });

    const res = await authed('/api/reference/topics');

    expect(res.status).toBe(200);

    const ids = new Set([t1.id, t2.id, t3.id]);
    const seeded: { id: string; name: string }[] =
      res.body.data.filter((t: { id: string }) => ids.has(t.id));

    expect(seeded).toHaveLength(3);
    expect(seeded[0].name).toBe('ברכות');   // bookA, orderIndex 1
    expect(seeded[1].name).toBe('נזיקין');  // bookA, orderIndex 2
    expect(seeded[2].name).toBe('שבת');     // bookB, orderIndex 1
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
    // 'גנבה' appears in two stories but must appear once
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
