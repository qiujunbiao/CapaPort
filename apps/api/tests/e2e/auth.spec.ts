import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/modules/identity/auth.controller.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { AppExceptionFilter } from '../../src/platform/errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../../src/platform/request-context/request-id.middleware.js';
import { RateLimitService } from '../../src/platform/security/rate-limit.service.js';

describe('auth HTTP contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('keeps registration responses redacted and protects session routes', async () => {
    const identity = {
      register: vi.fn().mockResolvedValue({
        challengeId: '00000000-0000-4000-8000-000000000001',
        maskedTarget: 'pe***@example.com',
        expiresIn: 600,
      }),
    };
    const sessions = {
      authenticate: vi.fn().mockResolvedValue({ userId: 'user-1', sessionId: 'session-1' }),
      list: vi.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: IdentityService, useValue: identity },
        { provide: SessionService, useValue: sessions },
        { provide: RateLimitService, useValue: { assertAllowed: vi.fn().mockResolvedValue(undefined) } },
        AuthGuard,
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
    const server = app.getHttpAdapter().getInstance();

    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        kind: 'email',
        target: 'person@example.com',
        password: 'Correct-Horse9-Battery!',
        displayName: 'Person',
      },
    });
    expect(registration.statusCode, registration.body).toBe(202);
    expect(registration.json()).toEqual({
      challengeId: '00000000-0000-4000-8000-000000000001',
      maskedTarget: 'pe***@example.com',
      expiresIn: 600,
    });
    expect(registration.body).not.toMatch(/password|codeDigest|hash/i);

    const unauthorized = await server.inject({ method: 'GET', url: '/api/v1/auth/sessions' });
    expect(unauthorized.statusCode).toBe(401);
    const authorized = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: 'Bearer access-token' },
    });
    expect(authorized.statusCode, authorized.body).toBe(200);
    expect(sessions.list).toHaveBeenCalledWith('user-1', 'session-1');
  });
});
