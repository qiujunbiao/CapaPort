import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceController } from '../../src/modules/access/space.controller.js';
import { SpaceService } from '../../src/modules/access/space.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('space creation', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  async function setup(organizationRole: 'owner' | 'member' = 'owner') {
    const createSpace = vi.fn(async (input) => ({ ...input, status: 'active' as const }));
    const module = await Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        SpaceService,
        { provide: 'SPACE_DATA_STORE', useValue: { createSpace } },
        {
          provide: SessionService,
          useValue: { authenticate: vi.fn().mockResolvedValue({ userId: 'user-a', sessionId: 'session-a' }) },
        },
        {
          provide: TenantContextService,
          useValue: {
            resolve: vi.fn().mockResolvedValue({
              organizationId: 'org-a',
              membershipId: 'member-a',
              organizationRole,
            }),
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
    return { createSpace, server: app.getHttpAdapter().getInstance() };
  }

  it('accepts the desktop project payload and generates the technical slug on the server', async () => {
    const { createSpace, server } = await setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
      payload: { type: 'project', name: '  rocky1  ', reviewPolicy: 'direct' },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(createSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        createdByUserId: 'user-a',
        type: 'project',
        name: 'rocky1',
        slug: expect.stringMatching(/^space-[a-f0-9]{12}$/),
        reviewPolicy: 'direct',
      }),
    );
  });

  it('defaults a team to required review when the policy and slug are omitted', async () => {
    const { createSpace, server } = await setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
      payload: { type: 'team', name: '团队一' },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(createSpace).toHaveBeenCalledWith(expect.objectContaining({ type: 'team', reviewPolicy: 'required' }));
  });

  it('returns field errors for invalid input without calling the repository', async () => {
    const { createSpace, server } = await setup();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
      payload: { type: 'personal', name: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', fieldErrors: expect.any(Object) });
    expect(createSpace).not.toHaveBeenCalled();
  });

  it('rejects ordinary organization members without writing a space', async () => {
    const { createSpace, server } = await setup('member');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
      payload: { type: 'team', name: '团队一' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'ACCESS_DENIED' });
    expect(createSpace).not.toHaveBeenCalled();
  });
});
