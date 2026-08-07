import { describe, expect, it } from 'vitest';
import { redactAuditMetadata } from './audit.policy.js';

describe('audit metadata redaction', () => {
  it('redacts credentials, direct identities, content, and absolute paths recursively', () => {
    expect(
      redactAuditMetadata({
        email: 'private@example.com',
        token: 'secret',
        nested: { businessContent: 'source', path: 'C:\\private\\project', safe: 'kept' },
      }),
    ).toEqual({
      email: '[redacted]',
      token: '[redacted]',
      nested: { businessContent: '[redacted]', path: '[redacted]', safe: 'kept' },
    });
  });
});
