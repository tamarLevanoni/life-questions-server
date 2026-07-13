import request from 'supertest';
import { app } from '../../src/app';
import { cache } from '../../src/lib/cache';

const SECRET = process.env.API_SECRET ?? 'test-secret';

const authed = (url: string) => request(app).get(url).set('x-api-secret', SECRET);

const mockCloudinaryResponse = (resources: { public_id: string; format: string }[]) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => ({ resources }),
});

beforeEach(() => {
  cache.clear();
  jest.spyOn(global, 'fetch').mockResolvedValue(mockCloudinaryResponse([
    { public_id: 'stories-app/recommendations/Sefer_Example', format: 'jpg' },
  ]) as unknown as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/recommendations', () => {
  it('returns recommendations mapped from Cloudinary resources', async () => {
    const res = await authed('/api/recommendations');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      name: 'Sefer Example',
      url: expect.stringContaining('/image/upload/stories-app/recommendations/Sefer_Example.jpg'),
    });
  });

  it('caches results and does not call fetch again on second request', async () => {
    await authed('/api/recommendations');
    await authed('/api/recommendations');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 401 without api-secret header', async () => {
    const res = await request(app).get('/api/recommendations');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
