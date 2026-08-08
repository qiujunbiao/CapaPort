import { describe, expect, it } from 'vitest';
import { sourceDraftStatusAfterReview, transitionPublication, transitionVersion } from './publication.state.js';

describe('publication state machine', () => {
  it.each([
    ['in_review', 'approve', 'published'],
    ['in_review', 'request_changes', 'changes_requested'],
    ['in_review', 'reject', 'rejected'],
    ['in_review', 'withdraw', 'withdrawn'],
    ['published', 'withdraw', 'withdrawn'],
  ] as const)('allows %s --%s--> %s', (from, action, to) => {
    expect(transitionPublication(from, action)).toBe(to);
  });

  it.each([
    ['published', 'approve'],
    ['changes_requested', 'approve'],
    ['rejected', 'withdraw'],
    ['withdrawn', 'approve'],
  ] as const)('rejects publication transition %s --%s', (from, action) => {
    expect(() => transitionPublication(from, action)).toThrow(/transition/i);
  });

  it('reopens a submitted source draft only when changes are requested', () => {
    expect(sourceDraftStatusAfterReview('request_changes')).toBe('ready');
    expect(sourceDraftStatusAfterReview('approve')).toBeUndefined();
    expect(sourceDraftStatusAfterReview('reject')).toBeUndefined();
  });
});

describe('version state machine', () => {
  it.each([
    ['published', 'deprecate', 'deprecated'],
    ['published', 'withdraw', 'withdrawn'],
    ['deprecated', 'withdraw', 'withdrawn'],
    ['deprecated', 'archive', 'archived'],
    ['withdrawn', 'archive', 'archived'],
  ] as const)('allows %s --%s--> %s', (from, action, to) => {
    expect(transitionVersion(from, action)).toBe(to);
  });

  it('keeps archived versions terminal', () => {
    expect(() => transitionVersion('archived', 'withdraw')).toThrow(/transition/i);
  });
});
