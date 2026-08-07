export type AgentDescriptor = { adapterId: string; displayName: string; scope: 'user' | 'workspace'; rootPath: string };
export type LocalCapabilitySummary = { slug: string; componentType: string; relativePath: string; digest: string };
export type ScanFinding = { rule: string; severity: 'high' | 'medium' | 'low'; relativePath: string };
export type LocalScanReport = { files: number; bytes: number; findings: ScanFinding[]; blocked: boolean };
export type LocalPackageExport = { fileName: string; sizeBytes: number; sha256: string; archiveBase64: string };
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
export type SyncQueueStatus = { pending: number; failed: number; nextAvailableAt?: string };

export const localCommandNames = [
  'detect_agents',
  'inventory_agent',
  'scan_local_package',
  'export_local_package',
  'preview_install',
  'apply_install',
  'rollback_install',
  'bind_project_directory',
  'sync_queue_status',
  'store_session',
  'load_session',
  'clear_session',
] as const;
