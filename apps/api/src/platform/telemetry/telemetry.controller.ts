import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, HttpException, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { platformMetrics } from './metrics-registry.js';

@Controller('metrics')
export class TelemetryController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(@Req() request: FastifyRequest): string {
    const authorization = request.headers.authorization;
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expected = this.config.metricsToken;
    const valid = supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) throw new HttpException('Metrics credentials are invalid.', 401);
    return platformMetrics.render();
  }
}
