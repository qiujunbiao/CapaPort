import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../modules/identity/auth.guard.js';
import { AppError } from '../errors/app-error.js';

export const RECENT_AUTH_MAX_AGE_SECONDS = 300;

@Injectable()
export class RecentAuthGuard implements CanActivate {
  private readonly now: () => number;

  constructor(@Optional() @Inject('SECURITY_CLOCK') now?: () => number) {
    this.now = now ?? Date.now;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authenticatedAt = request.auth?.recentlyAuthenticatedAt;
    const ageSeconds = Math.floor(this.now() / 1000) - (authenticatedAt ?? 0);
    if (!authenticatedAt || ageSeconds < 0 || ageSeconds > RECENT_AUTH_MAX_AGE_SECONDS) {
      throw new AppError('AUTH_RECENT_REQUIRED', 'Sign in again before performing this sensitive operation.', 401);
    }
    return true;
  }
}
