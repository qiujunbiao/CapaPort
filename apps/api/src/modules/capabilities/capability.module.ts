import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { ArtifactController } from './artifact.controller.js';
import { ArtifactRepository } from './artifact.repository.js';
import { ArtifactService } from './artifact.service.js';
import { CapabilityController } from './capability.controller.js';
import { CapabilityRepository } from './capability.repository.js';
import { CapabilityService } from './capability.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule, AccessModule],
  controllers: [ArtifactController, CapabilityController],
  providers: [
    ArtifactRepository,
    ArtifactService,
    CapabilityRepository,
    CapabilityService,
    { provide: 'ARTIFACT_DATA_STORE', useExisting: ArtifactRepository },
    { provide: 'CAPABILITY_DATA_STORE', useExisting: CapabilityRepository },
  ],
  exports: [ArtifactService, CapabilityService],
})
export class CapabilityModule {}
