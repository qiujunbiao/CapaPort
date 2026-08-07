import { describe, expect, it } from 'vitest';
import { buildArchive, extractArchive } from '../../packages/capability-kit/src/archive.js';
import { parseManifest } from '../../packages/capability-kit/src/manifest.js';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('archive and manifest attack gate', () => {
  it.each(['../escape', '/etc/passwd', 'C:\\secret.txt', 'safe//file', 'safe/./file', 'safe\\..\\escape'])(
    'rejects unsafe entry path %s',
    (path) => {
      expect(() => buildArchive([{ path, content: bytes('x') }])).toThrow(/unsafe|path/i);
    },
  );

  it('rejects duplicate normalized paths and excessive file counts', () => {
    expect(() =>
      buildArchive([
        { path: 'README.md', content: bytes('a') },
        { path: 'README.md', content: bytes('b') },
      ]),
    ).toThrow(/duplicate/i);
    expect(() =>
      buildArchive(
        Array.from({ length: 10_001 }, (_, index) => ({
          path: `context/${index}.md`,
          content: bytes('x'),
        })),
      ),
    ).toThrow(/more than 10000 files/i);
  });

  it('rejects a forged central-directory zip bomb before inflation', () => {
    const forged = buildArchive([{ path: 'README.md', content: bytes('small') }]);
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

  it('rejects unknown and privilege-confusing manifest fields', () => {
    expect(() =>
      parseManifest(`
schemaVersion: agentdoor.io/v1alpha1
kind: CapabilityPackage
privileged: true
metadata: { slug: safe, name: Safe, description: '', tags: [] }
spec:
  components: [{ type: skill, path: skills/safe }]
  compatibility: { agents: [codex] }
  permissions: { filesystem: none, network: none }
  entrypoints: { default: skills/safe/SKILL.md }
  dependencies: []
`),
    ).toThrow(/unrecognized|invalid/i);
  });
});
