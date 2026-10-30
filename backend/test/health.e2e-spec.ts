import request from 'supertest';
import { createTestApp, type TestApp } from './utils/test-app.js';

describe('Health & app foundation (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /api/v1/health reports the database as up, without auth', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('echoes a request id header', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'trace-123');

    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('returns the consistent error shape for unknown routes', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: expect.any(String),
      path: '/api/v1/does-not-exist',
      timestamp: expect.any(String),
    });
  });

  it('serves the Swagger document', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.components.securitySchemes).toHaveProperty('bearer');
  });
});
