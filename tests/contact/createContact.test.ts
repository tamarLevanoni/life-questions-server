import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

jest.mock('../../src/lib/resend', () => ({
  sendContactEmail: jest.fn().mockResolvedValue(undefined),
}));

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (url: string) => request(app).post(url).set('x-api-secret', SECRET);

const makePayload = (overrides = {}) => ({
  name: 'ישראל ישראלי',
  email: 'israel@example.com',
  category: 'general',
  subject: 'שאלה לגבי תכנים',
  message: 'שלום, אני רוצה לשאול שאלה חשובה לגבי התכנים',
  ...overrides,
});

beforeEach(async () => {
  await prisma.contactMessage.deleteMany();
});

describe('POST /api/contact', () => {
  it('saves message and returns 201', async () => {
    const payload = makePayload();

    const res = await authed('/api/contact').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(payload.name);
    expect(res.body.data.email).toBe(payload.email);
    expect(res.body.data.category).toBe(payload.category);

    const record = await prisma.contactMessage.findFirst();
    expect(record).not.toBeNull();
    expect(record!.subject).toBe(payload.subject);
  });

  it('saves pageUrl when provided', async () => {
    const payload = makePayload({ category: 'bug', pageUrl: 'https://life-questions.app/stories/123' });

    const res = await authed('/api/contact').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.pageUrl).toBe(payload.pageUrl);
  });

  it('returns 422 when name is too short', async () => {
    const res = await authed('/api/contact').send(makePayload({ name: 'א' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when email is invalid', async () => {
    const res = await authed('/api/contact').send(makePayload({ email: 'not-an-email' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when category is invalid', async () => {
    const res = await authed('/api/contact').send(makePayload({ category: 'unknown' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when message is too short', async () => {
    const res = await authed('/api/contact').send(makePayload({ message: 'קצר' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is missing', async () => {
    const res = await request(app).post('/api/contact').send(makePayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('saves story_question with storyId and returns 201', async () => {
    const payload = makePayload({
      category: 'story_question',
      story: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'סיפור על שבת',
        storyBody: 'היה היה סיפור...',
        legalQuestion: 'האם מותר לעשות X?',
        shortAnswer: 'מותר משום שY',
      },
    });

    const res = await authed('/api/contact').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.storyId).toBe(payload.story.id);

    const record = await prisma.contactMessage.findFirst();
    expect(record!.storyId).toBe(payload.story.id);
  });

  it('returns 422 when story_question is missing required story fields', async () => {
    const res = await authed('/api/contact').send(
      makePayload({ category: 'story_question' })
    );

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is incorrect', async () => {
    const res = await request(app)
      .post('/api/contact')
      .set('x-api-secret', 'wrong-secret')
      .send(makePayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
