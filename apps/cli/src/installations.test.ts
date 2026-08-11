import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureAgentInstallation, resolveAgentRoot } from './installations.js';

const environment = {
  homeDir: '/home/person',
  projectRoot: '/work/project',
  platform: 'linux' as const,
};

describe('Agent installation roots', () => {
  it('resolves WorkBuddy user and workspace roots independently', () => {
    expect(resolveAgentRoot('workbuddy', 'user', environment)).toBe('/home/person/.workbuddy');
    expect(resolveAgentRoot('workbuddy', 'workspace', environment)).toBe('/work/project/.codebuddy');
  });

  it('allows only the QwenWork user scope', () => {
    expect(resolveAgentRoot('qwenwork', 'user', environment)).toBe('/home/person/.qwenworkcn');
    expect(() => resolveAgentRoot('qwenwork', 'workspace', environment)).toThrow(/不支持 workspace/);
  });

  it('creates and detects a QwenWork user installation', async () => {
    const base = await mkdtemp(join(tmpdir(), 'capaport-cli-installation-'));
    try {
      const current = await ensureAgentInstallation('qwenwork', 'user', {
        homeDir: join(base, 'home'),
        projectRoot: join(base, 'project'),
        platform: 'linux',
      });
      expect(current.installation).toMatchObject({ adapterId: 'qwenwork', scope: 'user' });
      expect(current.installation.rootPath).toBe(join(base, 'home', '.qwenworkcn'));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
