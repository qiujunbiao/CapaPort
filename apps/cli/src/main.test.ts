import { describe, expect, it, vi } from 'vitest';
import { MemoryCredentialStore } from './credentials.js';
import { runCli } from './main.js';

describe('CLI exit behavior', () => {
  it('returns usage exit code 2 for unknown commands', async () => {
    const errors: string[] = [];
    expect(
      await runCli(['unknown', '--json'], {
        credentials: new MemoryCredentialStore(),
        writer: { stdout: () => undefined, stderr: (value) => errors.push(value) },
      }),
    ).toBe(2);
    expect(JSON.parse(errors[0] ?? '{}')).toMatchObject({ ok: false, error: { code: 2 } });
  });
  it('returns network exit code 4 when doctor cannot reach the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(
      await runCli(['doctor', '--json'], {
        credentials: new MemoryCredentialStore(),
        writer: { stdout: () => undefined, stderr: () => undefined },
      }),
    ).toBe(4);
    vi.unstubAllGlobals();
  });
});
