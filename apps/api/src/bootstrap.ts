import type { INestApplication } from '@nestjs/common';
import { registerOpenApi } from './openapi.js';
import { AppExceptionFilter } from './platform/errors/app-exception.filter.js';

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [
      'http://localhost:1420',
      'http://127.0.0.1:1420',
      'http://localhost:1430',
      'http://127.0.0.1:1430',
      'tauri://localhost',
      'http://tauri.localhost',
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-device-id',
      'x-organization-id',
      'x-request-id',
    ],
    maxAge: 86_400,
  });
  app.useGlobalFilters(new AppExceptionFilter());
  registerOpenApi(app);
  app.enableShutdownHooks();
}
