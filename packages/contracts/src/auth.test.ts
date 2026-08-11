import { describe, expect, it } from 'vitest';
import {
  loginRequestSchema,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
  PASSWORD_POLICY_HINT,
  registerRequestSchema,
} from './auth.js';
import { zodFieldErrors } from './errors.js';

describe('authentication contracts', () => {
  it('publishes one password policy for every client', () => {
    expect(PASSWORD_MIN_CODE_POINTS).toBe(8);
    expect(PASSWORD_MAX_CODE_POINTS).toBe(256);
    expect(PASSWORD_POLICY_HINT).toBe(
      '密码至少 8 个字符，可使用字母、数字和符号。请勿使用常见、容易猜测或已泄露的密码。',
    );
  });

  it('accepts the documented registration and login payloads', () => {
    expect(
      registerRequestSchema.parse({
        kind: 'email',
        target: 'person@example.com',
        password: 'Correct-Horse9-Battery!',
        displayName: 'Person',
      }),
    ).toMatchObject({ kind: 'email', target: 'person@example.com' });
    expect(
      loginRequestSchema.parse({
        kind: 'phone',
        target: '+8613800138000',
        password: 'Correct-Horse9-Battery!',
        deviceName: 'Workstation',
      }),
    ).toMatchObject({ kind: 'phone', deviceName: 'Workstation' });
  });

  it('maps validation failures to stable field paths', () => {
    const result = registerRequestSchema.safeParse({ kind: 'email', target: '', password: '', displayName: '' });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(zodFieldErrors(result.error)).toMatchObject({ target: expect.any(Array), displayName: expect.any(Array) });
  });
});
