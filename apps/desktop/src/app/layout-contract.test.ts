// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function desktopStyles() {
  return readFile(new URL('../styles.css', import.meta.url), 'utf8');
}

function rule(styles: string, selector: string) {
  for (const match of styles.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1]?.split(',').some((candidate) => candidate.trim() === selector)) return match[2] ?? '';
  }
  return '';
}

function rules(styles: string, selector: string) {
  return [...styles.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((match) => match[1]?.split(',').some((candidate) => candidate.trim() === selector))
    .map((match) => match[2] ?? '');
}

describe('desktop shell layout contract', () => {
  it('pins the application chrome and scrolls only the middle workspace', async () => {
    const styles = await desktopStyles();

    expect(rule(styles, 'body')).toContain('min-width: 0');
    expect(rule(styles, 'body')).toContain('overflow: hidden');
    expect(rule(styles, '.desktop-shell')).toContain('height: 100vh');
    expect(rule(styles, '.desktop-shell')).toContain('overflow: hidden');
    expect(rule(styles, '.workspace')).toContain('height: 100vh');
    expect(rule(styles, '.workspace')).toContain('overflow: hidden');
    expect(rule(styles, '.workspace-main')).toContain('min-height: 0');
    expect(rule(styles, '.workspace-main')).toContain('overflow-x: hidden');
    expect(rule(styles, '.workspace-main')).toContain('overflow-y: auto');
    expect(rule(styles, '.workspace-main')).toContain('overscroll-behavior: none');
  });

  it('stacks authoring field labels above full-width controls', async () => {
    const styles = await desktopStyles();

    expect(rule(styles, '.form-grid > label')).toContain('display: grid');
    expect(rule(styles, '.authoring-sidebar > .panel > label')).toContain('display: grid');
    expect(rule(styles, '.form-grid input')).toContain('width: 100%');
    expect(rule(styles, '.form-grid textarea')).toContain('width: 100%');
    expect(rule(styles, '.package-component textarea')).toContain('width: 100%');
  });

  it('keeps the shared search field free from governance form overrides', async () => {
    const styles = await desktopStyles();

    expect(rules(styles, '.search-field')).toHaveLength(1);
    expect(rules(styles, '.search-field input')).toHaveLength(1);
    expect(rule(styles, '.search-field')).toContain('display: flex');
    expect(rule(styles, '.search-field input')).toContain('border: 0');
    expect(rule(styles, '.audit-filter')).toContain('display: grid');
    expect(rule(styles, '.audit-filter select')).toContain('width: 100%');
  });

  it('contains navigation, panels, and tab groups without horizontal overflow', async () => {
    const styles = await desktopStyles();

    expect(rule(styles, '.side-rail nav')).toContain('overflow-x: hidden');
    expect(rule(styles, '.side-rail nav button')).toContain('width: 100%');
    expect(rule(styles, '.side-rail nav button')).toContain('min-width: 0');
    expect(rule(styles, '.page')).toContain('width: 100%');
    expect(rule(styles, '.panel')).toContain('min-width: 0');
    expect(rule(styles, '.scope-tabs')).toContain('display: grid');
    expect(rule(styles, '.scope-tabs')).toContain('grid-auto-columns: minmax(0, 1fr)');
    expect(rule(styles, '.scope-tabs button')).toContain('min-width: 0');
    expect(rule(styles, '.governance-row select')).toContain('width: auto');
    expect(rule(styles, '.review-publication-list button > span')).toContain('display: grid');
  });

  it('does not reference undefined design tokens', async () => {
    const styles = await desktopStyles();
    const definitions = new Set([...styles.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]));
    const usages = new Set([...styles.matchAll(/var\(--([\w-]+)/g)].map((match) => match[1]));

    expect([...usages].filter((token) => !definitions.has(token))).toEqual([]);
  });
});
