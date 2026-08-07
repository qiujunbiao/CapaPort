import type { PackageDiff } from './diff.js';

export type VersionChange = 'major' | 'minor' | 'patch';

export function classifyVersion(diff: PackageDiff): VersionChange {
  if (diff.removed.length > 0 || diff.modified.includes('agentdoor.yaml')) return 'major';
  if (diff.added.some((path) => path !== 'README.md' && !path.startsWith('assets/'))) return 'minor';
  return 'patch';
}
