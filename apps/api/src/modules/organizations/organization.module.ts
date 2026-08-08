import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module.js';
import { TenantGuard } from '../../platform/tenancy/tenant.guard.js';
import { TenantContextService } from '../../platform/tenancy/tenant-context.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MailpitOrganizationInvitationSender } from './invitation.sender.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationRepository } from './organization.repository.js';
import { OrganizationService } from './organization.service.js';
import { SecurityPolicyRepository } from './security-policy.repository.js';
import { SecurityPolicyService } from './security-policy.service.js';

@Module({
  imports: [PlatformModule, IdentityModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationRepository,
    OrganizationService,
    SecurityPolicyRepository,
    SecurityPolicyService,
    TenantContextService,
    TenantGuard,
    MailpitOrganizationInvitationSender,
    { provide: 'ORGANIZATION_DATA_STORE', useExisting: OrganizationRepository },
    { provide: 'TENANT_STORE', useExisting: OrganizationRepository },
    { provide: 'TENANT_CONTEXT_SERVICE', useExisting: TenantContextService },
    { provide: 'ORGANIZATION_INVITATION_SENDER', useExisting: MailpitOrganizationInvitationSender },
    { provide: 'ORGANIZATION_SECURITY_POLICY_STORE', useExisting: SecurityPolicyRepository },
  ],
  exports: [OrganizationService, SecurityPolicyService, TenantContextService, TenantGuard],
})
export class OrganizationModule {}
