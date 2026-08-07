import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { DeviceController, DistributionController, InstallationController } from './distribution.controller.js';
import { DistributionRepository } from './distribution.repository.js';
import { DistributionService } from './distribution.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule, AccessModule],
  controllers: [DeviceController, DistributionController, InstallationController],
  providers: [
    DistributionRepository,
    DistributionService,
    { provide: 'DISTRIBUTION_DATA_STORE', useExisting: DistributionRepository },
  ],
  exports: [DistributionService],
})
export class DistributionModule {}
