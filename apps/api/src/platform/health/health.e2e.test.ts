import { Controller, Get, HttpStatus, type INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { AppExceptionFilter } from '../errors/app-exception.filter.js';
import { RequestIdMiddleware } from '../request-context/request-id.middleware.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Controller('test-error')
class TestErrorController {
  @Get()
  fail(): never {
    throw new AppError('TEST_FAILURE', 'A stable test failure', HttpStatus.CONFLICT);
  }
}

describe('platform HTTP behavior', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('serves health endpoints, request IDs, and stable error envelopes', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController, TestErrorController],
      providers: [
        { provide: HealthService, useValue: { live: () => ({ status: 'ok' }), ready: () => ({ status: 'ok' }) } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();

    const instance = app.getHttpAdapter().getInstance();
    const live = await instance.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(live.statusCode, live.body).toBe(200);
    expect(live.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const failure = await instance.inject({ method: 'GET', url: '/api/v1/test-error' });
    expect(failure.statusCode).toBe(409);
    expect(failure.json()).toMatchObject({ code: 'TEST_FAILURE', message: 'A stable test failure' });
    expect(failure.json().requestId).toBe(failure.headers['x-request-id']);
  });
});
