import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
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

async function createReader() {
  return prisma.user.create({
    data: {
      googleId: `google-${uuidv4()}`,
      email: `${uuidv4()}@test.com`,
      firstName: 'Test',
      lastName: 'Reader',
      phone: '0501234567',
    },
    select: { id: true },
  });
}

beforeEach(async () => {
  await cleanDb();
});

describe('GET /api/stories/:id', () => {
  it('returns a story with all fields and references', async () => {
    const topic = await seedTopic({ name: 'נזיקין' });
    const masechet = await seedMasechet({ name: 'בבא קמא' });
    const shasPage = await seedShasPage(masechet.id, 7, 'a');
    const section = await seedShuSection('חושן משפט');
    const siman = await seedShuSiman(section.id, 183, 'דיני גנבה');

    const story = await seedStory(topic.id, {
      title: 'מעשה בגנב שנכנס לחצר',
      expansion: 'הרחבה מפורטת על הדין',
      conceptsAi: ['גנבה', 'נזיקין'],
    });

    await linkStoryToShas(story.id, shasPage.id);
    await linkStoryToShu(story.id, siman.id, 3);

    const res = await authed(`/api/stories/${story.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.id).toBe(story.id);
    expect(data.title).toBe('מעשה בגנב שנכנס לחצר');
    expect(data.expansion).toBeNull();
    expect(data.hasExpansion).toBe(true);
    expect(data.topic.name).toBe('נזיקין');

    // Shas reference is populated
    expect(data.shasRefs).toHaveLength(1);
    expect(data.shasRefs[0].shasPage.daf).toBe(7);
    expect(data.shasRefs[0].shasPage.masechet.name).toBe('בבא קמא');

    // Shu reference is populated
    expect(data.shuRefs).toHaveLength(1);
    expect(data.shuRefs[0].shuSiman.siman).toBe(183);
    expect(data.shuRefs[0].shuSiman.section.name).toBe('חושן משפט');
    expect(data.shuRefs[0].seif).toBe(3);

    // Neighbors are included
    expect(data.neighbors).toBeDefined();
    expect(data.neighbors.prev).toBeNull();
    expect(data.neighbors.next).toBeNull();
  });

  it('returns the expansion for a registered reader', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, { expansion: 'הרחבה זמינה' });
    const reader = await createReader();

    try {
      const res = await authed(`/api/stories/${story.id}`).set('x-story-reader-id', reader.id);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body.data.hasExpansion).toBe(true);
      expect(res.body.data.expansion).toBe('הרחבה זמינה');
    } finally {
      await prisma.user.delete({ where: { id: reader.id } });
    }
  });

  it('redacts expansion and derived search text for an unknown reader', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id, {
      expansion: 'הרחבה זמינה',
      searchText: 'הרחבה זמינה',
      summaryAi: 'הרחבה זמינה',
    });
    const res = await authed(`/api/stories/${story.id}`).set('x-story-reader-id', uuidv4());
    expect(res.status).toBe(200);
    expect(res.body.data.hasExpansion).toBe(true);
    expect(res.body.data.expansion).toBeNull();
    expect(res.body.data).not.toHaveProperty('searchText');
    expect(res.body.data).not.toHaveProperty('summaryAi');
  });

  it('returns null expansion when not set', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id);

    const res = await authed(`/api/stories/${story.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.expansion).toBeNull();
    expect(res.body.data.hasExpansion).toBe(false);
  });

  it('returns 404 when story does not exist', async () => {
    const res = await authed(`/api/stories/${uuidv4()}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when id is not a valid UUID', async () => {
    const res = await authed('/api/stories/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 without api-secret header', async () => {
    const topic = await seedTopic();
    const story = await seedStory(topic.id);

    const res = await request(app).get(`/api/stories/${story.id}`).set('x-story-reader-id', uuidv4());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
