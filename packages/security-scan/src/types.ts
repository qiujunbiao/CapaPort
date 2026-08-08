import type { PackageFile } from '@capaport/capability-kit';

export type ScanSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ScanFinding = {
  ruleId: string;
  severity: ScanSeverity;
  path: string;
  line?: number;
  evidenceDigest: string;
  message: string;
  blocking: boolean;
};

export type ScanPolicy = {
  blockedSeverities: readonly ScanSeverity[];
  confirmationSeverities: readonly ScanSeverity[];
  blockedTerms: readonly string[];
  allowedExecutablePaths: readonly string[];
  allowedNetworkHosts: readonly string[];
  executablePolicy: 'deny' | 'confirm' | 'allow-listed';
  highEntropyMinimumLength: number;
  highEntropyThreshold: number;
  maxFileBytes: number;
  maxPackageBytes: number;
  sourceTreePatterns: readonly string[];
};

export type ScanReport = {
  blocked: boolean;
  requiresConfirmation: boolean;
  findings: ScanFinding[];
  scannedFiles: number;
  scannedBytes: number;
};

export type ScanInput = readonly PackageFile[];

export const defaultScanPolicy: ScanPolicy = {
  blockedSeverities: ['high', 'critical'],
  confirmationSeverities: ['medium'],
  blockedTerms: [],
  allowedExecutablePaths: [],
  allowedNetworkHosts: [],
  executablePolicy: 'confirm',
  highEntropyMinimumLength: 32,
  highEntropyThreshold: 4.2,
  maxFileBytes: 2_000_000,
  maxPackageBytes: 50_000_000,
  sourceTreePatterns: ['.git/', 'node_modules/', 'src/', 'app/'],
};
