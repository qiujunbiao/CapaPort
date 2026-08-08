import { describe, expect, it } from 'vitest';
import { normalizeIdentity, validatePasswordStrength } from './identity.policy.js';

describe('identity policy', () => {
  it('normalizes email, E.164 phones, and mainland mobile numbers deterministically', () => {
    expect(normalizeIdentity('email', '  User.Name@EXAMPLE.com ')).toBe('user.name@example.com');
    expect(normalizeIdentity('phone', ' +86 138-0013-8000 ')).toBe('+8613800138000');
    expect(normalizeIdentity('phone', '15000836993')).toBe('+8615000836993');
  });

  it('rejects malformed identities and weak passwords', () => {
    expect(() => normalizeIdentity('email', 'not-an-email')).toThrow(/email/i);
    expect(() => normalizeIdentity('phone', '12345678901')).toThrow(/E.164/i);
    expect(() => validatePasswordStrength('password123')).toThrow(/password/i);
    expect(validatePasswordStrength('Correct-Horse9-Battery!')).toBeUndefined();
  });
});
