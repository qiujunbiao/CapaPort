import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const canonical = [
  'brand/capaport-mark.svg',
  'brand/capaport-mark-mono.svg',
  'brand/capaport-lockup-dark.svg',
  'brand/capaport-lockup-light.svg',
  'brand/capaport-app-icon.svg',
];

const publicAssets = [
  'capaport-mark.svg',
  'capaport-lockup-dark.svg',
  'capaport-lockup-light.svg',
  'favicon.svg',
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
];

const platformIcons = [
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
  'icon.icns',
  'icon.ico',
  'Square30x30Logo.png',
  'Square310x310Logo.png',
  'StoreLogo.png',
];

describe('CapaPort brand assets', () => {
  it.each(canonical)('%s is a standalone accessible SVG', async (path) => {
    const svg = await readFile(path, 'utf8');
    expect(svg).toMatch(/<svg[^>]+viewBox=/);
    expect(svg).toMatch(/<title[^>]*>CapaPort/);
    expect(svg).not.toMatch(/(?:href|src)=["']https?:/);
  });

  it('keeps the application icon on a 1024 square master', async () => {
    const svg = await readFile('brand/capaport-app-icon.svg', 'utf8');
    expect(svg).toContain('viewBox="0 0 1024 1024"');
    expect(svg).toContain('#15171D');
    expect(svg).toContain('#FF6426');
  });

  it.each(['apps/web', 'apps/desktop'])('%s publishes the complete application asset set', async (app) => {
    for (const asset of publicAssets) {
      expect((await stat(`${app}/public/brand/${asset}`)).size, asset).toBeGreaterThan(0);
    }
  });

  it.each(['apps/web', 'apps/desktop'])('%s copies canonical SVGs without geometry drift', async (app) => {
    await expect(readFile(`${app}/public/brand/capaport-mark.svg`)).resolves.toEqual(
      await readFile('brand/capaport-mark.svg'),
    );
    await expect(readFile(`${app}/public/brand/capaport-lockup-dark.svg`)).resolves.toEqual(
      await readFile('brand/capaport-lockup-dark.svg'),
    );
    await expect(readFile(`${app}/public/brand/capaport-lockup-light.svg`)).resolves.toEqual(
      await readFile('brand/capaport-lockup-light.svg'),
    );
  });

  it('publishes a complete Tauri platform icon matrix', async () => {
    for (const icon of platformIcons) {
      expect((await stat(`apps/desktop/src-tauri/icons/${icon}`)).size, icon).toBeGreaterThan(0);
    }
  });

  it('declares the platform icons in the Tauri bundle', async () => {
    const config = JSON.parse(await readFile('apps/desktop/src-tauri/tauri.conf.json', 'utf8')) as {
      bundle: { icon?: string[] };
    };
    expect(config.bundle.icon).toEqual([
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ]);
  });
});
