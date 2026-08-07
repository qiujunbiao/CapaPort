import { zodFieldErrors } from '@agentdoor/contracts/errors';
import { notificationQuerySchema } from '@agentdoor/contracts/operations';
import { Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { NotificationService } from './notification.service.js';

function context(request: TenantRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return { auth: request.auth, tenant: request.tenant };
}

@Controller('notifications')
@UseGuards(AuthGuard, TenantGuard)
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @Get()
  list(@Req() request: TenantRequest, @Query() query: unknown) {
    const current = context(request);
    const parsed = notificationQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(parsed.error));
    }
    return this.notifications.list(current.tenant, current.auth.userId, parsed.data);
  }

  @Patch(':notificationId/read')
  markRead(@Req() request: TenantRequest, @Param('notificationId') notificationId: string) {
    const current = context(request);
    return this.notifications.markRead(current.tenant, current.auth.userId, notificationId);
  }

  @Get('dead-letters')
  deadLetters(@Req() request: TenantRequest, @Query('limit') rawLimit: unknown) {
    const current = context(request);
    const result = z.coerce.number().int().min(1).max(100).default(50).safeParse(rawLimit);
    if (!result.success) throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400);
    return this.notifications.deadLetters(current.tenant, result.data);
  }
}
