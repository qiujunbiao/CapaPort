import { describe, expect, it } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import { normalizeIdentity, validatePasswordStrength } from './identity.policy.js';

describe('identity policy', () => {
  it('normalizes email, E.164 phones, and mainland mobile numbers deterministically', () => {
    expect(normalizeIdentity('email', '  User.Name@EXAMPLE.com ')).toBe('user.name@example.com');
    expect(normalizeIdentity('phone', ' +86 138-0013-8000 ')).toBe('+8613800138000');
    expect(normalizeIdentity('phone', '15000836993')).toBe('+8615000836993');
  });

  it('rejects malformed identities', () => {
    expect(() => normalizeIdentity('email', 'not-an-email')).toThrow(/email/i);
    expect(() => normalizeIdentity('phone', '12345678901')).toThrow(/E.164/i);
  });

  it('uses Unicode code points for the 8 to 256 character boundary', () => {
    expect(() => validatePasswordStrength('海岸松林星河')).toThrowError(
      expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SHORT' } satisfies Partial<AppError>),
    );
    expect(validatePasswordStrength('海岸松林星河远山')).toBeUndefined();
    expect(() => validatePasswordStrength('a'.repeat(257))).toThrowError(
      expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_LONG' } satisfies Partial<AppError>),
    );
  });

  it('accepts memorable passwords without composition requirements', () => {
    expect(validatePasswordStrength('river-stone-82')).toBeUndefined();
    expect(validatePasswordStrength('gentle ocean lantern')).toBeUndefined();
  });

  it('rejects common and identity-derived passwords with actionable Chinese errors', () => {
    expect(() => validatePasswordStrength('password')).toThrowError(
      expect.objectContaining({
        code: 'AUTH_PASSWORD_TOO_SIMPLE',
        fieldErrors: { password: ['该密码过于简单或容易被猜到，请换一个密码。'] },
      } satisfies Partial<AppError>),
    );
    expect(() =>
      validatePasswordStrength('person2026', { identity: 'person@example.com', displayName: 'Person' }),
    ).toThrowError(expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SIMPLE' } satisfies Partial<AppError>));
  });
});
