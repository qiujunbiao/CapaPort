import { describe, expect, it } from 'vitest';
import { loginRequestSchema, registerRequestSchema } from './auth.js';
import { zodFieldErrors } from './errors.js';

describe('authentication contracts', () => {
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
