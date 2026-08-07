import { describe, expect, it, vi } from 'vitest';
import { RedisLoginRateLimiter } from '../../apps/api/src/modules/identity/login-rate-limiter.js';
import { SessionService, type SessionStore } from '../../apps/api/src/modules/identity/session.service.js';
import {
  type OrganizationDataStore,
  type OrganizationInvitationSender,
  OrganizationService,
} from '../../apps/api/src/modules/organizations/organization.service.js';

const authConfig = {
  jwtSecret: 'security-gate-jwt-secret-longer-than-thirty-two-characters',
  refreshPepper: 'security-gate-refresh-pepper-longer-than-thirty-two-characters',
  verificationPepper: 'security-gate-verification-pepper-longer-than-thirty-two-characters',
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
};

describe('authentication replay and rate-limit gate', () => {
  it('revokes a refresh family when an already-rotated token is replayed', async () => {
    const store: SessionStore = {
      create: vi.fn(),
      rotate: vi.fn().mockResolvedValue({ status: 'replay' }),
      revoke: vi.fn(),
      revokeFamily: vi.fn(),
      assertActive: vi.fn(),
      list: vi.fn(),
    };
    const service = new SessionService(store, authConfig);
    await expect(service.refresh('replayed-refresh-token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_REPLAY' });
    expect(store.revokeFamily).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), 'refresh_token_replay');
    expect(JSON.stringify(vi.mocked(store.revokeFamily).mock.calls)).not.toContain('replayed-refresh-token');
  });

  it('uses an HMAC-scoped identity and IP key and blocks the sixth failed login', async () => {
    let count = 0;
    const redis = {
      client: {
        get: vi.fn(async () => String(count)),
        incr: vi.fn(async () => ++count),
        expire: vi.fn(),
        del: vi.fn(),
      },
    };
    const limiter = new RedisLoginRateLimiter(redis as never, { auth: authConfig } as never);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.assertAllowed('member@example.com', '203.0.113.4');
      await limiter.recordFailure('member@example.com', '203.0.113.4');
    }
    await expect(limiter.assertAllowed('member@example.com', '203.0.113.4')).rejects.toMatchObject({
      code: 'AUTH_LOGIN_RATE_LIMITED',
      statusCode: 429,
    });
    const key = redis.client.get.mock.calls[0]?.[0];
    expect(key).toMatch(/^auth:login:[a-f0-9]{64}$/);
    expect(key).not.toContain('member@example.com');
    expect(key).not.toContain('203.0.113.4');
  });

  it('rejects a replayed single-use organization invitation with a stable code', async () => {
    const repository = {
      acceptInvitation: vi.fn().mockResolvedValue({ status: 'already_used' }),
    } as unknown as OrganizationDataStore;
    const sender = { send: vi.fn() } satisfies OrganizationInvitationSender;
    const service = new OrganizationService(repository, { switch: vi.fn() }, sender, {
      verificationPepper: authConfig.verificationPepper,
    });
    await expect(service.accept('user-a', 'session-a', 'x'.repeat(48))).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_USED',
      statusCode: 409,
    });
    expect(repository.acceptInvitation).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'user-a',
      expect.any(Date),
    );
  });
});
