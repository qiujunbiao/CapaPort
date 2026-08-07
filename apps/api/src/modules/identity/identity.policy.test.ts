import { describe, expect, it } from 'vitest';
import { normalizeIdentity, validatePasswordStrength } from './identity.policy.js';

describe('identity policy', () => {
  it('normalizes email and E.164 phone identities deterministically', () => {
    expect(normalizeIdentity('email', '  User.Name@EXAMPLE.com ')).toBe('user.name@example.com');
    expect(normalizeIdentity('phone', ' +86 138-0013-8000 ')).toBe('+8613800138000');
  });

  it('rejects malformed identities and weak passwords', () => {
    expect(() => normalizeIdentity('email', 'not-an-email')).toThrow(/email/i);
    expect(() => normalizeIdentity('phone', '13800138000')).toThrow(/E.164/i);
    expect(() => validatePasswordStrength('password123')).toThrow(/password/i);
    expect(validatePasswordStrength('Correct-Horse9-Battery!')).toBeUndefined();
  });
});
