import {
  loginRequestSchema,
  recoveryCompleteRequestSchema,
  recoveryStartRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  verificationRequestSchema,
} from '@agentdoor/contracts/auth';
import { zodFieldErrors } from '@agentdoor/contracts/errors';
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
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { AppError } from '../../platform/errors/app-error.js';
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
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(@Body() body: unknown) {
    return this.identity.register(parse(registerRequestSchema, body));
  }

  @Post('verify')
  verify(@Body() body: unknown) {
    const input = parse(verificationRequestSchema, body);
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
  startRecovery(@Body() body: unknown) {
    return this.identity.startRecovery(parse(recoveryStartRequestSchema, body));
  }

  @Post('recovery/complete')
  completeRecovery(@Body() body: unknown) {
    return this.identity.completeRecovery(parse(recoveryCompleteRequestSchema, body));
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

  @Get('sessions')
  @UseGuards(AuthGuard)
  listSessions(@Req() request: RequestWithAuth) {
    const auth = request.auth;
    if (!auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    return this.sessions.list(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@Req() request: RequestWithAuth, @Param('sessionId') sessionId: string): Promise<void> {
    const auth = request.auth;
    if (!auth) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    await this.sessions.revoke(auth.userId, sessionId, 'user_revoked');
  }
}
