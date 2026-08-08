import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationController } from '../../src/modules/organizations/organization.controller.js';
import { OrganizationService } from '../../src/modules/organizations/organization.service.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { RateLimitService } from '../../src/platform/security/rate-limit.service.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('organization invitation HTTP contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('returns redacted invitation metadata and stable single-use errors', async () => {
    const organizations = {
      invite: vi.fn().mockResolvedValue({ id: 'invitation-1', maskedTarget: 'in***@example.com', expiresIn: 604800 }),
      accept: vi
        .fn()
        .mockResolvedValueOnce({ organizationId: 'org-a', membershipId: 'membership-new', organizationRole: 'member' })
        .mockRejectedValueOnce(new AppError('INVITATION_ALREADY_USED', 'Already used.', 409)),
    };
    const module = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        { provide: OrganizationService, useValue: organizations },
        { provide: RateLimitService, useValue: { assertAllowed: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: SessionService,
          useValue: { authenticate: vi.fn().mockResolvedValue({ userId: 'user-a', sessionId: 'session-a' }) },
        },
        {
          provide: TenantContextService,
          useValue: {
            resolve: vi
              .fn()
              .mockResolvedValue({ organizationId: 'org-a', membershipId: 'owner-a', organizationRole: 'owner' }),
          },
        },
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

    const invited = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations/org-a/invitations',
      headers: { authorization: 'Bearer token' },
      payload: { kind: 'email', target: 'invitee@example.com', role: 'member' },
    });
    expect(invited.statusCode, invited.body).toBe(202);
    expect(invited.json()).toEqual({ id: 'invitation-1', maskedTarget: 'in***@example.com', expiresIn: 604800 });
    expect(invited.body).not.toMatch(/token|invitee@example\.com/i);

    const accepted = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations/invitations/accept',
      headers: { authorization: 'Bearer token' },
      payload: { token: 'invitation-token-that-is-safely-long-enough' },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json()).toMatchObject({ organizationId: 'org-a', organizationRole: 'member' });

    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/organizations/invitations/accept',
      headers: { authorization: 'Bearer token' },
      payload: { token: 'invitation-token-that-is-safely-long-enough' },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe('INVITATION_ALREADY_USED');
  });
});
