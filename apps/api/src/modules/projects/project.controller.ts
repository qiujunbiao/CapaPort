import { zodFieldErrors } from '@agentdoor/contracts/errors';
import { createProjectBindingRequestSchema, registerProjectContextRequestSchema } from '@agentdoor/contracts/projects';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard } from '../../platform/tenancy/tenant.guard.js';
import { RequireSpaceAction, SpaceAccessGuard, type SpaceRequest } from '../access/space.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ProjectService } from './project.service.js';

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(result.error));
  return result.data;
}
function context(request: SpaceRequest) {
  if (!request.auth || !request.tenant) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  return { auth: request.auth, tenant: request.tenant };
}

@Controller('projects/:spaceId')
@RequireSpaceAction('space:view')
@UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
export class ProjectController {
  constructor(@Inject(ProjectService) private readonly projects: ProjectService) {}

  @Post('bindings')
  @RequireSpaceAction('content:create')
  createBinding(@Req() request: SpaceRequest, @Param('spaceId') spaceId: string, @Body() body: unknown) {
    const current = context(request);
    return this.projects.createBinding(
      current.tenant,
      current.auth.userId,
      spaceId,
      parse(createProjectBindingRequestSchema, body),
    );
  }

  @Get('bindings')
  listBindings(@Req() request: SpaceRequest, @Param('spaceId') spaceId: string) {
    const current = context(request);
    return this.projects.listBindings(current.tenant, current.auth.userId, spaceId);
  }

  @Delete('bindings/:bindingId')
  @RequireSpaceAction('content:create')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBinding(
    @Req() request: SpaceRequest,
    @Param('spaceId') spaceId: string,
    @Param('bindingId') bindingId: string,
  ) {
    const current = context(request);
    return this.projects.removeBinding(current.tenant, current.auth.userId, spaceId, bindingId);
  }

  @Post('contexts')
  @RequireSpaceAction('content:create')
  registerContext(@Req() request: SpaceRequest, @Param('spaceId') spaceId: string, @Body() body: unknown) {
    const current = context(request);
    return this.projects.registerContext(
      current.tenant,
      current.auth.userId,
      spaceId,
      parse(registerProjectContextRequestSchema, body),
    );
  }

  @Get('contexts')
  listContexts(@Req() request: SpaceRequest, @Param('spaceId') spaceId: string) {
    const current = context(request);
    return this.projects.listContexts(current.tenant, current.auth.userId, spaceId);
  }

  @Get('contexts/:contextId/download')
  downloadContext(
    @Req() request: SpaceRequest,
    @Param('spaceId') spaceId: string,
    @Param('contextId') contextId: string,
  ) {
    const current = context(request);
    return this.projects.downloadContext(current.tenant, current.auth.userId, spaceId, contextId);
  }
}
