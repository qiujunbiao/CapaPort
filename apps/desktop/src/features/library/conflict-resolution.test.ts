import { describe, expect, it } from 'vitest';
import { componentTypeForPath, createConflictDiff } from './conflict-resolution';

describe('desktop conflict resolution', () => {
  it('produces stable line-oriented additions, removals, and context without exposing binary data', () => {
    expect(createConflictDiff('# Rule\nallow: old\nkeep', '# Rule\nallow: new\nkeep')).toEqual([
      { kind: 'context', content: '# Rule', oldLine: 1, newLine: 1 },
      { kind: 'remove', content: 'allow: old', oldLine: 2 },
      { kind: 'add', content: 'allow: new', newLine: 2 },
      { kind: 'context', content: 'keep', oldLine: 3, newLine: 3 },
    ]);
  });

  it('maps managed paths to the capability component that must be imported as a draft', () => {
    expect(componentTypeForPath('skills/release/SKILL.md')).toBe('skill');
    expect(componentTypeForPath('commands/release.md')).toBe('prompt');
    expect(componentTypeForPath('rules/release.md')).toBe('context');
    expect(componentTypeForPath('unknown/release.md')).toBeUndefined();
  });
});
