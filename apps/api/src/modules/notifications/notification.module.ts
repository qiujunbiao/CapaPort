import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { NotificationController } from './notification.controller.js';
import { NotificationRepository } from './notification.repository.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule],
  controllers: [NotificationController],
  providers: [
    NotificationRepository,
    NotificationService,
    { provide: 'NOTIFICATION_DATA_STORE', useExisting: NotificationRepository },
  ],
})
export class NotificationModule {}
