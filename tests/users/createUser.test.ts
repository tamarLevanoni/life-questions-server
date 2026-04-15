import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (method: 'get' | 'post' | 'patch', url: string) =>
  request(app)[method](url).set('x-api-secret', SECRET);

const makePayload = (overrides = {}) => ({
  googleId: `google-${uuidv4()}`,
  email: `user-${uuidv4()}@test.com`,
  firstName: 'Test',
  lastName: 'User',
  phone: '0501234567',
  ...overrides,
});

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe('POST /api/users', () => {
  it('creates a new user and returns 201', async () => {
    const payload = makePayload();

    const res = await authed('post', '/api/users').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(payload.email);
    expect(res.body.data.firstName).toBe(payload.firstName);

    const dbUser = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.id).toBeDefined();
  });

  it('returns 409 when email already exists', async () => {
    const payload = makePayload();
    await authed('post', '/api/users').send(payload);

    const res = await authed('post', '/api/users').send(payload);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when required fields are missing', async () => {
    const res = await authed('post', '/api/users').send({ email: 'missing@test.com' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when email is invalid', async () => {
    const res = await authed('post', '/api/users').send(makePayload({ email: 'not-an-email' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is missing', async () => {
    const res = await request(app).post('/api/users').send(makePayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is incorrect', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('x-api-secret', 'wrong-secret')
      .send(makePayload());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
