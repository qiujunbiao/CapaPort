import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [PlatformModule, IdentityModule, OrganizationModule],
  controllers: [AuditController],
  providers: [AuditRepository, AuditService, { provide: 'AUDIT_DATA_STORE', useExisting: AuditRepository }],
})
export class AuditModule {}
