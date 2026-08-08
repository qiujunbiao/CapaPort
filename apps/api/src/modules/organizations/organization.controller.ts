import { zodFieldErrors } from '@capaport/contracts/errors';
import {
  acceptInvitationRequestSchema,
  changeOrganizationRoleRequestSchema,
  closeOrganizationRequestSchema,
  createOrganizationRequestSchema,
  inviteMemberRequestSchema,
  transferOwnershipRequestSchema,
  updateOrganizationRequestSchema,
  organizationSecurityPolicySchema,
} from '@capaport/contracts/organizations';
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
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { RateLimitService } from '../../platform/security/rate-limit.service.js';
import { RecentAuthGuard } from '../../platform/security/recent-auth.guard.js';
import { TenantGuard, type TenantRequest } from '../../platform/tenancy/tenant.guard.js';
import { type AuthenticatedRequest, AuthGuard } from '../identity/auth.guard.js';
import { OrganizationService } from './organization.service.js';
import { SecurityPolicyService } from './security-policy.service.js';

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(result.error));
  return result.data;
}

function auth(request: AuthenticatedRequest) {
  if (!request.auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
  return request.auth;
}

function tenant(request: TenantRequest) {
  if (!request.tenant) throw new AppError('TENANT_REQUIRED', 'Select an organization before continuing.', 400);
  return request.tenant;
}

@Controller('organizations')
export class OrganizationController {
  constructor(
    @Inject(OrganizationService) private readonly organizations: OrganizationService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
    @Inject(SecurityPolicyService) private readonly securityPolicies: SecurityPolicyService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const user = auth(request);
    return this.organizations.create(user.userId, user.sessionId, parse(createOrganizationRequestSchema, body));
  }

  @Get()
  @UseGuards(AuthGuard)
  list(@Req() request: AuthenticatedRequest) {
    return this.organizations.list(auth(request).userId);
  }

  @Post('invitations/accept')
  @UseGuards(AuthGuard)
  accept(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const user = auth(request);
    return this.organizations.accept(user.userId, user.sessionId, parse(acceptInvitationRequestSchema, body).token);
  }

  @Post(':organizationId/switch')
  @UseGuards(AuthGuard)
  switch(@Req() request: AuthenticatedRequest, @Param('organizationId') organizationId: string) {
    const user = auth(request);
    return this.organizations.switch(user.userId, user.sessionId, organizationId);
  }

  @Get(':organizationId')
  @UseGuards(AuthGuard, TenantGuard)
  get(@Req() request: TenantRequest) {
    return this.organizations.get(tenant(request));
  }

  @Patch(':organizationId')
  @UseGuards(AuthGuard, TenantGuard)
  update(@Req() request: TenantRequest, @Body() body: unknown) {
    return this.organizations.update(tenant(request), parse(updateOrganizationRequestSchema, body));
  }

  @Delete(':organizationId')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  closeLegacy(@Req() request: TenantRequest) {
    const user = auth(request);
    return this.organizations.close(tenant(request), user.userId);
  }

  @Post(':organizationId/closure')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  close(@Req() request: TenantRequest, @Body() body: unknown) {
    const user = auth(request);
    return this.organizations.close(
      tenant(request),
      user.userId,
      parse(closeOrganizationRequestSchema, body).confirmation,
    );
  }

  @Delete(':organizationId/closure')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  cancelClosure(@Req() request: TenantRequest) {
    const user = auth(request);
    return this.organizations.cancelClosure(tenant(request), user.userId);
  }

  @Get(':organizationId/export')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  async export(@Req() request: TenantRequest) {
    const data = await this.organizations.export(tenant(request));
    return new StreamableFile(Buffer.from(JSON.stringify(data)), {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="capaport-organization-${tenant(request).organizationId}.json"`,
    });
  }

  @Get(':organizationId/members')
  @UseGuards(AuthGuard, TenantGuard)
  members(@Req() request: TenantRequest) {
    return this.organizations.members(tenant(request));
  }

  @Get(':organizationId/security-policy')
  @UseGuards(AuthGuard, TenantGuard)
  securityPolicy(@Req() request: TenantRequest) {
    return this.securityPolicies.get(tenant(request));
  }

  @Patch(':organizationId/security-policy')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  updateSecurityPolicy(@Req() request: TenantRequest, @Body() body: unknown) {
    return this.securityPolicies.update(tenant(request), parse(organizationSecurityPolicySchema, body));
  }

  @Patch(':organizationId/members/:membershipId/role')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  changeRole(@Req() request: TenantRequest, @Param('membershipId') membershipId: string, @Body() body: unknown) {
    return this.organizations.changeRole(
      tenant(request),
      membershipId,
      parse(changeOrganizationRoleRequestSchema, body).role,
    );
  }

  @Delete(':organizationId/members/:membershipId')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Req() request: TenantRequest, @Param('membershipId') membershipId: string) {
    return this.organizations.removeMember(tenant(request), membershipId);
  }

  @Post(':organizationId/owner/transfer')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  transferOwnership(@Req() request: TenantRequest, @Body() body: unknown) {
    return this.organizations.transferOwnership(
      tenant(request),
      parse(transferOwnershipRequestSchema, body).membershipId,
    );
  }

  @Post(':organizationId/leave')
  @UseGuards(AuthGuard, TenantGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@Req() request: TenantRequest) {
    return this.organizations.leave(tenant(request));
  }

  @Post(':organizationId/invitations')
  @UseGuards(AuthGuard, TenantGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async invite(@Req() request: TenantRequest, @Body() body: unknown) {
    const user = auth(request);
    await this.rateLimits.assertAllowed('invitation', {
      account: user.userId,
      ...(request.ip ? { ipAddress: request.ip } : {}),
      deviceId: user.sessionId,
    });
    return this.organizations.invite(tenant(request), user.userId, parse(inviteMemberRequestSchema, body));
  }

  @Get(':organizationId/invitations')
  @UseGuards(AuthGuard, TenantGuard)
  invitations(@Req() request: TenantRequest) {
    return this.organizations.invitations(tenant(request));
  }

  @Delete(':organizationId/invitations/:invitationId')
  @UseGuards(AuthGuard, TenantGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(@Req() request: TenantRequest, @Param('invitationId') invitationId: string) {
    return this.organizations.revokeInvitation(tenant(request), invitationId);
  }
}
