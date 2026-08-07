import type { PackageFile } from '@agentdoor/capability-kit';

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
  customTerms: readonly string[];
  allowedExecutablePaths: readonly string[];
  highEntropyMinimumLength: number;
  highEntropyThreshold: number;
};

export type ScanReport = {
  blocked: boolean;
  findings: ScanFinding[];
  scannedFiles: number;
  scannedBytes: number;
};

export type ScanInput = readonly PackageFile[];

export const defaultScanPolicy: ScanPolicy = {
  blockedSeverities: ['high', 'critical'],
  customTerms: [],
  allowedExecutablePaths: [],
  highEntropyMinimumLength: 32,
  highEntropyThreshold: 4.2,
};
