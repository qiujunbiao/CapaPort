import { normalizePackageFiles } from '@agentdoor/capability-kit';
import { scanContent } from './content-rules.js';
import { type PendingFinding, scanPath } from './path-rules.js';
import { defaultScanPolicy, type ScanInput, type ScanPolicy, type ScanReport } from './types.js';

async function digestEvidence(evidence: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(evidence)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function scanPackage(input: ScanInput, policy: ScanPolicy = defaultScanPolicy): Promise<ScanReport> {
  const pending: PendingFinding[] = [];
  let scannedBytes = 0;
  const files = [];
  const paths = new Set<string>();

  for (const rawFile of input) {
    scannedBytes += rawFile.content.byteLength;
    try {
      const [file] = normalizePackageFiles([rawFile]);
      if (!file) continue;
      if (paths.has(file.path)) {
        pending.push({
          ruleId: 'SEC_DUPLICATE_PATH',
          severity: 'critical',
          path: file.path,
          evidence: file.path,
          message: 'Duplicate package paths are not allowed.',
        });
        continue;
      }
      paths.add(file.path);
      files.push(file);
      if (file.content.byteLength > policy.maxFileBytes) {
        pending.push({
          ruleId: 'SEC_OVERSIZED_FILE',
          severity: 'high',
          path: file.path,
          evidence: `${file.path}:${file.content.byteLength}`,
          message: 'A package file exceeds the organization size limit.',
        });
      }
    } catch {
      pending.push({
        ruleId: 'SEC_PATH_ESCAPE',
        severity: 'critical',
        path: '[unsafe-path]',
        evidence: rawFile.path,
        message: 'An unsafe or escaping package path was detected.',
      });
    }
  }

  if (scannedBytes > policy.maxPackageBytes) {
    pending.push({
      ruleId: 'SEC_OVERSIZED_PACKAGE',
      severity: 'high',
      path: '[package]',
      evidence: String(scannedBytes),
      message: 'The capability package exceeds the organization size limit.',
    });
  }

  for (const file of files) {
    pending.push(...scanPath(file.path, policy), ...scanContent(file.path, file.content, policy));
  }

  const unique = new Map<string, PendingFinding>();
  for (const finding of pending) {
    const key = `${finding.ruleId}:${finding.path}:${finding.line ?? 0}:${finding.evidence}`;
    unique.set(key, finding);
  }

  const findings = await Promise.all(
    [...unique.values()].map(async ({ evidence, ...finding }) => ({
      ...finding,
      evidenceDigest: await digestEvidence(evidence),
      blocking: policy.blockedSeverities.includes(finding.severity),
    })),
  );
  findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.ruleId.localeCompare(right.ruleId),
  );

  return {
    blocked: findings.some((finding) => finding.blocking),
    requiresConfirmation: findings.some((finding) => policy.confirmationSeverities.includes(finding.severity)),
    findings,
    scannedFiles: input.length,
    scannedBytes,
  };
}
