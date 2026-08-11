import { describe, expect, it, vi } from 'vitest';
import {
  DevelopmentPasswordRiskChecker,
  GooglePasswordRiskChecker,
  PasswordRiskCheckUnavailableError,
} from './password-risk-checker.js';

const testPassword = 'river-stone-82';

function googleDependencies(options: { leaked?: boolean; reject?: Error; pending?: boolean } = {}) {
  const verification = {
    getLookupHashPrefix: vi.fn().mockReturnValue(Uint8Array.from([1, 2, 3])),
    getEncryptedUserCredentialsHash: vi.fn().mockReturnValue(Uint8Array.from([4, 5, 6])),
    verify: vi.fn().mockReturnValue(options.leaked ?? false),
  };
  const createVerification = vi.fn().mockResolvedValue(verification);
  const createAssessment = options.pending
    ? vi.fn().mockReturnValue(new Promise(() => undefined))
    : options.reject
      ? vi.fn().mockRejectedValue(options.reject)
      : vi.fn().mockResolvedValue([
          {
            privatePasswordLeakVerification: {
              reencryptedUserCredentialsHash: Uint8Array.from([7, 8]),
              encryptedLeakMatchPrefixes: [Uint8Array.from([9, 10])],
            },
          },
        ]);
  return { verification, createVerification, createAssessment };
}

describe('password risk checker', () => {
  it('returns the locally verified Google Password Defense verdict', async () => {
    const dependencies = googleDependencies({ leaked: true });
    const checker = new GooglePasswordRiskChecker(
      { projectId: 'capaport-production', timeoutMs: 500 },
      dependencies,
    );

    await expect(checker.check('person@example.com', testPassword)).resolves.toBe('compromised');
    expect(dependencies.createAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'projects/capaport-production',
        assessment: {
          privatePasswordLeakVerification: {
            lookupHashPrefix: Uint8Array.from([1, 2, 3]),
            encryptedUserCredentialsHash: Uint8Array.from([4, 5, 6]),
          },
        },
      }),
    );
    expect(dependencies.verification.verify).toHaveBeenCalledWith(
      Uint8Array.from([7, 8]),
      [Uint8Array.from([9, 10])],
    );
  });

  it('maps provider failures to a password-free unavailable error', async () => {
    const dependencies = googleDependencies({ reject: new Error(`provider failed for ${testPassword}`) });
    const checker = new GooglePasswordRiskChecker(
      { projectId: 'capaport-production', timeoutMs: 500 },
      dependencies,
    );

    const error = await checker.check('person@example.com', testPassword).catch((caught) => caught);
    expect(error).toBeInstanceOf(PasswordRiskCheckUnavailableError);
    expect(JSON.stringify(error)).not.toContain(testPassword);
  });

  it('enforces the configured assessment timeout', async () => {
    vi.useFakeTimers();
    const checker = new GooglePasswordRiskChecker(
      { projectId: 'capaport-production', timeoutMs: 500 },
      googleDependencies({ pending: true }),
    );
    const result = checker.check('person@example.com', testPassword);
    const expectation = expect(result).rejects.toBeInstanceOf(PasswordRiskCheckUnavailableError);
    await vi.advanceTimersByTimeAsync(501);
    await expectation;
    vi.useRealTimers();
  });

  it('uses an explicit safe checker only for development and tests', async () => {
    await expect(new DevelopmentPasswordRiskChecker().check('person@example.com', testPassword)).resolves.toBe(
      'safe',
    );
  });
});
