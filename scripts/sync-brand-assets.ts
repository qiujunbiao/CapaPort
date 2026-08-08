import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const applicationRoots = ['apps/web/public/brand', 'apps/desktop/public/brand'];

const assets = [
  ['brand/capaport-mark.svg', 'capaport-mark.svg'],
  ['brand/capaport-mark.svg', 'favicon.svg'],
  ['brand/capaport-lockup-dark.svg', 'capaport-lockup-dark.svg'],
  ['brand/capaport-lockup-light.svg', 'capaport-lockup-light.svg'],
  ['apps/desktop/src-tauri/icons/icon.ico', 'favicon.ico'],
  ['brand/generated/capaport-icon-180.png', 'apple-touch-icon.png'],
  ['brand/generated/capaport-icon-192.png', 'icon-192.png'],
  ['brand/generated/capaport-icon-512.png', 'icon-512.png'],
] as const;

for (const applicationRoot of applicationRoots) {
  const destinationRoot = resolve(root, applicationRoot);
  await mkdir(destinationRoot, { recursive: true });
  for (const [source, destination] of assets) {
    try {
      await copyFile(resolve(root, source), resolve(destinationRoot, destination));
    } catch (error) {
      throw new Error(`Unable to synchronize CapaPort brand asset ${source} to ${applicationRoot}/${destination}`, {
        cause: error,
      });
    }
  }
}

console.log(`Synchronized ${assets.length} CapaPort brand assets to ${applicationRoots.length} applications.`);
