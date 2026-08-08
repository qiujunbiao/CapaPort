import type { AuthenticatedUser } from '@capaport/contracts/auth';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { SessionService } from './session.service.js';

export type AuthenticatedRequest = {
  headers: { authorization?: string };
  auth?: AuthenticatedUser;
  ip?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (!token) throw new AppError('AUTH_REQUIRED', 'Authentication is required.', 401);
    request.auth = await this.sessions.authenticate(token);
    return true;
  }
}
