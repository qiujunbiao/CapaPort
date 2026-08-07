import { normalizePackageFiles, type PackageFile } from './hash.js';

export type PackageDiff = {
  added: string[];
  modified: string[];
  removed: string[];
};

function contentEquals(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

export function diffPackages(before: readonly PackageFile[], after: readonly PackageFile[]): PackageDiff {
  const beforeMap = new Map(normalizePackageFiles(before).map((file) => [file.path, file.content]));
  const afterMap = new Map(normalizePackageFiles(after).map((file) => [file.path, file.content]));
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [path, content] of afterMap) {
    const previous = beforeMap.get(path);
    if (!previous) added.push(path);
    else if (!contentEquals(previous, content)) modified.push(path);
  }

  for (const path of beforeMap.keys()) {
    if (!afterMap.has(path)) removed.push(path);
  }

  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}
