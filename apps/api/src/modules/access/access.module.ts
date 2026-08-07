import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { SpaceController } from './space.controller.js';
import { SpaceAccessGuard } from './space.guard.js';
import { SpaceRepository } from './space.repository.js';
import { SpaceService } from './space.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule],
  controllers: [SpaceController],
  providers: [
    SpaceRepository,
    SpaceService,
    SpaceAccessGuard,
    { provide: 'SPACE_DATA_STORE', useExisting: SpaceRepository },
  ],
  exports: [SpaceService, SpaceAccessGuard],
})
export class AccessModule {}
