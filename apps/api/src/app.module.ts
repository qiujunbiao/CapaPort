import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { IdentityModule } from './modules/identity/identity.module.js';
import { OrganizationModule } from './modules/organizations/organization.module.js';
import { DatabaseService } from './platform/database/database.service.js';
import { HealthController } from './platform/health/health.controller.js';
import { HealthService } from './platform/health/health.service.js';
import { PlatformModule } from './platform/platform.module.js';
import { RedisService } from './platform/redis/redis.service.js';
import { RequestIdMiddleware } from './platform/request-context/request-id.middleware.js';
import { StorageService } from './platform/storage/storage.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule],
  controllers: [HealthController],
  providers: [
    {
      provide: HealthService,
      useFactory: (database: DatabaseService, redis: RedisService, storage: StorageService) =>
        new HealthService([database, redis, storage]),
      inject: [DatabaseService, RedisService, StorageService],
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
