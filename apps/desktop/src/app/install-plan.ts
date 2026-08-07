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
}): Promise<InstallPlan> {
  const entries = unzipSync(input.archive);
  if ((await calculatePackageDigest(entries)) !== input.packageDigest) throw new Error('能力包摘要验证失败');
  const manifestBytes = entries['agentdoor.yaml'];
  if (!manifestBytes) throw new Error('能力包缺少 agentdoor.yaml');
  const manifest = parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  if (!manifest?.metadata?.slug || !Array.isArray(manifest.spec?.components)) throw new Error('能力包清单无效');
  const directories = componentDirectories[input.adapterId];
  if (!directories) throw new Error('不支持所选 Agent');
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
      writes.push({
        relativePath,
        contentBase64: bytesToBase64(content),
        contentDigest: await sha256(content),
        expectedDigest: '0'.repeat(64),
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
