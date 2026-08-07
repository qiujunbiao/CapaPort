import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsRepository,
    AnalyticsService,
    { provide: 'ANALYTICS_DATA_STORE', useExisting: AnalyticsRepository },
  ],
})
export class AnalyticsModule {}
