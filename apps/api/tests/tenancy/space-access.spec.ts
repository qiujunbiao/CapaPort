import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceController } from '../../src/modules/access/space.controller.js';
import { SpaceAccessGuard } from '../../src/modules/access/space.guard.js';
import { SpaceService } from '../../src/modules/access/space.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('space access isolation', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('hides personal and foreign spaces while allowing an assigned same-tenant space', async () => {
    const store = {
      findSpaceAccess: vi.fn(async (organizationId: string, spaceId: string) => {
        if (organizationId !== 'org-a' || spaceId === 'foreign-team') return undefined;
        if (spaceId === 'private-personal') {
          return {
            space: {
              id: spaceId,
              organizationId,
              type: 'personal',
              name: 'Private',
              slug: 'private',
              ownerUserId: 'user-b',
              reviewPolicy: 'direct',
              status: 'active',
            },
          };
        }
        return {
          space: {
            id: spaceId,
            organizationId,
            type: 'team',
            name: 'Allowed team',
            slug: 'allowed-team',
            reviewPolicy: 'required',
            status: 'active',
          },
          membership: { id: 'space-member-a', role: 'viewer', status: 'active' },
        };
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        SpaceService,
        SpaceAccessGuard,
        { provide: 'SPACE_DATA_STORE', useValue: store },
        {
          provide: SessionService,
          useValue: { authenticate: vi.fn().mockResolvedValue({ userId: 'user-a', sessionId: 'session-a' }) },
        },
        {
          provide: TenantContextService,
          useValue: {
            resolve: vi
              .fn()
              .mockResolvedValue({ organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'member' }),
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

    for (const spaceId of ['private-personal', 'foreign-team']) {
      const denied = await server.inject({
        method: 'GET',
        url: `/api/v1/spaces/${spaceId}`,
        headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe('ACCESS_DENIED');
    }

    const allowed = await server.inject({
      method: 'GET',
      url: '/api/v1/spaces/allowed-team',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json()).toMatchObject({ id: 'allowed-team', type: 'team' });
    expect(store.findSpaceAccess).toHaveBeenCalledWith('org-a', expect.any(String), 'user-a');
  });
});
