import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (method: 'get' | 'post' | 'patch', url: string) =>
  request(app)[method](url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe('GET /api/users/google/:googleId', () => {
  it('returns the user for an existing googleId', async () => {
    const googleId = `google-${uuidv4()}`;
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        googleId,
        email: `user-${uuidv4()}@test.com`,
        firstName: 'Test',
        lastName: 'User',
        phone: '0501234567',
      },
    });

    const res = await authed('get', `/api/users/google/${googleId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(user.id);
    expect(res.body.data.googleId).toBe(googleId);
  });

  it('returns 404 for a googleId that does not exist', async () => {
    const res = await authed('get', '/api/users/google/nonexistent-google-id');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is missing', async () => {
    const res = await request(app).get('/api/users/google/some-google-id');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is incorrect', async () => {
    const res = await request(app)
      .get('/api/users/google/some-google-id')
      .set('x-api-secret', 'wrong-secret');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
