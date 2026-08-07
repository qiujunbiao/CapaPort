import {
  capabilitySearchQuerySchema,
  createCapabilityRequestSchema,
  createDraftRevisionRequestSchema,
  updateCapabilityRequestSchema,
} from '@agentdoor/contracts/capabilities';
import { zodFieldErrors } from '@agentdoor/contracts/errors';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CapabilityService } from './capability.service.js';

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(result.error));
  return result.data;
}

function context(request: TenantRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return { auth: request.auth, tenant: request.tenant };
}

@Controller('capabilities')
@UseGuards(AuthGuard, TenantGuard)
export class CapabilityController {
  constructor(@Inject(CapabilityService) private readonly capabilities: CapabilityService) {}

  @Post()
  create(@Req() request: TenantRequest, @Body() body: unknown) {
    const current = context(request);
    return this.capabilities.create(current.tenant, current.auth.userId, parse(createCapabilityRequestSchema, body));
  }

  @Get()
  search(@Req() request: TenantRequest, @Query() query: unknown) {
    const current = context(request);
    return this.capabilities.search(current.tenant, current.auth.userId, parse(capabilitySearchQuerySchema, query));
  }

  @Get(':capabilityId')
  get(@Req() request: TenantRequest, @Param('capabilityId') capabilityId: string) {
    const current = context(request);
    return this.capabilities.get(current.tenant, current.auth.userId, capabilityId);
  }

  @Patch(':capabilityId')
  update(@Req() request: TenantRequest, @Param('capabilityId') capabilityId: string, @Body() body: unknown) {
    const current = context(request);
    return this.capabilities.update(
      current.tenant,
      current.auth.userId,
      capabilityId,
      parse(updateCapabilityRequestSchema, body),
    );
  }

  @Post(':capabilityId/drafts')
  createDraft(@Req() request: TenantRequest, @Param('capabilityId') capabilityId: string) {
    const current = context(request);
    return this.capabilities.createDraft(current.tenant, current.auth.userId, capabilityId);
  }

  @Get(':capabilityId/drafts')
  drafts(@Req() request: TenantRequest, @Param('capabilityId') capabilityId: string) {
    const current = context(request);
    return this.capabilities.drafts(current.tenant, current.auth.userId, capabilityId);
  }

  @Get(':capabilityId/drafts/:draftId/revisions')
  revisions(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('draftId') draftId: string,
  ) {
    const current = context(request);
    return this.capabilities.revisions(current.tenant, current.auth.userId, capabilityId, draftId);
  }

  @Post(':capabilityId/drafts/:draftId/revisions')
  createRevision(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('draftId') draftId: string,
    @Body() body: unknown,
  ) {
    const current = context(request);
    const input = parse(createDraftRevisionRequestSchema, body);
    return this.capabilities.createRevision(
      current.tenant,
      current.auth.userId,
      capabilityId,
      draftId,
      input.artifactId,
    );
  }
}
