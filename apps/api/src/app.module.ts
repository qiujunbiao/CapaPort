import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AccessModule } from './modules/access/access.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { CapabilityModule } from './modules/capabilities/capability.module.js';
import { DistributionModule } from './modules/distribution/distribution.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { NotificationModule } from './modules/notifications/notification.module.js';
import { OrganizationModule } from './modules/organizations/organization.module.js';
import { ProjectModule } from './modules/projects/project.module.js';
import { PublishingModule } from './modules/publishing/publishing.module.js';
import { DatabaseService } from './platform/database/database.service.js';
import { HealthController } from './platform/health/health.controller.js';
import { HealthService } from './platform/health/health.service.js';
import { PlatformModule } from './platform/platform.module.js';
import { RedisService } from './platform/redis/redis.service.js';
import { RequestIdMiddleware } from './platform/request-context/request-id.middleware.js';
import { StorageService } from './platform/storage/storage.service.js';
import { TelemetryController } from './platform/telemetry/telemetry.controller.js';
import { TelemetryMiddleware } from './platform/telemetry/telemetry.middleware.js';

@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    OrganizationModule,
    AccessModule,
    CapabilityModule,
    PublishingModule,
    ProjectModule,
    DistributionModule,
    AuditModule,
    NotificationModule,
    AnalyticsModule,
  ],
  controllers: [HealthController, TelemetryController],
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
    consumer.apply(RequestIdMiddleware, TelemetryMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
