import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string) =>
  request(app)[method](url).set('x-api-secret', SECRET);

const makeUser = (overrides = {}) => ({
  id: uuidv4(),
  email: `user-${uuidv4()}@test.com`,
  firstName: 'Test',
  lastName: 'User',
  phone: '0501234567',
  ...overrides,
});

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe('POST /api/users/sync', () => {
  it('creates a new user when the email does not exist', async () => {
    const payload = makeUser();

    const res = await authed('post', '/api/users/sync').send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(payload.email);
    expect(res.body.data.firstName).toBe(payload.firstName);

    const dbUser = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.id).toBe(payload.id);
  });

  it('updates firstName and lastName on re-sync for an existing email', async () => {
    const payload = makeUser({ firstName: 'Original', lastName: 'Name' });
    await authed('post', '/api/users/sync').send(payload);

    const updatedPayload = { ...payload, firstName: 'Updated', lastName: 'Person' };
    const res = await authed('post', '/api/users/sync').send(updatedPayload);

    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('Updated');
    expect(res.body.data.lastName).toBe('Person');
  });

  it('does not overwrite user-controlled fields on re-sync', async () => {
    const payload = makeUser({ institutionName: 'My University', occupations: ['educator'] });
    await authed('post', '/api/users/sync').send(payload);

    const resync = await authed('post', '/api/users/sync').send({
      id: payload.id,
      email: payload.email,
      firstName: 'New',
      lastName: 'Name',
      phone: payload.phone,
    });

    expect(resync.status).toBe(200);
    const dbUser = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(dbUser!.institutionName).toBe('My University');
    expect(dbUser!.occupations).toContain('educator');
  });

  it('returns 401 when x-api-secret header is missing', async () => {
    const res = await request(app).post('/api/users/sync').send(makeUser());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when x-api-secret header is incorrect', async () => {
    const res = await request(app)
      .post('/api/users/sync')
      .set('x-api-secret', 'wrong-secret')
      .send(makeUser());

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when required fields are missing', async () => {
    const res = await authed('post', '/api/users/sync').send({ firstName: 'Missing', lastName: 'Email' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when phone is missing', async () => {
    const { phone: _phone, ...withoutPhone } = makeUser();
    const res = await authed('post', '/api/users/sync').send(withoutPhone);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when email is invalid', async () => {
    const res = await authed('post', '/api/users/sync').send(makeUser({ email: 'not-an-email' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when id is not a valid UUID', async () => {
    const res = await authed('post', '/api/users/sync').send(makeUser({ id: 'not-a-uuid' }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});
