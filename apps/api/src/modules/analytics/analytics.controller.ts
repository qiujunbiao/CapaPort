import { zodFieldErrors } from '@capaport/contracts/errors';
import { metricsQuerySchema, productEventSchema } from '@capaport/contracts/operations';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AnalyticsService } from './analytics.service.js';

function context(request: TenantRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return { auth: request.auth, tenant: request.tenant };
}

@Controller('analytics')
@UseGuards(AuthGuard, TenantGuard)
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  event(@Req() request: TenantRequest, @Body() body: unknown) {
    const current = context(request);
    const parsed = productEventSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(parsed.error));
    }
    return this.analytics.ingest(current.tenant, current.auth.userId, parsed.data);
  }

  @Get('metrics')
  metrics(@Req() request: TenantRequest, @Query() query: unknown) {
    const current = context(request);
    const parsed = metricsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(parsed.error));
    }
    return this.analytics.metrics(current.tenant, parsed.data);
  }
}
