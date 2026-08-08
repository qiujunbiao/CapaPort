import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import { SessionService, type SessionStore } from './session.service.js';

const config = {
  jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters',
  refreshPepper: 'refresh-pepper-that-is-at-least-thirty-two-chars',
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
};

describe('SessionService', () => {
  it('rotates a refresh token and rejects replay by revoking the token family', async () => {
    const store: SessionStore = {
      create: vi.fn().mockResolvedValue(undefined),
      rotate: vi
        .fn()
        .mockResolvedValueOnce({ status: 'rotated', userId: 'user-1', sessionId: 'session-1' })
        .mockResolvedValueOnce({ status: 'replay' }),
      revoke: vi.fn().mockResolvedValue(undefined),
      revokeFamily: vi.fn().mockResolvedValue(undefined),
      assertActive: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
    };
    const service = new SessionService(store, config);
    const issued = await service.issue('user-1', { deviceName: 'MacBook', ipAddress: '127.0.0.1', userAgent: 'test' });
    await expect(service.authenticate(issued.accessToken)).resolves.toEqual(
      expect.objectContaining({ recentlyAuthenticatedAt: expect.any(Number) }),
    );
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({ ipHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      }),
    );
    expect(JSON.stringify(vi.mocked(store.create).mock.calls)).not.toContain('127.0.0.1');
    const rotated = await service.refresh(issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    await expect(service.authenticate(rotated.accessToken)).resolves.toEqual(
      expect.objectContaining({ recentlyAuthenticatedAt: 0 }),
    );

    await expect(service.refresh(issued.refreshToken)).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REPLAY',
    } satisfies Partial<AppError>);
    expect(store.revokeFamily).toHaveBeenCalled();
  });

  it('never exposes token digests in session lists', async () => {
    const store: SessionStore = {
      create: vi.fn(),
      rotate: vi.fn(),
      revoke: vi.fn(),
      revokeFamily: vi.fn(),
      assertActive: vi.fn(),
      list: vi
        .fn()
        .mockResolvedValue([
          { id: 's1', deviceName: 'Windows', createdAt: new Date(), lastUsedAt: new Date(), current: true },
        ]),
    };
    await expect(new SessionService(store, config).list('user-1', 's1')).resolves.toEqual([
      expect.not.objectContaining({ refreshTokenDigest: expect.anything() }),
    ]);
  });
});
