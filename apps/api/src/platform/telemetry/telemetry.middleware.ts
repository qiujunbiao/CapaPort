import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { platformMetrics } from './metrics-registry.js';
import { platformLogger } from './structured-logger.js';

type Request = IncomingMessage & { requestId?: string };

function normalizedRoute(url: string | undefined): string {
  return (url?.split('?')[0] ?? 'unmatched')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 200);
}

@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  use(request: Request, response: ServerResponse, next: () => void): void {
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const method = request.method ?? 'UNKNOWN';
      const route = normalizedRoute(request.url);
      const status = String(response.statusCode);
      platformMetrics.increment('capaport_http_requests_total', {
        method,
        route,
        status,
      });
      platformMetrics.increment('capaport_http_request_duration_ms_total', { method, route }, durationMs);
      platformLogger.info('http.request.completed', {
        requestId: request.requestId,
        method,
        route,
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  }
}
