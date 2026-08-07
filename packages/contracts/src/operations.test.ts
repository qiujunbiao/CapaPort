import { describe, expect, it } from 'vitest';
import { productEventSchema } from './operations.js';

describe('operations contracts', () => {
  it('accepts minimized product events and rejects content or path payloads', () => {
    expect(
      productEventSchema.safeParse({
        eventName: 'capability.installed',
        capabilityId: '00000000-0000-4000-8000-000000000001',
        agent: 'codex',
        outcome: 'success',
        source: 'desktop',
      }).success,
    ).toBe(true);
    expect(
      productEventSchema.safeParse({
        eventName: 'capability.imported',
        source: 'desktop',
        absolutePath: '/Users/private/project',
      }).success,
    ).toBe(false);
    expect(
      productEventSchema.safeParse({
        eventName: 'capability.imported',
        source: 'desktop',
        content: 'business source code',
      }).success,
    ).toBe(false);
  });
});
