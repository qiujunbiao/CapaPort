import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactController } from '../../src/modules/capabilities/artifact.controller.js';
import { ArtifactService } from '../../src/modules/capabilities/artifact.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('artifact upload HTTP contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('returns a redacted three-step upload plan and stable confirmation failures', async () => {
    const artifacts = {
      requestUpload: vi.fn().mockResolvedValue({
        uploadId: 'upload-a',
        method: 'PUT',
        url: 'https://objects.example/signed',
        headers: { 'content-type': 'application/zip' },
        expiresIn: 300,
      }),
      confirmUpload: vi.fn().mockRejectedValue(new AppError('ARTIFACT_DIGEST_MISMATCH', 'Digest mismatch.', 409)),
    };
    const module = await Test.createTestingModule({
      controllers: [ArtifactController],
      providers: [
        { provide: ArtifactService, useValue: artifacts },
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

    const requested = await server.inject({
      method: 'POST',
      url: '/api/v1/artifacts/uploads',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
      payload: {
        spaceId: '00000000-0000-4000-8000-000000000001',
        fileName: 'private-original-name.zip',
        contentType: 'application/zip',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
      },
    });
    expect(requested.statusCode, requested.body).toBe(201);
    expect(requested.json()).toMatchObject({ uploadId: 'upload-a', method: 'PUT', expiresIn: 300 });
    expect(requested.body).not.toContain('private-original-name');
    expect(requested.body).not.toContain('objectKey');

    const confirmation = await server.inject({
      method: 'POST',
      url: '/api/v1/artifacts/uploads/upload-a/confirm',
      headers: { authorization: 'Bearer token', 'x-organization-id': 'org-a' },
    });
    expect(confirmation.statusCode).toBe(409);
    expect(confirmation.json().code).toBe('ARTIFACT_DIGEST_MISMATCH');
  });
});
