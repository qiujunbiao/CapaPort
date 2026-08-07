import { zodFieldErrors } from '@agentdoor/contracts/errors';
import {
  addSpaceMemberRequestSchema,
  changeSpaceMemberRoleRequestSchema,
  createSpaceRequestSchema,
  updateSpaceRequestSchema,
  updateSpaceReviewPolicyRequestSchema,
} from '@agentdoor/contracts/spaces';
import {
  Body,
  Controller,
  Delete,
  Get,
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
import { RequireSpaceAction, SpaceAccessGuard, type SpaceRequest } from './space.guard.js';
import { SpaceService } from './space.service.js';

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(result.error));
  return result.data;
}

function base(request: TenantRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return { auth: request.auth, tenant: request.tenant };
}

function access(request: SpaceRequest) {
  if (!request.spaceAccess) throw new AppError('ACCESS_DENIED', 'You do not have access to this space action.', 403);
  return request.spaceAccess;
}

@Controller('spaces')
export class SpaceController {
  constructor(@Inject(SpaceService) private readonly spaces: SpaceService) {}

  @Post()
  @UseGuards(AuthGuard, TenantGuard)
  create(@Req() request: TenantRequest, @Body() body: unknown) {
    const context = base(request);
    return this.spaces.create(context.tenant, context.auth.userId, parse(createSpaceRequestSchema, body));
  }

  @Get()
  @UseGuards(AuthGuard, TenantGuard)
  list(@Req() request: TenantRequest) {
    const context = base(request);
    return this.spaces.list(context.tenant, context.auth.userId);
  }

  @Get(':spaceId')
  @RequireSpaceAction('space:view')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  get(@Req() request: SpaceRequest) {
    return access(request).space;
  }

  @Patch(':spaceId')
  @RequireSpaceAction('space:update')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  update(@Req() request: SpaceRequest, @Body() body: unknown) {
    return this.spaces.update(access(request), parse(updateSpaceRequestSchema, body));
  }

  @Delete(':spaceId')
  @RequireSpaceAction('space:archive')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Req() request: SpaceRequest) {
    return this.spaces.archive(access(request));
  }

  @Patch(':spaceId/review-policy')
  @RequireSpaceAction('space:update-review-policy')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  updateReviewPolicy(@Req() request: SpaceRequest, @Body() body: unknown) {
    const input = parse(updateSpaceReviewPolicyRequestSchema, body);
    return this.spaces.updateReviewPolicy(access(request), input.reviewPolicy);
  }

  @Get(':spaceId/members')
  @RequireSpaceAction('space:manage-members')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  members(@Req() request: SpaceRequest) {
    return this.spaces.members(access(request));
  }

  @Post(':spaceId/members')
  @RequireSpaceAction('space:manage-members')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  addMember(@Req() request: SpaceRequest, @Body() body: unknown) {
    const input = parse(addSpaceMemberRequestSchema, body);
    return this.spaces.addMember(access(request), input.userId, input.role);
  }

  @Patch(':spaceId/members/:spaceMembershipId')
  @RequireSpaceAction('space:manage-members')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  changeMemberRole(
    @Req() request: SpaceRequest,
    @Param('spaceMembershipId') spaceMembershipId: string,
    @Body() body: unknown,
  ) {
    const input = parse(changeSpaceMemberRoleRequestSchema, body);
    return this.spaces.changeMemberRole(access(request), spaceMembershipId, input.role);
  }

  @Delete(':spaceId/members/:spaceMembershipId')
  @RequireSpaceAction('space:manage-members')
  @UseGuards(AuthGuard, TenantGuard, SpaceAccessGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Req() request: SpaceRequest, @Param('spaceMembershipId') spaceMembershipId: string) {
    return this.spaces.removeMember(access(request), spaceMembershipId);
  }
}
