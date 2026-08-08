import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AppError } from '../errors/app-error.js';
import { RecentAuthGuard } from './recent-auth.guard.js';

function context(recentlyAuthenticatedAt?: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        auth: {
          userId: 'user-1',
          sessionId: 'session-1',
          ...(recentlyAuthenticatedAt === undefined ? {} : { recentlyAuthenticatedAt }),
        },
      }),
    }),
  } as ExecutionContext;
}

describe('RecentAuthGuard', () => {
  it('accepts authentication performed within five minutes', () => {
    const now = Date.parse('2026-08-08T10:00:00Z');
    const guard = new RecentAuthGuard(() => now);
    expect(guard.canActivate(context(Math.floor(now / 1000) - 299))).toBe(true);
  });

  it.each([undefined, Math.floor(Date.parse('2026-08-08T09:54:59Z') / 1000)])(
    'rejects missing or stale authentication time',
    (authTime) => {
      const guard = new RecentAuthGuard(() => Date.parse('2026-08-08T10:00:00Z'));
      expect(() => guard.canActivate(context(authTime))).toThrowError(
        expect.objectContaining({ code: 'AUTH_RECENT_REQUIRED', statusCode: 401 }) as AppError,
      );
    },
  );
});
