import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceAccessGuard } from '../../src/modules/access/space.guard.js';
import { SpaceService } from '../../src/modules/access/space.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { ProjectController } from '../../src/modules/projects/project.controller.js';
import { ProjectService } from '../../src/modules/projects/project.service.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('project context sync HTTP boundary', () => {
  let app: INestApplication | undefined;
  afterEach(async () => app?.close());

  it('rejects absolute paths and file inventories before they reach the cloud service', async () => {
    const projects = {
      createBinding: vi.fn().mockImplementation(async (_tenant, _userId, spaceId, input) => ({
        id: 'binding-a',
        organizationId: 'org-a',
        projectSpaceId: spaceId,
        ...input,
        status: 'active',
        createdAt: new Date(0).toISOString(),
      })),
      registerContext: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: ProjectService, useValue: projects },
        {
          provide: SpaceService,
          useValue: {
            authorize: vi.fn().mockResolvedValue({
              space: { id: '00000000-0000-4000-8000-000000000001', type: 'project', status: 'active' },
            }),
          },
        },
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
              organizationRole: 'member',
            }),
          },
        },
        AuthGuard,
        TenantGuard,
        SpaceAccessGuard,
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
    const server = app.getHttpAdapter().getInstance();
    const headers = { authorization: 'Bearer token', 'x-organization-id': 'org-a' };
    const spaceId = '00000000-0000-4000-8000-000000000001';

    const unsafeBinding = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${spaceId}/bindings`,
      headers,
      payload: {
        deviceId: '00000000-0000-4000-8000-000000000002',
        localBindingId: '00000000-0000-4000-8000-000000000003',
        agents: ['codex'],
        localPath: '/private/customer/payments',
      },
    });
    expect(unsafeBinding.statusCode).toBe(400);
    expect(projects.createBinding).not.toHaveBeenCalled();

    const safeBinding = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${spaceId}/bindings`,
      headers,
      payload: {
        deviceId: '00000000-0000-4000-8000-000000000002',
        localBindingId: '00000000-0000-4000-8000-000000000003',
        agents: ['codex'],
      },
    });
    expect(safeBinding.statusCode, safeBinding.body).toBe(201);
    expect(safeBinding.body).not.toContain('/private');
    expect(projects.createBinding).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      spaceId,
      expect.not.objectContaining({ path: expect.anything(), localPath: expect.anything() }),
    );

    const inventoryLeak = await server.inject({
      method: 'POST',
      url: `/api/v1/projects/${spaceId}/contexts`,
      headers,
      payload: {
        bindingId: '00000000-0000-4000-8000-000000000003',
        artifactId: '00000000-0000-4000-8000-000000000004',
        digest: 'a'.repeat(64),
        selectionDigest: 'b'.repeat(64),
        fileCount: 1,
        totalBytes: 20,
        agents: ['codex'],
        scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: new Date().toISOString() },
        files: [{ path: 'unselected/private.md' }],
      },
    });
    expect(inventoryLeak.statusCode).toBe(400);
    expect(projects.registerContext).not.toHaveBeenCalled();
  });
});
