import { describe, expect, it } from 'vitest';
import { submitPublicationRequestSchema } from './publications.js';

describe('publication contracts', () => {
  it('accepts semantic versions and rejects ambiguous version labels', () => {
    const base = {
      draftId: '00000000-0000-4000-8000-000000000001',
      targetSpaceId: '00000000-0000-4000-8000-000000000002',
    };
    expect(submitPublicationRequestSchema.safeParse({ ...base, version: '1.2.3' }).success).toBe(true);
    expect(submitPublicationRequestSchema.safeParse({ ...base, version: 'latest' }).success).toBe(false);
    expect(submitPublicationRequestSchema.safeParse({ ...base, version: '01.2.3' }).success).toBe(false);
  });
});
