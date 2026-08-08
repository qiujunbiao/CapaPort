import { Controller, Get, type INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { registerOpenApi } from './openapi.js';

@Controller('contract-probe')
class ContractProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

describe('OpenAPI endpoint', () => {
  let app: INestApplication | undefined;

  afterEach(async () => app?.close());

  it('serves the generated document at the versioned public endpoint', async () => {
    const module = await Test.createTestingModule({ controllers: [ContractProbeController] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    registerOpenApi(app);
    await app.init();
    const response = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: '3.0.0',
      paths: { '/api/v1/contract-probe': { get: { operationId: 'contract_probe_probe' } } },
    });
  });
});
