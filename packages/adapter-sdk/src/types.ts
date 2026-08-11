import type { CapabilityManifest, PackageFile } from '@capaport/capability-kit';

export type AdapterPlatform = 'darwin' | 'win32' | 'linux';
export type InstallScope = 'user' | 'workspace';
export type ComponentType = CapabilityManifest['spec']['components'][number]['type'];

export type AdapterEnvironment = {
  homeDir: string;
  projectRoot?: string;
  platform: AdapterPlatform;
  now?: () => Date;
};

export type AgentInstallation = {
  id: string;
  adapterId: string;
  scope: InstallScope;
  rootPath: string;
  displayName: string;
};

export type LocalCapability = {
  id: string;
  adapterId: string;
  installationId: string;
  slug: string;
  name: string;
  componentType: ComponentType;
  sourcePath: string;
  files: PackageFile[];
  digest: string;
};

export type CanonicalPackage = {
  manifest: CapabilityManifest;
  files: PackageFile[];
  digest: string;
};

export type InstallTarget = { installation: AgentInstallation };

export type PlannedFile = {
  operation: 'create-or-replace';
  relativePath: string;
  destination: string;
  content: Uint8Array;
  digest: string;
};

export type InstallLockFile = { relativePath: string; destination: string; digest: string };
export type InstallLock = {
  schemaVersion: 'capaport.io/install-lock/v1';
  adapterId: string;
  capabilitySlug: string;
  packageDigest: string;
  rootPath: string;
  lockPath: string;
  files: InstallLockFile[];
  installedAt: string;
};

export type FilePlan = {
  adapterId: string;
  capabilitySlug: string;
  packageDigest: string;
  rootPath: string;
  entries: PlannedFile[];
  lock: InstallLock;
};

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };
export type InstallResult = { status: 'installed' | 'uninstalled'; changedFiles: number; lock?: InstallLock };

export interface FileTransaction {
  writeFile(path: string, content: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly supportedComponents: readonly ComponentType[];
  detect(): Promise<AgentInstallation[]>;
  inventory(target: AgentInstallation): Promise<LocalCapability[]>;
  import(localCapability: LocalCapability): Promise<CanonicalPackage>;
  planInstall(pkg: CanonicalPackage, target: InstallTarget): Promise<FilePlan>;
  validatePlan(plan: FilePlan): Promise<ValidationResult>;
  apply(plan: FilePlan, transaction: FileTransaction): Promise<InstallResult>;
  uninstall(lock: InstallLock, transaction: FileTransaction): Promise<InstallResult>;
}

export type AdapterDirectoryMap = Partial<Record<ComponentType, string>>;
export type FilesystemAdapterRoots =
  | { user: string; workspace?: string }
  | { user?: string; workspace: string };
export type AdapterNativeFormat = {
  extension: `.${string}`;
  decode?: (content: Uint8Array) => Uint8Array;
  encode?: (content: Uint8Array, slug: string) => Uint8Array;
};
export type FilesystemAdapterConfig = {
  id: string;
  displayName: string;
  supportedComponents: readonly ComponentType[];
  environment: AdapterEnvironment;
  roots: FilesystemAdapterRoots;
  directories: AdapterDirectoryMap;
  nativeFormats?: Partial<Record<ComponentType, AdapterNativeFormat>>;
};
