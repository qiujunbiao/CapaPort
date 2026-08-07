import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import { type VerificationSender, VerificationService, type VerificationStore } from './verification.service.js';

const config = {
  verificationPepper: 'verification-pepper-that-is-at-least-thirty-two-chars',
  verificationTtlMinutes: 10,
};

describe('VerificationService', () => {
  it('delivers a one-time code while returning only redacted challenge metadata', async () => {
    const store: VerificationStore = {
      createChallenge: vi.fn().mockResolvedValue(undefined),
      consumeChallenge: vi.fn(),
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
});
