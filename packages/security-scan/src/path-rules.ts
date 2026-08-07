import { normalizePackagePath } from '@agentdoor/capability-kit';
import type { ScanFinding, ScanPolicy } from './types.js';

const sensitiveNames = new Set(['.env', '.env.local', 'id_rsa', 'id_ed25519', 'credentials', 'credentials.json']);
const executableExtensions = new Set(['.bat', '.cmd', '.com', '.exe', '.msi', '.ps1', '.sh']);

export type PendingFinding = Omit<ScanFinding, 'evidenceDigest' | 'blocking'> & { evidence: string };

export function scanPath(pathInput: string, policy: ScanPolicy): PendingFinding[] {
  const path = normalizePackagePath(pathInput);
  const lowerPath = path.toLowerCase();
  const name = lowerPath.split('/').at(-1) ?? lowerPath;
  const findings: PendingFinding[] = [];

  if (sensitiveNames.has(name) || name.endsWith('.pem') || name.endsWith('.key')) {
    findings.push({
      ruleId: 'SEC_SENSITIVE_FILE',
      severity: 'high',
      path,
      evidence: path,
      message: 'A sensitive credential file name was detected.',
    });
  }

  const extensionIndex = name.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? name.slice(extensionIndex) : '';
  if (executableExtensions.has(extension) && !policy.allowedExecutablePaths.includes(path)) {
    findings.push({
      ruleId: 'SEC_EXECUTABLE_FILE',
      severity: 'medium',
      path,
      evidence: path,
      message: 'An executable file must be declared and explicitly allowed.',
    });
  }

  return findings;
}
