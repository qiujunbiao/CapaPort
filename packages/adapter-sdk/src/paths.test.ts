import { describe, expect, it } from 'vitest';
import { assertRelativePath, isPathInside, resolveInside } from './paths.js';

describe('adapter path boundaries', () => {
  it('normalizes safe relative paths and rejects traversal or absolute paths', () => {
    expect(assertRelativePath('skills/release/SKILL.md')).toBe('skills/release/SKILL.md');
    for (const unsafe of ['../outside', 'skills/../../outside', '/private/file', 'C:\\private\\file', 'a//b']) {
      expect(() => assertRelativePath(unsafe)).toThrow(/unsafe/i);
    }
  });

  it('handles macOS and Windows containment without prefix confusion', () => {
    expect(resolveInside('/Users/person/.codex', 'skills/release', 'darwin')).toBe(
      '/Users/person/.codex/skills/release',
    );
    expect(isPathInside('/Users/person/.codex', '/Users/person/.codex-other/file', 'darwin')).toBe(false);
    expect(resolveInside('C:\\Users\\Person\\.codex', 'skills/release', 'win32')).toBe(
      'C:\\Users\\Person\\.codex\\skills\\release',
    );
    expect(isPathInside('C:\\Users\\Person\\.codex', 'C:\\Users\\Person\\.codex-old\\file', 'win32')).toBe(false);
  });
});
