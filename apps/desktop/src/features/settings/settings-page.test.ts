// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createDiagnosticPayload } from './settings-page';

describe('redacted desktop diagnostics', () => {
  it('exports operational counts without identity, credentials, or paths', () => {
    const payload = createDiagnosticPayload({
      online: false,
      queue: { pending: 2, failed: 1 },
      generatedAt: new Date('2026-08-08T00:00:00.000Z'),
      clientVersion: '2.4.1',
    });
    const serialized = JSON.stringify(payload);
    expect(payload).toMatchObject({
      clientVersion: '2.4.1',
      connectivity: 'offline',
      syncQueue: { pending: 2, failed: 1 },
    });
    expect(serialized).not.toMatch(/token|user|organization|\/Users|[A-Z]:\\/i);
  });
});
