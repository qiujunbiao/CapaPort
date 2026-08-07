import { zodFieldErrors } from '@agentdoor/contracts/errors';
import {
  promotePublicationRequestSchema,
  publicationListQuerySchema,
  reviewPublicationRequestSchema,
  submitPublicationRequestSchema,
  versionDiffQuerySchema,
} from '@agentdoor/contracts/publications';
import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { PublishingService } from './publishing.service.js';

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

function idempotencyKey(value: string | undefined): string {
  return value ?? '';
}

@Controller('publications')
@UseGuards(AuthGuard, TenantGuard)
export class PublicationController {
  constructor(@Inject(PublishingService) private readonly publishing: PublishingService) {}

  @Get()
  list(@Req() request: TenantRequest, @Query() query: unknown) {
    const current = context(request);
    return this.publishing.list(current.tenant, current.auth.userId, parse(publicationListQuerySchema, query));
  }

  @Get(':publicationId')
  get(@Req() request: TenantRequest, @Param('publicationId') publicationId: string) {
    const current = context(request);
    return this.publishing.get(current.tenant, current.auth.userId, publicationId);
  }

  @Get(':publicationId/scan-report')
  scanReport(@Req() request: TenantRequest, @Param('publicationId') publicationId: string) {
    const current = context(request);
    return this.publishing.scanReport(current.tenant, current.auth.userId, publicationId);
  }

  @Get(':publicationId/diff')
  candidateDiff(@Req() request: TenantRequest, @Param('publicationId') publicationId: string) {
    const current = context(request);
    return this.publishing.candidateDiff(current.tenant, current.auth.userId, publicationId);
  }

  @Post(':publicationId/approve')
  approve(@Req() request: TenantRequest, @Param('publicationId') publicationId: string, @Body() body: unknown) {
    const current = context(request);
    return this.publishing.review(
      current.tenant,
      current.auth.userId,
      publicationId,
      'approve',
      parse(reviewPublicationRequestSchema, body).reason,
    );
  }

  @Post(':publicationId/request-changes')
  requestChanges(@Req() request: TenantRequest, @Param('publicationId') publicationId: string, @Body() body: unknown) {
    const current = context(request);
    return this.publishing.review(
      current.tenant,
      current.auth.userId,
      publicationId,
      'request_changes',
      parse(reviewPublicationRequestSchema, body).reason,
    );
  }

  @Post(':publicationId/reject')
  reject(@Req() request: TenantRequest, @Param('publicationId') publicationId: string, @Body() body: unknown) {
    const current = context(request);
    return this.publishing.review(
      current.tenant,
      current.auth.userId,
      publicationId,
      'reject',
      parse(reviewPublicationRequestSchema, body).reason,
    );
  }

  @Post(':publicationId/withdraw')
  withdraw(@Req() request: TenantRequest, @Param('publicationId') publicationId: string) {
    const current = context(request);
    return this.publishing.withdraw(current.tenant, current.auth.userId, publicationId);
  }
}

@Controller('capabilities/:capabilityId')
@UseGuards(AuthGuard, TenantGuard)
export class VersionController {
  constructor(@Inject(PublishingService) private readonly publishing: PublishingService) {}

  @Post('publications')
  submit(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const current = context(request);
    return this.publishing.submit(
      current.tenant,
      current.auth.userId,
      capabilityId,
      idempotencyKey(key),
      parse(submitPublicationRequestSchema, body),
    );
  }

  @Post('promotions')
  promote(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const current = context(request);
    return this.publishing.promote(
      current.tenant,
      current.auth.userId,
      capabilityId,
      idempotencyKey(key),
      parse(promotePublicationRequestSchema, body),
    );
  }

  @Get('versions')
  versions(@Req() request: TenantRequest, @Param('capabilityId') capabilityId: string) {
    const current = context(request);
    return this.publishing.versions(current.tenant, current.auth.userId, capabilityId);
  }

  @Get('versions/:versionId')
  version(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('versionId') versionId: string,
  ) {
    const current = context(request);
    return this.publishing.version(current.tenant, current.auth.userId, capabilityId, versionId);
  }

  @Get('versions/:versionId/diff')
  diff(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('versionId') versionId: string,
    @Query() query: unknown,
  ) {
    const current = context(request);
    const input = parse(versionDiffQuerySchema, query);
    return this.publishing.diff(current.tenant, current.auth.userId, capabilityId, versionId, input.against);
  }

  @Post('versions/:versionId/deprecate')
  deprecate(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('versionId') versionId: string,
  ) {
    const current = context(request);
    return this.publishing.transition(current.tenant, current.auth.userId, capabilityId, versionId, 'deprecate');
  }

  @Post('versions/:versionId/withdraw')
  withdrawVersion(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('versionId') versionId: string,
  ) {
    const current = context(request);
    return this.publishing.transition(current.tenant, current.auth.userId, capabilityId, versionId, 'withdraw');
  }

  @Post('versions/:versionId/archive')
  archive(
    @Req() request: TenantRequest,
    @Param('capabilityId') capabilityId: string,
    @Param('versionId') versionId: string,
  ) {
    const current = context(request);
    return this.publishing.transition(current.tenant, current.auth.userId, capabilityId, versionId, 'archive');
  }
}
