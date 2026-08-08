import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../platform/errors/app-error.js';
import { type IdentityDataStore, IdentityService, type PasswordHasher, type RateLimiter } from './identity.service.js';

function dependencies() {
  const repository: IdentityDataStore = {
    findIdentity: vi.fn().mockResolvedValue(undefined),
    createRegistration: vi.fn().mockResolvedValue(undefined),
    changePasswordAndRevoke: vi.fn().mockResolvedValue(undefined),
    listIdentities: vi.fn().mockResolvedValue([]),
    exportAccount: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
    requestAccountDeletion: vi.fn().mockResolvedValue(undefined),
    cancelAccountDeletion: vi.fn().mockResolvedValue(undefined),
    accountDeletionStatus: vi.fn().mockResolvedValue(undefined),
  };
  const password: PasswordHasher = {
    hash: vi.fn().mockResolvedValue('argon2id-hash'),
    verify: vi.fn().mockResolvedValue(true),
  };
  const verification = {
    prepare: vi.fn().mockReturnValue({
      id: 'challenge-1',
      code: '123456',
      codeDigest: 'digest',
      expiresAt: new Date(Date.now() + 600_000),
      purpose: 'verify_identity' as const,
      kind: 'email' as const,
      target: 'person@example.com',
      userId: 'user-1',
      identityId: 'identity-1',
    }),
    deliver: vi.fn().mockResolvedValue(undefined),
    publicMetadata: vi.fn().mockReturnValue({
      challengeId: 'challenge-1',
      maskedTarget: 'pe***@example.com',
      expiresIn: 600,
    }),
    verifyIdentity: vi.fn(),
    create: vi.fn(),
    consumeRecovery: vi.fn(),
  };
  const sessions = {
    issue: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }),
  };
  const rateLimiter: RateLimiter = { assertAllowed: vi.fn(), recordFailure: vi.fn(), clear: vi.fn() };
  return { repository, password, verification, sessions, rateLimiter };
}

describe('IdentityService', () => {
  it('preserves development challenge metadata returned by the verification service', async () => {
    const deps = dependencies();
    vi.mocked(deps.verification.publicMetadata).mockReturnValueOnce({
      challengeId: 'challenge-1',
      maskedTarget: 'pe***@example.com',
      expiresIn: 600,
      developmentCode: '123456',
    });

    const result = await new IdentityService(
      deps.repository,
      deps.password,
      deps.verification,
      deps.sessions,
      deps.rateLimiter,
    ).register({
      kind: 'email',
      target: 'person@example.com',
      password: 'Correct-Horse9-Battery!',
      displayName: 'Person',
    });

    expect(result).toMatchObject({ challengeId: 'challenge-1', developmentCode: '123456' });
  });

  it('registers email identities without exposing secrets or password hashes', async () => {
    const deps = dependencies();
    const result = await new IdentityService(
      deps.repository,
      deps.password,
      deps.verification,
      deps.sessions,
      deps.rateLimiter,
    ).register({
      kind: 'email',
      target: ' Person@Example.com ',
      password: 'Correct-Horse9-Battery!',
      displayName: 'Person',
    });
    expect(result).toEqual({ challengeId: 'challenge-1', maskedTarget: 'pe***@example.com', expiresIn: 600 });
    expect(JSON.stringify(result)).not.toContain('argon2id-hash');
    expect(deps.repository.createRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedValue: 'person@example.com', passwordHash: 'argon2id-hash' }),
    );
  });

  it('rejects duplicate identities and rate-limited logins', async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.findIdentity).mockResolvedValueOnce({
      identityId: 'identity-1',
      userId: 'user-1',
      kind: 'email',
      normalizedValue: 'person@example.com',
      verifiedAt: new Date(),
      displayName: 'Person',
      passwordHash: 'hash',
      status: 'active',
    });
    const service = new IdentityService(
      deps.repository,
      deps.password,
      deps.verification,
      deps.sessions,
      deps.rateLimiter,
    );
    await expect(
      service.register({
        kind: 'email',
        target: 'person@example.com',
        password: 'Correct-Horse9-Battery!',
        displayName: 'Person',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_IDENTITY_EXISTS' } satisfies Partial<AppError>);

    vi.mocked(deps.rateLimiter.assertAllowed).mockRejectedValueOnce(
      new AppError('AUTH_LOGIN_RATE_LIMITED', 'Wait.', 429),
    );
    await expect(
      service.login(
        { kind: 'email', target: 'person@example.com', password: 'Correct-Horse9-Battery!', deviceName: 'Mac' },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_LOGIN_RATE_LIMITED' } satisfies Partial<AppError>);
  });

  it('uses a dummy Argon2 hash so unknown-account logins keep a stable response shape and work factor', async () => {
    const deps = dependencies();
    vi.mocked(deps.password.verify).mockResolvedValueOnce(false);
    const service = new IdentityService(
      deps.repository,
      deps.password,
      deps.verification,
      deps.sessions,
      deps.rateLimiter,
    );
    await expect(
      service.login(
        { kind: 'email', target: 'missing@example.com', password: 'Incorrect-Password9!', deviceName: 'Unknown' },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_CREDENTIALS_INVALID', message: expect.stringContaining('Email') });
    expect(deps.password.verify).toHaveBeenCalledWith(expect.stringMatching(/^\$argon2id\$/), 'Incorrect-Password9!');
    expect(deps.rateLimiter.recordFailure).toHaveBeenCalled();
  });
});
