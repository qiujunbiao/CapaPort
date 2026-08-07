import { createHash } from 'node:crypto';
import { access, lstat, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname } from 'node:path';
import { hashPackage, type PackageFile } from '@agentdoor/capability-kit';
import { stringify } from 'yaml';
import { assertRelativePath, isPathInside, joinPlatform, resolveInside } from './paths.js';
import type {
  AgentAdapter,
  AgentInstallation,
  CanonicalPackage,
  ComponentType,
  FilePlan,
  FilesystemAdapterConfig,
  InstallLock,
  LocalCapability,
  ValidationResult,
} from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function digest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function exists(candidate: string): Promise<boolean> {
  return access(candidate).then(
    () => true,
    () => false,
  );
}

async function readTree(
  root: string,
  platform: FilesystemAdapterConfig['environment']['platform'],
  relative = '',
): Promise<PackageFile[]> {
  const current = relative ? joinPlatform(platform, root, relative) : root;
  const entries = await readdir(current, { withFileTypes: true });
  const files: PackageFile[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new Error('Unsafe local capability: symbolic links are not supported');
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const childPath = joinPlatform(platform, root, child);
    const stat = await lstat(childPath);
    if (stat.isSymbolicLink()) throw new Error('Unsafe local capability: symbolic links are not supported');
    if (stat.isDirectory()) files.push(...(await readTree(root, platform, child)));
    else if (stat.isFile())
      files.push({ path: assertRelativePath(child), content: new Uint8Array(await readFile(childPath)) });
  }
  return files;
}

function componentPath(type: ComponentType, slug: string): string {
  if (type === 'skill') return `skills/${slug}`;
  return `${type === 'prompt' ? 'prompts' : 'context'}/${slug}.md`;
}

function localName(type: ComponentType, slug: string, files: PackageFile[]): string {
  if (type !== 'skill') return slug;
  const entrypoint = files.find((file) => file.path === 'SKILL.md');
  const match = entrypoint
    ? /^---[\s\S]*?^name:\s*["']?([^\r\n"']+)["']?\s*$/m.exec(decoder.decode(entrypoint.content))
    : undefined;
  return match?.[1]?.trim().slice(0, 120) || slug;
}

function rootFor(config: FilesystemAdapterConfig, scope: 'user' | 'workspace'): string | undefined {
  const base = scope === 'user' ? config.environment.homeDir : config.environment.projectRoot;
  if (!base) return undefined;
  return joinPlatform(config.environment.platform, base, config.roots[scope]);
}

function samePath(left: string, right: string, platform: FilesystemAdapterConfig['environment']['platform']): boolean {
  return isPathInside(left, right, platform) && isPathInside(right, left, platform);
}

function isAllowedRoot(config: FilesystemAdapterConfig, candidate: string): boolean {
  return (['user', 'workspace'] as const).some((scope) => {
    const allowed = rootFor(config, scope);
    return allowed ? samePath(allowed, candidate, config.environment.platform) : false;
  });
}

function isInstallationRoot(
  config: FilesystemAdapterConfig,
  scope: AgentInstallation['scope'],
  candidate: string,
): boolean {
  const allowed = rootFor(config, scope);
  return allowed ? samePath(allowed, candidate, config.environment.platform) : false;
}

export function defaultAdapterEnvironment(): FilesystemAdapterConfig['environment'] {
  return {
    homeDir: homedir(),
    projectRoot: process.cwd(),
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
  };
}

export function createFilesystemAdapter(config: FilesystemAdapterConfig): AgentAdapter {
  const platform = config.environment.platform;

  return {
    id: config.id,
    displayName: config.displayName,
    supportedComponents: config.supportedComponents,

    async detect() {
      const installations: AgentInstallation[] = [];
      for (const scope of ['user', 'workspace'] as const) {
        const rootPath = rootFor(config, scope);
        if (rootPath && (await exists(rootPath))) {
          installations.push({
            id: `${config.id}:${scope}:${rootPath}`,
            adapterId: config.id,
            scope,
            rootPath,
            displayName: `${config.displayName} (${scope})`,
          });
        }
      }
      return installations.sort((left, right) => left.id.localeCompare(right.id));
    },

    async inventory(target) {
      if (target.adapterId !== config.id || !isInstallationRoot(config, target.scope, target.rootPath)) {
        throw new Error('Adapter installation does not belong to this adapter');
      }
      const capabilities: LocalCapability[] = [];
      for (const type of config.supportedComponents) {
        const directory = config.directories[type];
        if (!directory) continue;
        const componentRoot = resolveInside(target.rootPath, directory, platform);
        if (!(await exists(componentRoot))) continue;
        const entries = await readdir(componentRoot, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (entry.isSymbolicLink()) throw new Error('Unsafe local capability: symbolic links are not supported');
          const sourcePath = resolveInside(componentRoot, entry.name, platform);
          let files: PackageFile[];
          let slug: string;
          if (type === 'skill') {
            if (!entry.isDirectory()) continue;
            slug = entry.name;
            files = await readTree(sourcePath, platform);
            if (!files.some((file) => file.path === 'SKILL.md')) continue;
          } else {
            if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue;
            slug = basename(entry.name, extname(entry.name));
            files = [{ path: entry.name, content: new Uint8Array(await readFile(sourcePath)) }];
          }
          const packageFiles = files.map((file) => ({ path: file.path, content: file.content }));
          capabilities.push({
            id: `${target.id}:${type}:${slug}`,
            adapterId: config.id,
            installationId: target.id,
            slug,
            name: localName(type, slug, packageFiles),
            componentType: type,
            sourcePath,
            files: packageFiles,
            digest: await hashPackage(packageFiles),
          });
        }
      }
      return capabilities.sort((left, right) => left.id.localeCompare(right.id));
    },

    async import(localCapability) {
      if (localCapability.adapterId !== config.id) throw new Error('Local capability belongs to another adapter');
      const path = componentPath(localCapability.componentType, localCapability.slug);
      const files = localCapability.files.map((file) => ({
        path: localCapability.componentType === 'skill' ? `${path}/${assertRelativePath(file.path)}` : path,
        content: file.content,
      }));
      const manifest: CanonicalPackage['manifest'] = {
        schemaVersion: 'agentdoor.io/v1alpha1',
        kind: 'CapabilityPackage',
        metadata: { slug: localCapability.slug, name: localCapability.name, description: '', tags: [] },
        spec: {
          components: [{ type: localCapability.componentType, path }],
          compatibility: { agents: [config.id as 'codex'] },
          permissions: { filesystem: 'read-project', network: 'none' },
          entrypoints: { default: localCapability.componentType === 'skill' ? `${path}/SKILL.md` : path },
          dependencies: [],
        },
      };
      const canonicalFiles = [
        { path: 'agentdoor.yaml', content: encoder.encode(stringify(manifest, { lineWidth: 0 })) },
        ...files,
      ];
      return { manifest, files: canonicalFiles, digest: await hashPackage(canonicalFiles) };
    },

    async planInstall(pkg, target) {
      if (
        target.installation.adapterId !== config.id ||
        !isInstallationRoot(config, target.installation.scope, target.installation.rootPath)
      ) {
        throw new Error('Install target belongs to another adapter');
      }
      if (!pkg.manifest.spec.compatibility.agents.includes(config.id as 'codex')) {
        throw new Error(`Capability package is incompatible with ${config.id}`);
      }
      if ((await hashPackage(pkg.files)) !== pkg.digest) throw new Error('Capability package digest mismatch');
      const entries: FilePlan['entries'] = [];
      for (const component of pkg.manifest.spec.components) {
        const directory = config.directories[component.type];
        if (!config.supportedComponents.includes(component.type) || !directory) {
          throw new Error(`Unsupported component type: ${component.type}`);
        }
        const componentFiles = pkg.files.filter(
          (file) => file.path === component.path || file.path.startsWith(`${component.path}/`),
        );
        if (componentFiles.length === 0) throw new Error(`Component has no files: ${component.path}`);
        for (const file of componentFiles) {
          const relativePath =
            component.type === 'skill'
              ? assertRelativePath(
                  `${directory}/${pkg.manifest.metadata.slug}/${file.path.slice(component.path.length + 1)}`,
                )
              : assertRelativePath(`${directory}/${pkg.manifest.metadata.slug}.md`);
          entries.push({
            operation: 'create-or-replace',
            relativePath,
            destination: resolveInside(target.installation.rootPath, relativePath, platform),
            content: file.content,
            digest: digest(file.content),
          });
        }
      }
      entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      const lockRelativePath = `.agentdoor/locks/${config.id}/${pkg.manifest.metadata.slug}.json`;
      const installedAt = (config.environment.now?.() ?? new Date()).toISOString();
      const lock: InstallLock = {
        schemaVersion: 'agentdoor.io/install-lock/v1',
        adapterId: config.id,
        capabilitySlug: pkg.manifest.metadata.slug,
        packageDigest: pkg.digest,
        rootPath: target.installation.rootPath,
        lockPath: resolveInside(target.installation.rootPath, lockRelativePath, platform),
        files: entries.map(({ relativePath, destination, digest }) => ({ relativePath, destination, digest })),
        installedAt,
      };
      return {
        adapterId: config.id,
        capabilitySlug: pkg.manifest.metadata.slug,
        packageDigest: pkg.digest,
        rootPath: target.installation.rootPath,
        entries,
        lock,
      };
    },

    async validatePlan(plan): Promise<ValidationResult> {
      const errors: string[] = [];
      if (plan.adapterId !== config.id || plan.lock.adapterId !== config.id) errors.push('Adapter mismatch');
      if (!isAllowedRoot(config, plan.rootPath) || !samePath(plan.rootPath, plan.lock.rootPath, platform)) {
        errors.push('Root is not allowlisted');
      }
      if (
        plan.lock.capabilitySlug !== plan.capabilitySlug ||
        plan.lock.packageDigest !== plan.packageDigest ||
        plan.lock.files.length !== plan.entries.length
      ) {
        errors.push('Lock metadata mismatch');
      }
      const seen = new Set<string>();
      for (const entry of plan.entries) {
        try {
          assertRelativePath(entry.relativePath);
          if (!isPathInside(plan.rootPath, entry.destination, platform)) errors.push('Destination escaped root');
          if (resolveInside(plan.rootPath, entry.relativePath, platform) !== entry.destination) {
            errors.push('Destination does not match relative path');
          }
          if (digest(entry.content) !== entry.digest) errors.push('Content digest mismatch');
          if (seen.has(entry.destination)) errors.push('Duplicate destination');
          seen.add(entry.destination);
          const locked = plan.lock.files.find((file) => file.destination === entry.destination);
          if (!locked || locked.relativePath !== entry.relativePath || locked.digest !== entry.digest) {
            errors.push('Lock file metadata mismatch');
          }
        } catch {
          errors.push('Unsafe planned path');
        }
      }
      if (!isPathInside(plan.rootPath, plan.lock.lockPath, platform)) errors.push('Lock path escaped root');
      try {
        const expectedLockPath = resolveInside(
          plan.rootPath,
          `.agentdoor/locks/${config.id}/${plan.capabilitySlug}.json`,
          platform,
        );
        if (expectedLockPath !== plan.lock.lockPath) errors.push('Unexpected lock path');
      } catch {
        errors.push('Unsafe lock path');
      }
      return errors.length === 0 ? { valid: true } : { valid: false, errors: [...new Set(errors)] };
    },

    async apply(plan, transaction) {
      const validation = await this.validatePlan(plan);
      if (!validation.valid) throw new Error(`Invalid install plan: ${validation.errors.join(', ')}`);
      for (const entry of plan.entries) await transaction.writeFile(entry.destination, entry.content);
      await transaction.writeFile(plan.lock.lockPath, encoder.encode(JSON.stringify(plan.lock, null, 2)));
      return { status: 'installed', changedFiles: plan.entries.length, lock: plan.lock };
    },

    async uninstall(lock, transaction) {
      if (lock.adapterId !== config.id || !isAllowedRoot(config, lock.rootPath)) {
        throw new Error('Install lock belongs to another adapter');
      }
      for (const file of lock.files) {
        if (
          !isPathInside(lock.rootPath, file.destination, platform) ||
          resolveInside(lock.rootPath, file.relativePath, platform) !== file.destination
        ) {
          throw new Error('Unsafe uninstall path');
        }
        await transaction.removeFile(file.destination);
      }
      const expectedLockPath = resolveInside(
        lock.rootPath,
        `.agentdoor/locks/${config.id}/${lock.capabilitySlug}.json`,
        platform,
      );
      if (expectedLockPath !== lock.lockPath) throw new Error('Unsafe uninstall lock path');
      await transaction.removeFile(lock.lockPath);
      return { status: 'uninstalled', changedFiles: lock.files.length };
    },
  };
}
