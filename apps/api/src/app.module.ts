import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AccessModule } from './modules/access/access.module.js';
import { CapabilityModule } from './modules/capabilities/capability.module.js';
import { DistributionModule } from './modules/distribution/distribution.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { OrganizationModule } from './modules/organizations/organization.module.js';
import { PublishingModule } from './modules/publishing/publishing.module.js';
import { DatabaseService } from './platform/database/database.service.js';
import { HealthController } from './platform/health/health.controller.js';
import { HealthService } from './platform/health/health.service.js';
import { PlatformModule } from './platform/platform.module.js';
import { RedisService } from './platform/redis/redis.service.js';
import { RequestIdMiddleware } from './platform/request-context/request-id.middleware.js';
import { StorageService } from './platform/storage/storage.service.js';

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    OrganizationModule,
    AccessModule,
    CapabilityModule,
    PublishingModule,
    DistributionModule,
  ],
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
