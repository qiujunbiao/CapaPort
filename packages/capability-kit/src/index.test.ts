import { describe, expect, it } from 'vitest';
import {
  buildArchive,
  classifyVersion,
  diffPackages,
  extractArchive,
  hashPackage,
  type PackageFile,
  parseManifest,
} from './index.js';

const manifestYaml = `
schemaVersion: agentdoor.io/v1alpha1
kind: CapabilityPackage
metadata:
  slug: secure-release-helper
  name: 安全发布助手
  description: 发布前执行检查
  tags: [release, security]
spec:
  components:
    - type: skill
      path: skills/release
    - type: prompt
      path: prompts/summary.md
  compatibility:
    agents: [codex, claude-code]
  permissions:
    filesystem: read-project
    network: none
  entrypoints:
    default: skills/release/SKILL.md
  dependencies: []
`;

const encoder = new TextEncoder();
const file = (path: string, content: string): PackageFile => ({ path, content: encoder.encode(content) });

describe('manifest parsing', () => {
  it('parses the platform-neutral manifest', () => {
    const manifest = parseManifest(manifestYaml);
    expect(manifest.metadata.slug).toBe('secure-release-helper');
    expect(manifest.spec.components.map((item) => item.type)).toEqual(['skill', 'prompt']);
  });

  it.each(['../secret', '/etc/passwd', 'C:\\secrets\\key'])('rejects unsafe component path %s', (unsafePath) => {
    const yaml = manifestYaml.replace('skills/release', unsafePath);
    expect(() => parseManifest(yaml)).toThrow(/path/i);
  });

  it('rejects unknown manifest fields instead of silently accepting a confused schema', () => {
    const yaml = manifestYaml.replace('kind: CapabilityPackage', 'kind: CapabilityPackage\nprivileged: true');
    expect(() => parseManifest(yaml)).toThrow(/unrecognized|invalid/i);
  });
});

describe('package hashing and archives', () => {
  const files = [file('README.md', 'hello'), file('skills/release/SKILL.md', 'release safely')];

  it('hashes normalized file order deterministically', async () => {
    await expect(hashPackage(files)).resolves.toBe(await hashPackage([...files].reverse()));
  });

  it('round-trips an archive and rejects traversal entries', () => {
    const archive = buildArchive(files);
    expect(extractArchive(archive)).toEqual(files);
    expect(() => buildArchive([file('../escape', 'bad')])).toThrow(/path/i);
  });

  it('rejects a forged zip bomb from central-directory sizes before inflation', () => {
    const archive = buildArchive([file('README.md', 'small')]);
    const forged = new Uint8Array(archive);
    const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
    let centralDirectory = -1;
    for (let offset = 0; offset <= forged.byteLength - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        centralDirectory = offset;
        break;
      }
    }
    expect(centralDirectory).toBeGreaterThanOrEqual(0);
    view.setUint32(centralDirectory + 24, 100 * 1024 * 1024 + 1, true);
    expect(() => extractArchive(forged)).toThrow(/uncompressed size limit/i);
  });
});

describe('package diffs and version classification', () => {
  it('reports added, modified, and removed files', () => {
    const before = [file('remove.md', 'old'), file('modify.md', 'old')];
    const after = [file('modify.md', 'new'), file('add.md', 'new')];
    expect(diffPackages(before, after)).toEqual({
      added: ['add.md'],
      modified: ['modify.md'],
      removed: ['remove.md'],
    });
  });

  it('classifies breaking, additive, and content-only changes', () => {
    expect(classifyVersion({ added: [], modified: [], removed: ['skills/main/SKILL.md'] })).toBe('major');
    expect(classifyVersion({ added: ['prompts/new.md'], modified: [], removed: [] })).toBe('minor');
    expect(classifyVersion({ added: [], modified: ['README.md'], removed: [] })).toBe('patch');
  });
});
