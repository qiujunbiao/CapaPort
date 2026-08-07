import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsController } from '../../src/modules/analytics/analytics.controller.js';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.js';
import { AuditController } from '../../src/modules/audit/audit.controller.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { NotificationController } from '../../src/modules/notifications/notification.controller.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { TenantGuard } from '../../src/platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../src/platform/tenancy/tenant-context.service.js';

describe('operations HTTP contracts', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('keeps audit tenant-scoped, notification ownership implicit, and analytics payloads minimized', async () => {
    const audit = { list: vi.fn().mockResolvedValue({ entries: [] }) };
    const notifications = {
      list: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0 }),
      markRead: vi.fn().mockResolvedValue({ id: 'notification-a', readAt: new Date() }),
      deadLetters: vi.fn().mockResolvedValue([]),
    };
    const analytics = {
      ingest: vi.fn().mockResolvedValue({ accepted: true }),
      metrics: vi.fn().mockResolvedValue({ activeDevices: 0 }),
    };
    const module = await Test.createTestingModule({
      controllers: [AuditController, NotificationController, AnalyticsController],
      providers: [
        { provide: AuditService, useValue: audit },
        { provide: NotificationService, useValue: notifications },
        { provide: AnalyticsService, useValue: analytics },
        {
          provide: SessionService,
          useValue: { authenticate: vi.fn().mockResolvedValue({ userId: 'user-a', sessionId: 'session-a' }) },
        },
        {
          provide: TenantContextService,
          useValue: {
            resolve: vi
              .fn()
              .mockResolvedValue({ organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'owner' }),
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
    const headers = { authorization: 'Bearer token', 'x-organization-id': 'org-a' };

    const auditResponse = await server.inject({ method: 'GET', url: '/api/v1/audit?limit=20', headers });
    expect(auditResponse.statusCode, auditResponse.body).toBe(200);
    expect(audit.list).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a' }), { limit: 20 });

    const inbox = await server.inject({ method: 'GET', url: '/api/v1/notifications?unreadOnly=true', headers });
    expect(inbox.statusCode, inbox.body).toBe(200);
    expect(notifications.list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      'user-a',
      expect.objectContaining({ unreadOnly: true }),
    );

    const accepted = await server.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      headers,
      payload: { eventName: 'agent.discovered', agent: 'codex', source: 'desktop' },
    });
    expect(accepted.statusCode, accepted.body).toBe(202);
    expect(analytics.ingest).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a' }), 'user-a', {
      eventName: 'agent.discovered',
      agent: 'codex',
      source: 'desktop',
    });

    for (const forbidden of [{ content: 'private source' }, { absolutePath: '/Users/private/project' }]) {
      const rejected = await server.inject({
        method: 'POST',
        url: '/api/v1/analytics/events',
        headers,
        payload: { eventName: 'agent.discovered', source: 'desktop', ...forbidden },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().code).toBe('VALIDATION_ERROR');
    }
    expect(analytics.ingest).toHaveBeenCalledTimes(1);
  });
});
