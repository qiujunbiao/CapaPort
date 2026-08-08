import type { PendingFinding } from './path-rules.js';
import { secretRules } from './secret-rules.js';
import type { ScanPolicy } from './types.js';

const decoder = new TextDecoder('utf-8', { fatal: false });
const tokenPattern = /[A-Za-z0-9+/=_-]{32,}/g;
const explicitExamples = /^(?:YOUR|EXAMPLE|PLACEHOLDER|REPLACE_ME|CHANGEME|xxxx)/i;
const structuredIdentifierLine = /^\s*(?:slug|name|path|id):\s*[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\s*$/;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/;
const internalAddressPattern =
  /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[a-z0-9.-]+\.internal)\b/i;
const urlPattern = /https?:\/\/([a-z0-9.-]+)(?::\d+)?(?:\/[^\s]*)?/gi;

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

    for (const term of policy.blockedTerms) {
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

    const personal = emailPattern.exec(line)?.[0] ?? phonePattern.exec(line)?.[0];
    if (personal) {
      findings.push({
        ruleId: 'SEC_PERSONAL_DATA',
        severity: 'medium',
        path,
        line: index + 1,
        evidence: personal,
        message: 'Possible personal contact information was detected.',
      });
    }

    const internalAddress = internalAddressPattern.exec(line)?.[0];
    if (internalAddress) {
      findings.push({
        ruleId: 'SEC_INTERNAL_ADDRESS',
        severity: 'high',
        path,
        line: index + 1,
        evidence: internalAddress,
        message: 'An internal network address was detected.',
      });
    }

    for (const match of line.matchAll(urlPattern)) {
      const host = match[1]?.toLowerCase();
      if (host && !policy.allowedNetworkHosts.some((allowed) => allowed.toLowerCase() === host)) {
        findings.push({
          ruleId: 'SEC_NETWORK_HOST',
          severity: 'medium',
          path,
          line: index + 1,
          evidence: host,
          message: 'A network host must be explicitly allowed by organization policy.',
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
