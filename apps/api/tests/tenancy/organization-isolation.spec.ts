import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationController } from '../../src/modules/organizations/organization.controller.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { SecurityPolicyService } from '../../src/modules/organizations/security-policy.service.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { RateLimitService } from '../../src/platform/security/rate-limit.service.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('organization tenant isolation', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('does not call resource services for guessed or mismatched organization IDs', async () => {
    const organizations = {
      get: vi.fn().mockResolvedValue({ id: 'org-a', name: 'A', slug: 'a', status: 'active' }),
    };
    const tenants = {
      resolve: vi.fn(async (_userId: string, _sessionId: string, organizationId?: string) => {
        if (organizationId !== 'org-a') throw new AppError('TENANT_ACCESS_DENIED', 'No access.', 403);
        return { organizationId: 'org-a', membershipId: 'membership-a', organizationRole: 'member' as const };
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        { provide: OrganizationService, useValue: organizations },
        { provide: SecurityPolicyService, useValue: {} },
        { provide: RateLimitService, useValue: { assertAllowed: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: SessionService,
          useValue: { authenticate: vi.fn().mockResolvedValue({ userId: 'user-a', sessionId: 'session-a' }) },
        },
        { provide: TenantContextService, useValue: tenants },
        AuthGuard,
        TenantGuard,
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
    const server = app.getHttpAdapter().getInstance();

    const guessed = await server.inject({
      method: 'GET',
      url: '/api/v1/organizations/org-b',
      headers: { authorization: 'Bearer token' },
    });
    expect(guessed.statusCode).toBe(403);
    expect(guessed.json().code).toBe('TENANT_ACCESS_DENIED');
    expect(organizations.get).not.toHaveBeenCalled();

    const mismatch = await server.inject({
      method: 'GET',
      url: '/api/v1/organizations/org-a',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-b' },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().code).toBe('TENANT_MISMATCH');
    expect(organizations.get).not.toHaveBeenCalled();

    const allowed = await server.inject({
      method: 'GET',
      url: '/api/v1/organizations/org-a',
      headers: { authorization: 'Bearer token' },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(organizations.get).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', membershipId: 'membership-a' }),
    );
  });
});
