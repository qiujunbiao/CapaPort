import path from 'node:path';
import type { AdapterPlatform } from './types.js';

const absoluteWindowsPath = /^[A-Za-z]:[\\/]/;

export function assertRelativePath(input: string): string {
  if (
    !input ||
    input.length > 512 ||
    input.includes('\0') ||
    input.startsWith('/') ||
    absoluteWindowsPath.test(input)
  ) {
    throw new Error('Unsafe adapter path');
  }
  const normalized = input.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Unsafe adapter path');
  }
  return normalized;
}

function implementation(platform: AdapterPlatform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function isPathInside(root: string, candidate: string, platform: AdapterPlatform): boolean {
  const paths = implementation(platform);
  const normalizedRoot = paths.resolve(root);
  const normalizedCandidate = paths.resolve(candidate);
  const relative = paths.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative));
}

export function resolveInside(root: string, relativePath: string, platform: AdapterPlatform): string {
  const safeRelativePath = assertRelativePath(relativePath);
  const paths = implementation(platform);
  const destination = paths.resolve(root, ...safeRelativePath.split('/'));
  if (!isPathInside(root, destination, platform)) throw new Error('Unsafe adapter path escaped its root');
  return destination;
}

export function joinPlatform(platform: AdapterPlatform, ...segments: string[]): string {
  return implementation(platform).join(...segments);
}
