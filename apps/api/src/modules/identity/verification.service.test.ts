import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/config.js';
import type { AppError } from '../../platform/errors/app-error.js';
import { type VerificationSender, VerificationService, type VerificationStore } from './verification.service.js';

const config = {
  verificationPepper: 'verification-pepper-that-is-at-least-thirty-two-chars',
  verificationTtlMinutes: 10,
};

describe('VerificationService', () => {
  it('returns the one-time code only when the API runs in development', async () => {
    const store: VerificationStore = {
      createChallenge: vi.fn().mockResolvedValue(undefined),
      consumeChallenge: vi.fn(),
      authorizeChallenge: vi.fn(),
      markIdentityVerified: vi.fn(),
    };
    const sender: VerificationSender = { send: vi.fn().mockResolvedValue(undefined) };
    const service = new VerificationService(store, sender, {
      nodeEnv: 'development',
      auth: config,
    } as AppConfig);

    const result = await service.create('verify_identity', 'phone', '+8615000836993', 'user-1', 'identity-1');

    expect(result).toHaveProperty('developmentCode', expect.stringMatching(/^\d{6}$/));
    expect(result.developmentCode).toBe(vi.mocked(sender.send).mock.calls[0]?.[0].code);
  });

  it('delivers a one-time code while returning only redacted challenge metadata', async () => {
    const store: VerificationStore = {
      createChallenge: vi.fn().mockResolvedValue(undefined),
      consumeChallenge: vi.fn(),
      authorizeChallenge: vi.fn(),
      markIdentityVerified: vi.fn(),
    };
    const sender: VerificationSender = { send: vi.fn().mockResolvedValue(undefined) };
    const service = new VerificationService(store, sender, config);
    const result = await service.create('verify_identity', 'email', 'user@example.com', 'user-1', 'identity-1');

    expect(result).toMatchObject({ maskedTarget: 'us***@example.com', expiresIn: 600 });
    expect(result).not.toHaveProperty('code');
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ code: expect.stringMatching(/^\d{6}$/) }));
    expect(store.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ codeDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it('rejects expired and already-used verification challenges', async () => {
    const store: VerificationStore = {
      createChallenge: vi.fn(),
      authorizeChallenge: vi.fn(),
      consumeChallenge: vi
        .fn()
        .mockResolvedValueOnce({ status: 'expired' })
        .mockResolvedValueOnce({ status: 'already_used' }),
      markIdentityVerified: vi.fn(),
    };
    const service = new VerificationService(store, { send: vi.fn() }, config);
    await expect(service.verifyIdentity('00000000-0000-4000-8000-000000000001', '123456')).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_EXPIRED',
    } satisfies Partial<AppError>);
    await expect(service.verifyIdentity('00000000-0000-4000-8000-000000000001', '123456')).rejects.toMatchObject({
      code: 'AUTH_VERIFICATION_USED',
    } satisfies Partial<AppError>);
  });

  it('authorizes password recovery without consuming the one-time challenge', async () => {
    const store: VerificationStore = {
      createChallenge: vi.fn(),
      consumeChallenge: vi.fn(),
      authorizeChallenge: vi.fn().mockResolvedValue({
        status: 'authorized',
        userId: 'user-1',
        identityId: 'identity-1',
        kind: 'email',
        target: 'person@example.com',
      }),
      markIdentityVerified: vi.fn(),
    };
    const service = new VerificationService(store, { send: vi.fn() }, config);

    await expect(service.authorizeRecovery('challenge-1', '123456')).resolves.toMatchObject({
      userId: 'user-1',
      target: 'person@example.com',
      codeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(store.authorizeChallenge).toHaveBeenCalledWith(
      'challenge-1',
      'recover_password',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );
    expect(store.consumeChallenge).not.toHaveBeenCalled();
  });
});
