import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string) =>
  request(app)[method](url).set('x-api-secret', SECRET);

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe('GET /api/users/profile/:id', () => {
  it('returns full profile for an existing user', async () => {
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: 'profile@test.com',
        firstName: 'Profile',
        lastName: 'Test',
        phone: '0501234567',
        institutionName: 'Test University',
        occupations: ['educator', 'jurist'],
        marketingConsent: false,
      },
    });

    const res = await authed('get', `/api/users/profile/${user.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(user.id);
    expect(res.body.data.email).toBe('profile@test.com');
    expect(res.body.data.institutionName).toBe('Test University');
    expect(res.body.data.occupations).toContain('educator');
    expect(res.body.data.marketingConsent).toBe(false);
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const res = await authed('get', `/api/users/profile/${uuidv4()}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for a malformed (non-UUID) id', async () => {
    const res = await authed('get', '/api/users/profile/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is missing', async () => {
    const res = await request(app).get(`/api/users/profile/${uuidv4()}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is incorrect', async () => {
    const res = await request(app)
      .get(`/api/users/profile/${uuidv4()}`)
      .set('x-api-secret', 'bad-secret');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
