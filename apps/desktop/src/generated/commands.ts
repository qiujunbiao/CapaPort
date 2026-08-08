export type AgentDescriptor = { adapterId: string; displayName: string; scope: 'user' | 'workspace'; rootPath: string };
export type LocalCapabilitySummary = { slug: string; componentType: string; relativePath: string; digest: string };
export type DiscoveredLocalSkill = {
  adapterId: 'codex' | 'claude-code' | 'cursor' | 'gemini-cli';
  displayName: string;
  scope: 'user' | 'workspace';
  sourceKind: 'global' | 'shared' | 'plugin' | 'workspace';
  linked: boolean;
  sourcePath: string;
  slug: string;
  digest: string;
};
export type DiscoveryIssue = { path: string; reason: string };
export type LocalSkillDiscoveryResult = { skills: DiscoveredLocalSkill[]; issues: DiscoveryIssue[] };
export type ScanFinding = {
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  relativePath: string;
  evidenceDigest: string;
};
export type LocalScanReport = {
  files: number;
  bytes: number;
  findings: ScanFinding[];
  blocked: boolean;
  requiresConfirmation: boolean;
};
export type OfflineWrite = {
  id: string;
  operation: string;
  payloadJson: string;
  idempotencyKey: string;
  attempts: number;
};
export type LocalPackageExport = { fileName: string; sizeBytes: number; sha256: string; archiveBase64: string };
export type ManagedFileContent = { contentBase64: string; digest: string };
export type SecureSession = { accessToken: string; refreshToken: string; expiresIn?: number; organizationId?: string };
export type PlannedWrite = {
  relativePath: string;
  contentBase64: string;
  contentDigest: string;
  expectedDigest?: string;
};
export type InstallPlan = {
  transactionId: string;
  adapterId: string;
  capabilitySlug: string;
  packageDigest: string;
  rootPath: string;
  writes: PlannedWrite[];
};
export type PreviewChange = {
  relativePath: string;
  kind: 'create' | 'update' | 'unchanged' | 'conflict';
  beforeDigest?: string;
  afterDigest: string;
};
export type InstallPreview = { transactionId: string; changes: PreviewChange[]; conflicts: number };
export type ApplyResult = { transactionId: string; changedFiles: number; state: string };
export type InstallLockFile = { relativePath: string; beforeDigest?: string; afterDigest: string };
export type InstallLock = {
  schemaVersion: string;
  adapterId: string;
  capabilitySlug: string;
  packageDigest: string;
  transactionId: string;
  files: InstallLockFile[];
};
export type SyncQueueStatus = { pending: number; failed: number; nextAvailableAt?: string };
export type LocalProjectBinding = {
  localBindingId: string;
  spaceId: string;
  localPath: string;
  agents: Array<'codex' | 'claude-code' | 'cursor' | 'gemini-cli'>;
  status: 'active' | 'missing' | 'removed';
  createdAt: string;
};
export type ProjectInventoryEntry = {
  relativePath: string;
  sizeBytes: number;
  eligible: boolean;
  ignoreReason?: string;
};
export type ProjectInventory = {
  localBindingId: string;
  status: 'active' | 'missing';
  entries: ProjectInventoryEntry[];
  eligibleFiles: number;
  eligibleBytes: number;
  ignored: Array<{ reason: string; count: number }>;
};
export type ContextPackageExport = {
  digest: string;
  selectionDigest: string;
  fileCount: number;
  totalBytes: number;
  agents: Array<'codex' | 'claude-code' | 'cursor' | 'gemini-cli'>;
  scanEngineVersion: string;
  scannedAt: string;
  archiveBase64: string;
};

export const localCommandNames = [
  'detect_agents',
  'discover_local_skills',
  'inventory_agent',
  'scan_local_package',
  'read_managed_file',
  'export_local_package',
  'preview_install',
  'apply_install',
  'rollback_install',
  'load_install_lock',
  'uninstall',
  'bind_project_directory',
  'list_project_bindings',
  'remove_project_binding',
  'inventory_project_context',
  'export_project_context',
  'project_context_plan',
  'sync_queue_status',
  'enqueue_write',
  'claim_ready_writes',
  'complete_write',
  'reschedule_write',
  'retry_failed_writes',
  'store_session',
  'load_session',
  'clear_session',
] as const;
