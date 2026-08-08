import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/bootstrap.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/config.js';
import { SpaceAccessGuard } from '../../src/modules/access/space.guard.js';
import { SpaceService } from '../../src/modules/access/space.service.js';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { ArtifactService } from '../../src/modules/capabilities/artifact.service.js';
import { CapabilityService } from '../../src/modules/capabilities/capability.service.js';
import { DistributionService } from '../../src/modules/distribution/distribution.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { SecurityPolicyService } from '../../src/modules/organizations/security-policy.service.js';
import { ProjectService } from '../../src/modules/projects/project.service.js';
import { PublishingService } from '../../src/modules/publishing/publishing.service.js';
import { createOpenApiDocument } from '../../src/openapi.js';
import { HealthService } from '../../src/platform/health/health.service.js';
import { IDEMPOTENCY_STORE } from '../../src/platform/idempotency/idempotency.store.js';
import { RateLimitService } from '../../src/platform/security/rate-limit.service.js';
import { RecentAuthGuard } from '../../src/platform/security/recent-auth.guard.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';

const id = '00000000-0000-4000-8000-000000000001';
const organizationId = '00000000-0000-4000-8000-000000000002';
const membershipId = '00000000-0000-4000-8000-000000000003';
const token = 'token-value-that-is-longer-than-thirty-two-characters';

const bodies: Record<string, unknown> = {
  'POST /api/v1/auth/register': {
    kind: 'email',
    target: 'person@example.test',
    password: 'Strong-password-1',
    displayName: 'Person',
  },
  'POST /api/v1/auth/verify': { challengeId: id, code: '123456' },
  'POST /api/v1/auth/login': {
    kind: 'email',
    target: 'person@example.test',
    password: 'Strong-password-1',
    deviceName: 'Contract test',
  },
  'POST /api/v1/auth/refresh': { refreshToken: token },
  'POST /api/v1/auth/recovery/start': { kind: 'email', target: 'person@example.test' },
  'POST /api/v1/auth/recovery/complete': { challengeId: id, code: '123456', newPassword: 'New-password-1' },
  'POST /api/v1/organizations': { name: '测试组织' },
  'POST /api/v1/organizations/invitations/accept': { token },
  'PATCH /api/v1/organizations/{organizationId}': { name: '更新后的组织' },
  'POST /api/v1/organizations/{organizationId}/closure': { confirmation: '测试组织' },
  'PATCH /api/v1/organizations/{organizationId}/security-policy': {
    blockedSeverities: ['high', 'critical'],
    confirmationSeverities: ['medium'],
    blockedTerms: [],
    allowedExecutablePaths: [],
    allowedNetworkHosts: [],
    executablePolicy: 'confirm',
  },
  'PATCH /api/v1/organizations/{organizationId}/members/{membershipId}/role': { role: 'admin' },
  'POST /api/v1/organizations/{organizationId}/owner/transfer': { membershipId },
  'POST /api/v1/organizations/{organizationId}/invitations': {
    kind: 'email',
    target: 'member@example.test',
    role: 'member',
  },
  'POST /api/v1/spaces': { type: 'project', name: '项目空间', reviewPolicy: 'direct' },
  'PATCH /api/v1/spaces/{spaceId}': { name: '更新后的空间' },
  'PATCH /api/v1/spaces/{spaceId}/review-policy': { reviewPolicy: 'required' },
  'POST /api/v1/spaces/{spaceId}/members': { userId: id, role: 'contributor' },
  'PATCH /api/v1/spaces/{spaceId}/members/{spaceMembershipId}': { role: 'reviewer' },
  'POST /api/v1/artifacts/uploads': {
    spaceId: id,
    fileName: 'capability.zip',
    contentType: 'application/zip',
    sizeBytes: 128,
    sha256: 'a'.repeat(64),
  },
  'POST /api/v1/capabilities': {
    spaceId: id,
    slug: 'release-helper',
    name: 'Release Helper',
    compatibility: ['codex'],
  },
  'PATCH /api/v1/capabilities/{capabilityId}': { name: 'Updated capability' },
  'POST /api/v1/capabilities/{capabilityId}/drafts/{draftId}/revisions': { artifactId: id },
  'POST /api/v1/publications/{publicationId}/approve': { reason: 'Approved after review' },
  'POST /api/v1/publications/{publicationId}/request-changes': { reason: 'Please update documentation' },
  'POST /api/v1/publications/{publicationId}/reject': { reason: 'Rejected after review' },
  'POST /api/v1/capabilities/{capabilityId}/publications': {
    draftId: id,
    targetSpaceId: organizationId,
    version: '1.0.0',
  },
  'POST /api/v1/capabilities/{capabilityId}/promotions': {
    sourceVersionId: id,
    targetSpaceId: organizationId,
    version: '1.1.0',
  },
  'POST /api/v1/projects/{spaceId}/bindings': { deviceId: id, localBindingId: membershipId, agents: ['codex'] },
  'POST /api/v1/projects/{spaceId}/contexts': {
    bindingId: membershipId,
    artifactId: id,
    digest: 'b'.repeat(64),
    selectionDigest: 'c'.repeat(64),
    fileCount: 1,
    totalBytes: 128,
    agents: ['codex'],
    scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: '2026-08-08T00:00:00.000Z' },
  },
  'POST /api/v1/devices': {
    name: 'Test device',
    platform: 'macos',
    appVersion: '1.0.0',
    supportedAgents: ['codex'],
  },
  'PATCH /api/v1/devices/{deviceId}': { appVersion: '1.0.1' },
  'POST /api/v1/distribution/install-plans': {
    deviceId: id,
    capabilityId: organizationId,
    versionId: membershipId,
    agent: 'codex',
  },
  'POST /api/v1/installations': {
    deviceId: id,
    capabilityId: organizationId,
    versionId: membershipId,
    agent: 'codex',
    outcome: 'installed',
  },
  'POST /api/v1/analytics/events': {
    eventName: 'capability.imported',
    agent: 'codex',
    outcome: 'success',
    source: 'desktop',
  },
};

const invalidParameterRequests = [
  { key: 'GET /api/v1/capabilities', url: '/api/v1/capabilities?limit=0' },
  { key: 'GET /api/v1/publications', url: '/api/v1/publications?status=unknown' },
  {
    key: 'GET /api/v1/capabilities/{capabilityId}/versions/{versionId}/diff',
    url: `/api/v1/capabilities/${id}/versions/${organizationId}/diff`,
  },
  { key: 'GET /api/v1/audit', url: '/api/v1/audit?cursor=not-a-uuid' },
  { key: 'GET /api/v1/notifications', url: '/api/v1/notifications?unreadOnly=maybe' },
  { key: 'GET /api/v1/notifications/dead-letters', url: '/api/v1/notifications/dead-letters?limit=101' },
  {
    key: 'POST /api/v1/notifications/dead-letters/{kind}/{jobId}/retry',
    url: `/api/v1/notifications/dead-letters/unknown/${id}/retry`,
  },
  { key: 'GET /api/v1/analytics/metrics', url: '/api/v1/analytics/metrics?from=not-a-date' },
] as const;

function serviceStub(overrides: Record<string, unknown> = {}): object {
  const methods = new Map<PropertyKey, unknown>(Object.entries(overrides));
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'then') return undefined;
        if (!methods.has(property)) methods.set(property, vi.fn().mockResolvedValue({ ok: true }));
        return methods.get(property);
      },
    },
  );
}

class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().auth = {
      userId: id,
      sessionId: membershipId,
      recentlyAuthenticatedAt: Date.now(),
    };
    return true;
  }
}

class SelectedTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().tenant = {
      organizationId,
      membershipId,
      organizationRole: 'owner',
    };
    return true;
  }
}

class AuthorizedSpaceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.spaceAccess = {
      tenant: request.tenant,
      userId: request.auth.userId,
      space: {
        id,
        organizationId,
        type: 'project',
        name: 'Project',
        slug: 'project',
        reviewPolicy: 'required',
        status: 'active',
      },
      membership: { id: membershipId, role: 'manager', status: 'active' },
    };
    return true;
  }
}

class AllowedRecentAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

function concretePath(path: string): string {
  return path.replace('{kind}', 'operation').replaceAll(/\{[^}]+\}/g, id);
}

function queryFor(path: string): string {
  return path.endsWith('/diff') && path.includes('/versions/') ? `?against=${organizationId}` : '';
}

describe('all API route success contracts', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const config: AppConfig = {
      nodeEnv: 'test',
      port: 3100,
      corsOrigins: [],
      databaseUrl: 'postgres://capaport:capaport@127.0.0.1:5432/capaport-test',
      redisUrl: 'redis://127.0.0.1:6379/15',
      s3: {
        endpoint: 'http://127.0.0.1:9000',
        publicEndpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        bucket: 'capaport-test',
        accessKey: 'capaport',
        secretKey: 'capaport-test-secret',
      },
      auth: {
        jwtSecret: token,
        refreshPepper: token,
        verificationPepper: token,
        accessTtlSeconds: 900,
        refreshTtlDays: 30,
        verificationTtlMinutes: 10,
      },
      notification: { smtpHost: '127.0.0.1', smtpPort: 1025, smtpFrom: 'noreply@capaport.test' },
      metricsToken: token,
    };
    const testModule = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(IdentityService)
      .useValue(serviceStub())
      .overrideProvider(SessionService)
      .useValue(serviceStub())
      .overrideProvider(OrganizationService)
      .useValue(serviceStub({ export: vi.fn().mockResolvedValue({ schemaVersion: 1 }) }))
      .overrideProvider(SecurityPolicyService)
      .useValue(serviceStub())
      .overrideProvider(SpaceService)
      .useValue(serviceStub())
      .overrideProvider(ArtifactService)
      .useValue(serviceStub())
      .overrideProvider(CapabilityService)
      .useValue(serviceStub())
      .overrideProvider(PublishingService)
      .useValue(serviceStub())
      .overrideProvider(ProjectService)
      .useValue(serviceStub())
      .overrideProvider(DistributionService)
      .useValue(serviceStub())
      .overrideProvider(AuditService)
      .useValue(serviceStub())
      .overrideProvider(NotificationService)
      .useValue(serviceStub())
      .overrideProvider(AnalyticsService)
      .useValue(serviceStub())
      .overrideProvider(RateLimitService)
      .useValue(serviceStub())
      .overrideProvider(HealthService)
      .useValue({
        live: vi.fn(() => ({ status: 'ok' })),
        ready: vi.fn().mockResolvedValue({ status: 'ok', checks: {} }),
      })
      .overrideProvider(IDEMPOTENCY_STORE)
      .useValue({
        reserve: vi.fn().mockResolvedValue({ state: 'owner' }),
        complete: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockResolvedValue(undefined),
      })
      .overrideGuard(AuthGuard)
      .useClass(AuthenticatedGuard)
      .overrideGuard(TenantGuard)
      .useClass(SelectedTenantGuard)
      .overrideGuard(SpaceAccessGuard)
      .useClass(AuthorizedSpaceGuard)
      .overrideGuard(RecentAuthGuard)
      .useClass(AllowedRecentAuthGuard);
    const module = await testModule.compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    configureApplication(app, config);
    await app.init();
  }, 30_000);

  afterAll(async () => app?.close());

  it('accepts a valid request on every documented route', async () => {
    if (!app) throw new Error('Test application was not initialized.');
    const routes = Object.entries(createOpenApiDocument(app).paths).flatMap(([path, operations]) =>
      Object.keys(operations ?? {})
        .filter((method) => ['get', 'post', 'patch', 'put', 'delete'].includes(method))
        .map((method) => ({ method: method.toUpperCase(), path })),
    );
    expect(routes).toHaveLength(95);

    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      const body = bodies[key];
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: route.method,
          url: `${concretePath(route.path)}${queryFor(route.path)}`,
          headers: {
            authorization: `Bearer ${token}`,
            'x-organization-id': organizationId,
            'idempotency-key': `contract-${route.method.toLowerCase()}-${Buffer.from(route.path).toString('base64url')}`,
          },
          ...(body === undefined ? {} : { payload: body }),
        });
      expect(response.statusCode, `${key}: ${response.body}`).toBeGreaterThanOrEqual(200);
      expect(response.statusCode, `${key}: ${response.body}`).toBeLessThan(300);
    }
  });

  it('rejects an invalid empty body on every body-bearing route', async () => {
    if (!app) throw new Error('Test application was not initialized.');
    for (const key of Object.keys(bodies)) {
      const separator = key.indexOf(' ');
      const method = key.slice(0, separator);
      const path = key.slice(separator + 1);
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method,
          url: concretePath(path),
          headers: {
            authorization: `Bearer ${token}`,
            'x-organization-id': organizationId,
            'idempotency-key': `invalid-${method.toLowerCase()}-${Buffer.from(path).toString('base64url')}`,
          },
          payload: {},
        });
      expect(response.statusCode, `${key}: ${response.body}`).toBe(400);
      expect(response.json(), key).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('rejects invalid query and special path parameters', async () => {
    if (!app) throw new Error('Test application was not initialized.');
    for (const request of invalidParameterRequests) {
      const method = request.key.slice(0, request.key.indexOf(' '));
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method,
          url: request.url,
          headers: {
            authorization: `Bearer ${token}`,
            'x-organization-id': organizationId,
            'idempotency-key': `invalid-parameter-${Buffer.from(request.url).toString('base64url')}`,
          },
        });
      expect(response.statusCode, `${request.key}: ${response.body}`).toBe(400);
      expect(response.json(), request.key).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});
