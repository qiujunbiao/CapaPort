import { describe, expect, it } from 'vitest';
import { SessionService, type SessionStore } from '../../src/modules/identity/session.service.js';

describe('refresh-token replay containment', () => {
  it('revokes the complete token family after an already-rotated token is replayed', async () => {
    let used = false;
    let familyRevoked = false;
    const store: SessionStore = {
      create: async () => undefined,
      rotate: async () => {
        if (used) return { status: 'replay' };
        used = true;
        return { status: 'rotated', userId: 'user-1', sessionId: 'session-1' };
      },
      revoke: async () => undefined,
      revokeFamily: async () => {
        familyRevoked = true;
      },
      assertActive: async () => !familyRevoked,
      list: async () => [],
    };
    const service = new SessionService(store, {
      jwtSecret: 'test-jwt-secret-that-is-longer-than-thirty-two-characters',
      refreshPepper: 'test-refresh-pepper-longer-than-thirty-two-characters',
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
    });
    const initial = await service.issue('user-1', { deviceName: 'Security test' });
    const rotated = await service.refresh(initial.refreshToken);
    await expect(service.refresh(initial.refreshToken)).rejects.toMatchObject({ code: 'AUTH_REFRESH_REPLAY' });
    expect(familyRevoked).toBe(true);
    await expect(service.authenticate(rotated.accessToken)).rejects.toMatchObject({ code: 'AUTH_ACCESS_INVALID' });
  });
});
