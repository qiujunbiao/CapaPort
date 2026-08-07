import { unzipSync, zipSync } from 'fflate';
import { normalizePackageFiles, type PackageFile } from './hash.js';
import { normalizePackagePath } from './schema.js';

const MAX_FILES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export function buildArchive(files: readonly PackageFile[]): Uint8Array {
  const normalized = normalizePackageFiles(files);
  if (normalized.length > MAX_FILES) {
    throw new Error(`Package contains more than ${MAX_FILES} files`);
  }

  const totalBytes = normalized.reduce((total, file) => total + file.content.byteLength, 0);
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('Package exceeds the uncompressed size limit');
  }

  return zipSync(Object.fromEntries(normalized.map((file) => [file.path, file.content])), { level: 6 });
}

export function extractArchive(archive: Uint8Array): PackageFile[] {
  const entries = unzipSync(archive);
  const paths = Object.keys(entries);
  if (paths.length > MAX_FILES) {
    throw new Error(`Package contains more than ${MAX_FILES} files`);
  }

  let totalBytes = 0;
  const files = paths.map((path) => {
    const content = entries[path];
    if (!content) {
      throw new Error(`Archive entry has no content: ${path}`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Package exceeds the uncompressed size limit');
    }
    return { path: normalizePackagePath(path), content };
  });

  return normalizePackageFiles(files);
}
