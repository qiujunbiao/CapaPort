import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPackage } from '@capaport/capability-kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEnvironment, AgentAdapter, ComponentType, FileTransaction, InstallScope } from './types.js';

export type AdapterComplianceOptions = {
  name: string;
  adapterId: string;
  supportedComponents: readonly ComponentType[];
  supportedScopes?: readonly InstallScope[];
  roots?: Partial<Record<InstallScope, string>>;
  fixtureHomeDir?: string;
  fixtureExpectedFiles?: readonly string[];
  createAdapter(environment: AdapterEnvironment): AgentAdapter;
};

function fixtureRootName(adapterId: string): string {
  if (adapterId === 'fake') return '.fake';
  if (adapterId === 'codex') return '.agents';
  if (adapterId === 'claude-code') return '.claude';
  if (adapterId === 'gemini-cli') return '.gemini';
  return `.${adapterId}`;
}

class MemoryTransaction implements FileTransaction {
  readonly files = new Map<string, Uint8Array>();
  readonly removed: string[] = [];
  async writeFile(path: string, content: Uint8Array) {
    this.files.set(path, content);
  }
  async removeFile(path: string) {
    this.files.delete(path);
    this.removed.push(path);
  }
}

export function defineAdapterComplianceSuite(options: AdapterComplianceOptions): void {
  describe(`${options.name} adapter compliance`, () => {
    const supportedScopes = options.supportedScopes ?? (['user', 'workspace'] as const);
    const temporaryDirectories: string[] = [];
    afterEach(async () => {
      for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
    });

    async function fixture() {
      const base = await mkdtemp(join(tmpdir(), 'capaport-adapter-'));
      temporaryDirectories.push(base);
      const homeDir = join(base, 'home');
      const projectRoot = join(base, 'project');
      await mkdir(homeDir, { recursive: true });
      await mkdir(projectRoot, { recursive: true });
      const environment: AdapterEnvironment = {
        homeDir,
        projectRoot,
        platform: 'darwin',
        now: () => new Date('2026-08-07T00:00:00.000Z'),
      };
      const adapter = options.createAdapter(environment);
      const userRoot = join(homeDir, options.roots?.user ?? fixtureRootName(adapter.id));
      const workspaceRoot = join(projectRoot, options.roots?.workspace ?? fixtureRootName(adapter.id));
      if (supportedScopes.includes('user')) await mkdir(userRoot, { recursive: true });
      if (supportedScopes.includes('workspace')) await mkdir(workspaceRoot, { recursive: true });
      return { adapter, homeDir, projectRoot, userRoot, workspaceRoot };
    }

    it('detects deterministic user and workspace installations and inventory', async () => {
      const current = await fixture();
      const skillDirectory = join(current.userRoot, 'skills', 'release');
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, 'SKILL.md'), '# Release\nRun checks.');
      await writeFile(join(skillDirectory, 'reference.md'), '# Reference');

      const detected = await current.adapter.detect();
      expect(detected).toHaveLength(supportedScopes.length);
      expect(detected.map((installation) => installation.scope).sort()).toEqual([...supportedScopes].sort());
      const user = detected.find((installation) => installation.scope === 'user');
      expect(user).toBeDefined();
      if (!user) throw new Error('User installation missing');
      const first = await current.adapter.inventory(user);
      const second = await current.adapter.inventory(user);
      expect(first).toEqual(second);
      expect(first.map((capability) => capability.id)).toEqual(
        [...first.map((capability) => capability.id)].sort((left, right) => left.localeCompare(right)),
      );
      if (!supportedScopes.includes('workspace')) {
        await expect(
          current.adapter.inventory({
            id: `${options.adapterId}:workspace:${current.workspaceRoot}`,
            adapterId: options.adapterId,
            scope: 'workspace',
            rootPath: current.workspaceRoot,
            displayName: `${options.name} (workspace)`,
          }),
        ).rejects.toThrow(/belong/i);
      }
    });

    it('imports canonically, plans inside roots, writes lock metadata, and uninstalls', async () => {
      const current = await fixture();
      const skillDirectory = join(current.userRoot, 'skills', 'release');
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, 'SKILL.md'), '# Release\nRun checks.');
      const user = (await current.adapter.detect()).find((installation) => installation.scope === 'user');
      if (!user) throw new Error('User installation missing');
      const local = (await current.adapter.inventory(user))[0];
      if (!local) throw new Error('Local capability missing');

      const imported = await current.adapter.import(local);
      expect(imported.manifest.metadata.slug).toBe('release');
      expect(imported.files.map((file) => file.path)).toContain('skills/release/SKILL.md');
      expect(imported.files.map((file) => file.path)).toContain('README.md');
      const plan = await current.adapter.planInstall(imported, { installation: user });
      expect(await current.adapter.validatePlan(plan)).toEqual({ valid: true });
      expect(plan.lock).toMatchObject({
        schemaVersion: 'capaport.io/install-lock/v1',
        adapterId: options.adapterId,
        capabilitySlug: 'release',
        packageDigest: imported.digest,
        installedAt: '2026-08-07T00:00:00.000Z',
      });
      const transaction = new MemoryTransaction();
      await expect(current.adapter.apply(plan, transaction)).resolves.toMatchObject({ status: 'installed' });
      expect(transaction.files.has(plan.lock.lockPath)).toBe(true);
      await expect(current.adapter.uninstall(plan.lock, transaction)).resolves.toMatchObject({ status: 'uninstalled' });
      expect(transaction.removed.sort()).toEqual(
        [...plan.entries.map((entry) => entry.destination), plan.lock.lockPath].sort(),
      );
    });

    it('rejects traversal, tampered destinations, and unsupported components', async () => {
      const current = await fixture();
      const skillDirectory = join(current.userRoot, 'skills', 'release');
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, 'SKILL.md'), '# Release');
      const user = (await current.adapter.detect()).find((installation) => installation.scope === 'user');
      if (!user) throw new Error('User installation missing');
      const local = (await current.adapter.inventory(user))[0];
      if (!local) throw new Error('Local capability missing');
      const imported = await current.adapter.import(local);
      await expect(
        current.adapter.planInstall({ ...imported, digest: '0'.repeat(64) }, { installation: user }),
      ).rejects.toThrow(/digest/i);
      const plan = await current.adapter.planInstall(imported, { installation: user });
      const first = plan.entries[0];
      if (!first) throw new Error('Plan entry missing');
      first.destination = join(current.userRoot, '..', 'escaped.md');
      await expect(current.adapter.validatePlan(plan)).resolves.toMatchObject({ valid: false });
      await expect(
        current.adapter.inventory({ ...user, rootPath: join(current.userRoot, '..', 'forged-root') }),
      ).rejects.toThrow(/belong/i);
      await expect(
        current.adapter.uninstall(
          { ...plan.lock, rootPath: join(current.userRoot, '..'), lockPath: join(current.userRoot, '..', 'lock.json') },
          new MemoryTransaction(),
        ),
      ).rejects.toThrow(/belong|unsafe/i);

      const unsupported = (['skill', 'prompt', 'context'] as const).find(
        (component) => !options.supportedComponents.includes(component),
      );
      if (unsupported) {
        imported.manifest.spec.components = [{ type: unsupported, path: `${unsupported}/release.md` }];
        imported.files.push({ path: `${unsupported}/release.md`, content: new TextEncoder().encode('private') });
        imported.digest = await hashPackage(imported.files);
        await expect(current.adapter.planInstall(imported, { installation: user })).rejects.toThrow(/unsupported/i);
      }
    });

    it('refuses to uninstall files modified after installation', async () => {
      const current = await fixture();
      const skillDirectory = join(current.userRoot, 'skills', 'release');
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, 'SKILL.md'), '# Release');
      const user = (await current.adapter.detect()).find((installation) => installation.scope === 'user');
      if (!user) throw new Error('User installation missing');
      const local = (await current.adapter.inventory(user))[0];
      if (!local) throw new Error('Local capability missing');
      const plan = await current.adapter.planInstall(await current.adapter.import(local), { installation: user });
      await writeFile(plan.entries[0]?.destination ?? '', '# locally modified');
      await expect(current.adapter.uninstall(plan.lock, new MemoryTransaction())).rejects.toThrow(/modified|conflict/i);
    });

    it('plans valid Windows destinations using the adapter allowlist', async () => {
      const rootName = options.roots?.user ?? fixtureRootName(options.adapterId);
      const rootPath = `C:\\Users\\Person\\${rootName}`;
      const adapter = options.createAdapter({
        homeDir: 'C:\\Users\\Person',
        projectRoot: 'C:\\Work\\Project',
        platform: 'win32',
        now: () => new Date('2026-08-07T00:00:00.000Z'),
      });
      const local = {
        id: 'windows:skill:release',
        adapterId: options.adapterId,
        installationId: 'windows:user',
        slug: 'release',
        name: 'Release',
        componentType: 'skill' as const,
        sourcePath: `${rootPath}\\skills\\release`,
        files: [{ path: 'SKILL.md', content: new TextEncoder().encode('# Release') }],
        digest: 'local-digest',
      };
      const pkg = await adapter.import(local);
      const plan = await adapter.planInstall(pkg, {
        installation: {
          id: 'windows:user',
          adapterId: options.adapterId,
          scope: 'user',
          rootPath,
          displayName: 'Windows fixture',
        },
      });
      expect(plan.entries[0]?.destination).toContain(`${rootName}\\skills\\release\\SKILL.md`);
      await expect(adapter.validatePlan(plan)).resolves.toEqual({ valid: true });
    });

    if (options.fixtureHomeDir) {
      const fixtureHomeDir = options.fixtureHomeDir;
      it('inventories the checked-in filesystem fixture', async () => {
        const adapter = options.createAdapter({ homeDir: fixtureHomeDir, platform: 'darwin' });
        const installations = await adapter.detect();
        expect(installations).toHaveLength(1);
        const installation = installations[0];
        if (!installation) throw new Error('Fixture installation missing');
        const inventory = await adapter.inventory(installation);
        expect(inventory.map(({ slug, componentType }) => ({ slug, componentType }))).toContainEqual({
          slug: 'release',
          componentType: 'skill',
        });
        const release = inventory.find((capability) => capability.slug === 'release');
        expect(release?.files.map((file) => file.path).sort()).toEqual(
          [...(options.fixtureExpectedFiles ?? ['SKILL.md'])].sort(),
        );
      });
    }
  });
}
