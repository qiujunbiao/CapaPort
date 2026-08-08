import {
  loginRequestSchema,
  recoveryCompleteRequestSchema,
  recoveryStartRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  verificationRequestSchema,
} from '@capaport/contracts/auth';
import { zodFieldErrors } from '@capaport/contracts/errors';
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
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
import { RateLimitService } from '../../platform/security/rate-limit.service.js';
import { RecentAuthGuard } from '../../platform/security/recent-auth.guard.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';
import { IdentityService } from './identity.service.js';
import { SessionService } from './session.service.js';

type RequestWithAuth = FastifyRequest & AuthenticatedRequest;

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, zodFieldErrors(result.error));
  }
  return result.data;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = parse(registerRequestSchema, body);
    await this.rateLimits.assertAllowed('verification', this.dimensions(request, input.target));
    return this.identity.register(input);
  }

  @Post('verify')
  async verify(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = parse(verificationRequestSchema, body);
    await this.rateLimits.assertAllowed('verification', this.dimensions(request, input.challengeId));
    return this.identity.verify(input.challengeId, input.code);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: unknown, @Req() request: FastifyRequest) {
    const userAgent = request.headers['user-agent'];
    return this.identity.login(parse(loginRequestSchema, body), {
      ipAddress: request.ip,
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: unknown) {
    return this.sessions.refresh(parse(refreshRequestSchema, body).refreshToken);
  }

  @Post('recovery/start')
  @HttpCode(HttpStatus.ACCEPTED)
  async startRecovery(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = parse(recoveryStartRequestSchema, body);
    await this.rateLimits.assertAllowed('recovery', this.dimensions(request, input.target));
    return this.identity.startRecovery(input);
  }

  @Post('recovery/complete')
  async completeRecovery(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = parse(recoveryCompleteRequestSchema, body);
    await this.rateLimits.assertAllowed('recovery', this.dimensions(request, input.challengeId));
    return this.identity.completeRecovery(input);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: RequestWithAuth): Promise<void> {
    if (request.auth) await this.sessions.revoke(request.auth.userId, request.auth.sessionId);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: RequestWithAuth) {
    return this.identity.me(request.auth?.userId ?? '');
  }

  @Get('me/export')
  @UseGuards(AuthGuard, RecentAuthGuard)
  async exportAccount(@Req() request: RequestWithAuth) {
    const userId = request.auth?.userId;
    if (!userId) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    const data = await this.identity.exportAccount(userId);
    return new StreamableFile(Buffer.from(JSON.stringify(data)), {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="capaport-account-${userId}.json"`,
    });
  }

  @Post('me/deletion')
  @UseGuards(AuthGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  requestAccountDeletion(@Req() request: RequestWithAuth) {
    const userId = request.auth?.userId;
    if (!userId) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    return this.identity.requestDeletion(userId);
  }

  @Get('me/deletion')
  @UseGuards(AuthGuard)
  accountDeletionStatus(@Req() request: RequestWithAuth) {
    const userId = request.auth?.userId;
    if (!userId) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    return this.identity.deletionStatus(userId);
  }

  @Delete('me/deletion')
  @UseGuards(AuthGuard, RecentAuthGuard)
  cancelAccountDeletion(@Req() request: RequestWithAuth) {
    const userId = request.auth?.userId;
    if (!userId) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    return this.identity.cancelDeletion(userId);
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  listSessions(@Req() request: RequestWithAuth) {
    const auth = request.auth;
    if (!auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    return this.sessions.list(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(AuthGuard, RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@Req() request: RequestWithAuth, @Param('sessionId') sessionId: string): Promise<void> {
    const auth = request.auth;
    if (!auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    await this.sessions.revoke(auth.userId, sessionId, 'user_revoked');
  }

  private dimensions(request: FastifyRequest, account: string) {
    const deviceHeader = request.headers['x-device-id'];
    const userAgent = request.headers['user-agent'];
    return {
      account: account.trim().toLowerCase(),
      ipAddress: request.ip,
      deviceId:
        typeof deviceHeader === 'string'
          ? deviceHeader
          : typeof userAgent === 'string'
            ? userAgent.slice(0, 512)
            : 'unknown',
    };
  }
}
