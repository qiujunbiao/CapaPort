import type { CapabilityVersionSummary } from '@capaport/contracts';
import { unzipSync } from 'fflate';
import { parse } from 'yaml';
import type { InstallPlan } from '../generated/commands';

type Manifest = {
  metadata: { slug: string };
  spec: { components: Array<{ type: 'skill' | 'prompt' | 'context'; path: string }> };
};

const componentDirectories: Record<string, Record<string, string>> = {
  codex: { skill: 'skills' },
  'claude-code': { skill: 'skills', prompt: 'commands', context: 'rules' },
  cursor: { skill: 'skills', prompt: 'commands', context: 'rules' },
  'gemini-cli': { skill: 'skills', prompt: 'commands' },
};

export type InstalledFileDigest = { relativePath: string; afterDigest: string };

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
  if (leftNumber !== undefined) return -1;
  if (rightNumber !== undefined) return 1;
  return left.localeCompare(right);
}

function compareSemanticVersions(left: string, right: string): number {
  const parseVersion = (value: string) => {
    const match = value
      .trim()
      .replace(/^v/, '')
      .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return undefined;
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
      prerelease: match[4]?.split('.'),
    };
  };
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  for (let index = 0; index < a.core.length; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const difference = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectInstallVersion(
  versions: CapabilityVersionSummary[],
  availableVersionId?: string,
): CapabilityVersionSummary | undefined {
  const installable = versions.filter((version) => version.status === 'published' || version.status === 'deprecated');
  if (availableVersionId) {
    const requested = installable.find((version) => version.id === availableVersionId);
    if (requested) return requested;
  }
  return [...installable].sort((left, right) => compareSemanticVersions(right.version, left.version))[0];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes).buffer;
  const result = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function calculatePackageDigest(entries: Record<string, Uint8Array>): Promise<string> {
  const files = Object.entries(entries)
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, content]) => ({ path: safePath(path), content }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const encoder = new TextEncoder();
  const encoded = files.map((file) => ({ ...file, pathBytes: encoder.encode(file.path) }));
  const total = encoded.reduce((size, file) => size + 8 + file.pathBytes.length + file.content.length, 0);
  const packageBytes = new Uint8Array(total);
  const view = new DataView(packageBytes.buffer);
  let offset = 0;
  for (const file of encoded) {
    view.setUint32(offset, file.pathBytes.length, false);
    view.setUint32(offset + 4, file.content.length, false);
    offset += 8;
    packageBytes.set(file.pathBytes, offset);
    offset += file.pathBytes.length;
    packageBytes.set(file.content, offset);
    offset += file.content.length;
  }
  return sha256(packageBytes);
}

function safePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('能力包包含不安全路径');
  }
  return normalized;
}

export async function buildLocalInstallPlan(input: {
  archive: Uint8Array;
  adapterId: string;
  rootPath: string;
  packageDigest: string;
  installedFiles?: InstalledFileDigest[];
}): Promise<InstallPlan> {
  const entries = unzipSync(input.archive);
  if ((await calculatePackageDigest(entries)) !== input.packageDigest) throw new Error('能力包摘要验证失败');
  const manifestBytes = entries['capaport.yaml'];
  if (!manifestBytes) throw new Error('能力包缺少 capaport.yaml');
  const manifest = parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  if (!manifest?.metadata?.slug || !Array.isArray(manifest.spec?.components)) throw new Error('能力包清单无效');
  const directories = componentDirectories[input.adapterId];
  if (!directories) throw new Error('不支持所选 Agent');
  const installedByPath = new Map(input.installedFiles?.map((file) => [safePath(file.relativePath), file.afterDigest]));
  const writes: InstallPlan['writes'] = [];
  for (const component of manifest.spec.components) {
    const directory = directories[component.type];
    if (!directory) throw new Error(`所选 Agent 不支持 ${component.type}`);
    const prefix = `${safePath(component.path)}/`;
    const matching = Object.entries(entries).filter(([path]) => path === component.path || path.startsWith(prefix));
    if (matching.length === 0) throw new Error(`组件 ${component.path} 没有文件`);
    for (const [path, content] of matching) {
      const relativePath =
        component.type === 'skill'
          ? `${directory}/${manifest.metadata.slug}/${safePath(path.slice(prefix.length))}`
          : `${directory}/${manifest.metadata.slug}.md`;
      const expectedDigest = installedByPath.get(relativePath);
      writes.push({
        relativePath,
        contentBase64: bytesToBase64(content),
        contentDigest: await sha256(content),
        ...(expectedDigest ? { expectedDigest } : {}),
      });
    }
  }
  return {
    transactionId: crypto.randomUUID(),
    adapterId: input.adapterId,
    capabilitySlug: manifest.metadata.slug,
    packageDigest: input.packageDigest,
    rootPath: input.rootPath,
    writes: writes.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
}
