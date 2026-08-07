import { zodFieldErrors } from '@agentdoor/contracts/errors';
import { auditQuerySchema } from '@agentdoor/contracts/operations';
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AuditService } from './audit.service.js';

@Controller('audit')
@UseGuards(AuthGuard, TenantGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(@Req() request: TenantRequest, @Query() query: unknown) {
    if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
    const parsed = auditQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(parsed.error));
    }
    return this.audit.list(request.tenant, parsed.data);
  }
}
