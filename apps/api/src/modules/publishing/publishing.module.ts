import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { AccessModule } from '../access/access.module.js';
import { CapabilityModule } from '../capabilities/capability.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { PublicationController, VersionController } from './publication.controller.js';
import { PublishingRepository } from './publishing.repository.js';
import { PublishingService } from './publishing.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule, AccessModule, CapabilityModule],
  controllers: [PublicationController, VersionController],
  providers: [
    PublishingRepository,
    PublishingService,
    { provide: 'PUBLICATION_DATA_STORE', useExisting: PublishingRepository },
  ],
  exports: [PublishingService],
})
export class PublishingModule {}
