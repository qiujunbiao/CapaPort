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
  const encoder = new TextEncoder();
  const entries = normalizePackageFiles(files).map((file) => ({ file, pathBytes: encoder.encode(file.path) }));
  const canonical = new Uint8Array(
    entries.reduce((size, entry) => size + 8 + entry.pathBytes.byteLength + entry.file.content.byteLength, 0),
  );
  const view = new DataView(canonical.buffer);
  let offset = 0;
  for (const { file, pathBytes } of entries) {
    view.setUint32(offset, pathBytes.byteLength, false);
    view.setUint32(offset + 4, file.content.byteLength, false);
    offset += 8;
    canonical.set(pathBytes, offset);
    offset += pathBytes.byteLength;
    canonical.set(file.content, offset);
    offset += file.content.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', canonical));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
