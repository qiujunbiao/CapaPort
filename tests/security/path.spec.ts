import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFilesystemAdapter } from '../../packages/adapter-sdk/src/filesystem-adapter.js';
import { assertRelativePath, resolveInside } from '../../packages/adapter-sdk/src/paths.js';
import { normalizePackagePath } from '../../packages/capability-kit/src/schema.js';

describe('cross-platform path and symlink gate', () => {
  it.each(['../x', './x', '/root/x', 'C:\\root\\x', 'safe//x', 'safe\\..\\x', 'x\0y'])(
    'rejects traversal or absolute path %s',
    (path) => {
      expect(() => assertRelativePath(path)).toThrow(/unsafe/i);
      expect(() => normalizePackagePath(path)).toThrow(/unsafe/i);
    },
  );

  it('keeps Windows and POSIX destinations inside the exact allowlisted root', () => {
    expect(resolveInside('C:\\Users\\A\\.agents', 'skills/release/SKILL.md', 'win32')).toBe(
      'C:\\Users\\A\\.agents\\skills\\release\\SKILL.md',
    );
    expect(resolveInside('/Users/a/.agents', 'skills/release/SKILL.md', 'darwin')).toBe(
      '/Users/a/.agents/skills/release/SKILL.md',
    );
  });

  it.runIf(process.platform !== 'win32')('rejects a symlink during local inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'capaport-path-'));
    const agentRoot = join(root, '.agents');
    const skillRoot = join(agentRoot, 'skills', 'safe');
    const outside = join(root, 'outside');
    await mkdir(skillRoot, { recursive: true });
    await mkdir(outside);
    await writeFile(join(skillRoot, 'SKILL.md'), '# Safe');
    await writeFile(join(outside, 'secret'), 'hidden');
    await symlink(join(outside, 'secret'), join(skillRoot, 'linked-secret'));
    const adapter = createFilesystemAdapter({
      id: 'codex',
      displayName: 'Codex',
      supportedComponents: ['skill'],
      environment: { homeDir: root, platform: process.platform === 'darwin' ? 'darwin' : 'linux' },
      roots: { user: '.agents', workspace: '.agents' },
      directories: { skill: 'skills' },
    });
    const installation = (await adapter.detect())[0];
    expect(installation).toBeDefined();
    if (!installation) throw new Error('Expected the temporary Codex installation to be detected.');
    await expect(adapter.inventory(installation)).rejects.toThrow(/symbolic links/i);
  });
});
