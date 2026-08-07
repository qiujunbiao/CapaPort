import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_CONFIG, parseConfig } from './config/config.js';
import { DatabaseService } from './platform/database/database.service.js';
import { OutboxService } from './platform/database/outbox.service.js';
import { HealthController } from './platform/health/health.controller.js';
import { HealthService } from './platform/health/health.service.js';
import { RedisService } from './platform/redis/redis.service.js';
import { RequestIdMiddleware } from './platform/request-context/request-id.middleware.js';
import { StorageService } from './platform/storage/storage.service.js';

@Module({
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => parseConfig(process.env) },
    DatabaseService,
    RedisService,
    StorageService,
    OutboxService,
    {
      provide: HealthService,
      useFactory: (database: DatabaseService, redis: RedisService, storage: StorageService) =>
        new HealthService([database, redis, storage]),
      inject: [DatabaseService, RedisService, StorageService],
    },
  ],
  exports: [APP_CONFIG, DatabaseService, RedisService, StorageService, OutboxService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
