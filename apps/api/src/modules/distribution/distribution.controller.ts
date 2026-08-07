import {
  createInstallPlanRequestSchema,
  registerDeviceRequestSchema,
  reportInstallationRequestSchema,
  updateDeviceRequestSchema,
} from '@agentdoor/contracts/distribution';
import { zodFieldErrors } from '@agentdoor/contracts/errors';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { DistributionService } from './distribution.service.js';

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(result.error));
  }
  return result.data;
}

function context(request: TenantRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return { auth: request.auth, tenant: request.tenant };
}

@Controller('devices')
@UseGuards(AuthGuard, TenantGuard)
export class DeviceController {
  constructor(@Inject(DistributionService) private readonly distribution: DistributionService) {}

  @Post()
  register(@Req() request: TenantRequest, @Body() body: unknown) {
    const current = context(request);
    return this.distribution.registerDevice(
      current.tenant,
      current.auth.userId,
      parse(registerDeviceRequestSchema, body),
    );
  }

  @Get()
  list(@Req() request: TenantRequest) {
    const current = context(request);
    return this.distribution.listDevices(current.tenant, current.auth.userId);
  }

  @Patch(':deviceId')
  update(@Req() request: TenantRequest, @Param('deviceId') deviceId: string, @Body() body: unknown) {
    const current = context(request);
    return this.distribution.updateDevice(
      current.tenant,
      current.auth.userId,
      deviceId,
      parse(updateDeviceRequestSchema, body),
    );
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Req() request: TenantRequest, @Param('deviceId') deviceId: string) {
    const current = context(request);
    return this.distribution.revokeDevice(current.tenant, current.auth.userId, deviceId);
  }
}

@Controller('distribution')
@UseGuards(AuthGuard, TenantGuard)
export class DistributionController {
  constructor(@Inject(DistributionService) private readonly distribution: DistributionService) {}

  @Post('install-plans')
  installPlan(@Req() request: TenantRequest, @Body() body: unknown) {
    const current = context(request);
    return this.distribution.installPlan(
      current.tenant,
      current.auth.userId,
      parse(createInstallPlanRequestSchema, body),
    );
  }
}

@Controller('installations')
@UseGuards(AuthGuard, TenantGuard)
export class InstallationController {
  constructor(@Inject(DistributionService) private readonly distribution: DistributionService) {}

  @Post()
  report(
    @Req() request: TenantRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const current = context(request);
    return this.distribution.report(
      current.tenant,
      current.auth.userId,
      idempotencyKey ?? '',
      parse(reportInstallationRequestSchema, body),
    );
  }

  @Get()
  list(@Req() request: TenantRequest) {
    const current = context(request);
    return this.distribution.listInstallations(current.tenant, current.auth.userId);
  }

  @Get(':installationId/update-check')
  updateCheck(@Req() request: TenantRequest, @Param('installationId') installationId: string) {
    const current = context(request);
    return this.distribution.updateCheck(current.tenant, current.auth.userId, installationId);
  }
}
