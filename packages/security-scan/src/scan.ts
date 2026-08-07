import { createHash } from 'node:crypto';
import { normalizePackageFiles } from '@agentdoor/capability-kit';
import { scanContent } from './content-rules.js';
import { type PendingFinding, scanPath } from './path-rules.js';
import { defaultScanPolicy, type ScanInput, type ScanPolicy, type ScanReport } from './types.js';

function digestEvidence(evidence: string): string {
  return createHash('sha256').update(evidence).digest('hex');
}

export async function scanPackage(input: ScanInput, policy: ScanPolicy = defaultScanPolicy): Promise<ScanReport> {
  const files = normalizePackageFiles(input);
  const pending: PendingFinding[] = [];
  let scannedBytes = 0;

  for (const file of files) {
    scannedBytes += file.content.byteLength;
    pending.push(...scanPath(file.path, policy), ...scanContent(file.path, file.content, policy));
  }

  const unique = new Map<string, PendingFinding>();
  for (const finding of pending) {
    const key = `${finding.ruleId}:${finding.path}:${finding.line ?? 0}:${digestEvidence(finding.evidence)}`;
    unique.set(key, finding);
  }

  const findings = [...unique.values()]
    .map(({ evidence, ...finding }) => ({
      ...finding,
      evidenceDigest: digestEvidence(evidence),
      blocking: policy.blockedSeverities.includes(finding.severity),
    }))
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        (left.line ?? 0) - (right.line ?? 0) ||
        left.ruleId.localeCompare(right.ruleId),
    );

  return {
    blocked: findings.some((finding) => finding.blocking),
    findings,
    scannedFiles: files.length,
    scannedBytes,
  };
}
