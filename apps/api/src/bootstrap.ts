import type { INestApplication } from '@nestjs/common';
import { AppExceptionFilter } from './platform/errors/app-exception.filter.js';

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableShutdownHooks();
}
