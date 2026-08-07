import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { AccessModule } from '../access/access.module.js';
import { CapabilityModule } from '../capabilities/capability.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { ProjectController } from './project.controller.js';
import { ProjectRepository } from './project.repository.js';
import { ProjectService } from './project.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule, AccessModule, CapabilityModule],
  controllers: [ProjectController],
  providers: [ProjectRepository, ProjectService, { provide: 'PROJECT_DATA_STORE', useExisting: ProjectRepository }],
  exports: [ProjectService],
})
export class ProjectModule {}
