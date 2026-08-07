import { createHash } from 'node:crypto';
import { normalizePackagePath } from './schema.js';

export type PackageFile = {
  path: string;
  content: Uint8Array;
};

export function normalizePackageFiles(files: readonly PackageFile[]): PackageFile[] {
  const normalized = files.map((file) => ({ path: normalizePackagePath(file.path), content: file.content }));
  normalized.sort((left, right) => left.path.localeCompare(right.path));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.path === normalized[index]?.path) {
      throw new Error(`Duplicate package path: ${normalized[index]?.path}`);
    }
  }

  return normalized;
}

export async function hashPackage(files: readonly PackageFile[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of normalizePackageFiles(files)) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    const header = Buffer.allocUnsafe(8);
    header.writeUInt32BE(pathBytes.byteLength, 0);
    header.writeUInt32BE(file.content.byteLength, 4);
    hash.update(header);
    hash.update(pathBytes);
    hash.update(file.content);
  }
  return hash.digest('hex');
}
