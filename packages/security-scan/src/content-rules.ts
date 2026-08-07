import type { PendingFinding } from './path-rules.js';
import { secretRules } from './secret-rules.js';
import type { ScanPolicy } from './types.js';

const decoder = new TextDecoder('utf-8', { fatal: false });
const tokenPattern = /[A-Za-z0-9+/=_-]{32,}/g;
const explicitExamples = /^(?:YOUR|EXAMPLE|PLACEHOLDER|REPLACE_ME|CHANGEME|xxxx)/i;
const structuredIdentifierLine = /^\s*(?:slug|name|path|id):\s*[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\s*$/;

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

export function scanContent(path: string, bytes: Uint8Array, policy: ScanPolicy): PendingFinding[] {
  const text = decoder.decode(bytes);
  const findings: PendingFinding[] = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const rule of secretRules) {
      const match = rule.pattern.exec(line);
      if (match?.[0]) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          path,
          line: index + 1,
          evidence: match[0],
          message: rule.message,
        });
      }
    }

    for (const term of policy.customTerms) {
      if (term.length > 0 && line.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
        findings.push({
          ruleId: 'SEC_ORG_TERM',
          severity: 'high',
          path,
          line: index + 1,
          evidence: term,
          message: 'Content matches an organization-restricted term.',
        });
      }
    }

    for (const match of line.matchAll(tokenPattern)) {
      const candidate = match[0];
      if (
        candidate.length >= policy.highEntropyMinimumLength &&
        !explicitExamples.test(candidate) &&
        !structuredIdentifierLine.test(line) &&
        entropy(candidate) >= policy.highEntropyThreshold &&
        !findings.some((finding) => finding.line === index + 1 && finding.evidence === candidate)
      ) {
        findings.push({
          ruleId: 'SEC_HIGH_ENTROPY',
          severity: 'high',
          path,
          line: index + 1,
          evidence: candidate,
          message: 'A high-entropy value that may be a secret was detected.',
        });
      }
    }
  }

  return findings;
}
