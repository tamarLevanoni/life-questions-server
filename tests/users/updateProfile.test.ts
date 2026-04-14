import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string) =>
  request(app)[method](url).set('x-api-secret', SECRET);

const createUser = (overrides = {}) =>
  prisma.user.create({
    data: {
      id: uuidv4(),
      email: `update-${uuidv4()}@test.com`,
      firstName: 'Original',
      lastName: 'User',
      phone: '0501234567',
      ...overrides,
    },
  });

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe('PATCH /api/users/profile/:id', () => {
  it('updates institutionName and occupations', async () => {
    const user = await createUser();

    const res = await authed('patch', `/api/users/profile/${user.id}`)
      .send({ institutionName: 'New University', occupations: ['educator'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.institutionName).toBe('New University');
    expect(res.body.data.occupations).toContain('educator');

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser!.institutionName).toBe('New University');
  });

  it('supports partial update — only firstName, leaving other fields unchanged', async () => {
    const user = await createUser({ institutionName: 'Keep This', lastName: 'KeepLast' });

    const res = await authed('patch', `/api/users/profile/${user.id}`)
      .send({ firstName: 'NewFirst' });

    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('NewFirst');
    expect(res.body.data.lastName).toBe('KeepLast');
    expect(res.body.data.institutionName).toBe('Keep This');
  });

  it('clears a nullable field when set to null', async () => {
    const user = await createUser({ institutionName: 'To Be Cleared' });

    const res = await authed('patch', `/api/users/profile/${user.id}`)
      .send({ institutionName: null });

    expect(res.status).toBe(200);
    expect(res.body.data.institutionName).toBeNull();

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser!.institutionName).toBeNull();
  });

  it('returns 404 for a non-existent user', async () => {
    const res = await authed('patch', `/api/users/profile/${uuidv4()}`)
      .send({ firstName: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for a malformed (non-UUID) id', async () => {
    const res = await authed('patch', '/api/users/profile/not-a-uuid')
      .send({ firstName: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 for an invalid occupation enum value', async () => {
    const user = await createUser();

    const res = await authed('patch', `/api/users/profile/${user.id}`)
      .send({ occupations: ['invalid-role'] });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is missing', async () => {
    const user = await createUser();

    const res = await request(app)
      .patch(`/api/users/profile/${user.id}`)
      .send({ firstName: 'Hacker' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is incorrect', async () => {
    const user = await createUser();

    const res = await request(app)
      .patch(`/api/users/profile/${user.id}`)
      .set('x-api-secret', 'wrong')
      .send({ firstName: 'Hacker' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
