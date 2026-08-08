import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/bootstrap.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { createOpenApiDocument } from '../../src/openapi.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

const publicRoutes = new Set([
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/verify',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/recovery/start',
  'POST /api/v1/auth/recovery/complete',
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
  'GET /api/v1/metrics',
]);

const httpMethods = new Set(['get', 'post', 'patch', 'put', 'delete']);
const tenantRoutePrefixes = [
  '/api/v1/analytics',
  '/api/v1/artifacts',
  '/api/v1/audit',
  '/api/v1/capabilities',
  '/api/v1/devices',
  '/api/v1/distribution',
  '/api/v1/installations',
  '/api/v1/notifications',
  '/api/v1/projects',
  '/api/v1/publications',
  '/api/v1/spaces',
] as const;

function requestPath(path: string): string {
  return path.replaceAll(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000001');
}

describe('all API route authentication contracts', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const environment = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://capaport:capaport@127.0.0.1:5432/capaport-test',
      REDIS_URL: 'redis://127.0.0.1:6379/15',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'capaport-test',
      S3_ACCESS_KEY: 'capaport',
      S3_SECRET_KEY: 'capaport-test-secret',
      JWT_SECRET: 'capaport-test-jwt-secret-longer-than-32-characters',
      REFRESH_TOKEN_PEPPER: 'capaport-test-refresh-pepper-longer-than-32-characters',
      VERIFICATION_PEPPER: 'capaport-test-verification-pepper-longer-than-32-characters',
      SMTP_HOST: '127.0.0.1',
      SMTP_FROM: 'noreply@capaport.test',
    };
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SessionService)
      .useValue({
        authenticate: vi.fn().mockResolvedValue({
          userId: '00000000-0000-4000-8000-000000000001',
          sessionId: '00000000-0000-4000-8000-000000000002',
          recentlyAuthenticatedAt: Date.now(),
        }),
      })
      .overrideProvider(TenantContextService)
      .useValue({
        resolve: vi
          .fn()
          .mockRejectedValue(new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400)),
      })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('rejects unauthenticated requests on every non-public route', async () => {
    if (!app) throw new Error('Test application was not initialized.');
    const document = createOpenApiDocument(app);
    const routes = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations ?? {})
        .filter((method) => httpMethods.has(method))
        .map((method) => ({ method: method.toUpperCase(), path })),
    );
    expect(routes).toHaveLength(95);

    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (publicRoutes.has(key)) continue;
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: route.method,
          url: requestPath(route.path),
        });
      expect(response.statusCode, `${key}: ${response.body}`).toBe(401);
      expect(response.json(), key).toMatchObject({ code: 'AUTH_REQUIRED' });
    }
  });

  it('rejects every tenant-scoped route when no organization is selected', async () => {
    if (!app) throw new Error('Test application was not initialized.');
    const document = createOpenApiDocument(app);
    const routes = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations ?? {})
        .filter((method) => httpMethods.has(method))
        .map((method) => ({ method: method.toUpperCase(), path })),
    );
    const tenantRoutes = routes.filter((route) => tenantRoutePrefixes.some((prefix) => route.path.startsWith(prefix)));
    expect(tenantRoutes.length).toBeGreaterThan(0);

    for (const route of tenantRoutes) {
      const key = `${route.method} ${route.path}`;
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: route.method,
          url: requestPath(route.path),
          headers: { authorization: 'Bearer authenticated-contract-token' },
        });
      expect(response.statusCode, `${key}: ${response.body}`).toBe(400);
      expect(response.json(), key).toMatchObject({ code: 'TENANT_REQUIRED' });
    }
  });
});
