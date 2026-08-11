import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceController, DistributionController } from '../../src/modules/distribution/distribution.controller.js';
import { DistributionService } from '../../src/modules/distribution/distribution.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('distribution HTTP contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('rejects hardware IDs and returns only the short-lived install plan', async () => {
    const distribution = {
      registerDevice: vi.fn(),
      installPlan: vi.fn().mockResolvedValue({
        capabilityId: 'capability-a',
        versionId: 'version-a',
        version: '1.0.0',
        digest: 'a'.repeat(64),
        adapter: 'qwenwork',
        permissions: { filesystem: 'read-project', network: 'none' },
        download: { url: 'https://objects.example/signed', expiresIn: 120 },
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [DeviceController, DistributionController],
      providers: [
        { provide: DistributionService, useValue: distribution },
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

    const unsafe = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: 'Bearer token' },
      payload: {
        name: 'Work Mac',
        platform: 'macos',
        appVersion: '1.0.0',
        supportedAgents: ['codex'],
        hardwareSerial: 'must-not-be-collected',
      },
    });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json().code).toBe('VALIDATION_ERROR');
    expect(distribution.registerDevice).not.toHaveBeenCalled();

    const supported = await server.inject({
      method: 'POST',
      url: '/api/v1/devices',
      headers: { authorization: 'Bearer token' },
      payload: {
        name: 'Agent workstation',
        platform: 'macos',
        appVersion: '1.0.0',
        supportedAgents: ['codex', 'claude-code', 'cursor', 'gemini-cli', 'workbuddy', 'qwenwork'],
      },
    });
    expect(supported.statusCode, supported.body).toBe(201);
    expect(distribution.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      'user-a',
      expect.objectContaining({ supportedAgents: expect.arrayContaining(['workbuddy', 'qwenwork']) }),
    );

    const plan = await server.inject({
      method: 'POST',
      url: '/api/v1/distribution/install-plans',
      headers: { authorization: 'Bearer token' },
      payload: {
        deviceId: '00000000-0000-4000-8000-000000000001',
        capabilityId: '00000000-0000-4000-8000-000000000002',
        versionId: '00000000-0000-4000-8000-000000000003',
        agent: 'qwenwork',
      },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    expect(plan.json()).toMatchObject({ digest: 'a'.repeat(64), adapter: 'qwenwork', download: { expiresIn: 120 } });
    expect(plan.body).not.toContain('objectKey');
  });
});
