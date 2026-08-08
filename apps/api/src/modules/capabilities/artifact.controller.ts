import { requestArtifactUploadSchema } from '@capaport/contracts/capabilities';
import { zodFieldErrors } from '@capaport/contracts/errors';
import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ArtifactService } from './artifact.service.js';

function context(request: TenantRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return { auth: request.auth, tenant: request.tenant };
}

@Controller('artifacts/uploads')
@UseGuards(AuthGuard, TenantGuard)
export class ArtifactController {
  constructor(@Inject(ArtifactService) private readonly artifacts: ArtifactService) {}

  @Post()
  requestUpload(@Req() request: TenantRequest, @Body() body: unknown) {
    const parsed = requestArtifactUploadSchema.safeParse(body);
    if (!parsed.success)
      throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(parsed.error));
    const current = context(request);
    return this.artifacts.requestUpload(current.tenant, current.auth.userId, parsed.data);
  }

  @Post(':uploadId/confirm')
  confirmUpload(@Req() request: TenantRequest, @Param('uploadId') uploadId: string) {
    const current = context(request);
    return this.artifacts.confirmUpload(current.tenant, current.auth.userId, uploadId);
  }
}
