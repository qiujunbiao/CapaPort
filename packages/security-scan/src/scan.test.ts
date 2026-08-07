import type { PackageFile } from '@agentdoor/capability-kit';
import { describe, expect, it } from 'vitest';
import { defaultScanPolicy, scanPackage } from './index.js';

const encoder = new TextEncoder();
const file = (path: string, content: string): PackageFile => ({ path, content: encoder.encode(content) });

describe('security scanner', () => {
  it.each([
    ['SEC_PRIVATE_KEY', 'context/key.md', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'],
    ['SEC_AWS_ACCESS_KEY', 'context/cloud.md', 'key = AKIAIOSFODNN7EXAMPLE'],
    ['SEC_CONNECTION_STRING', 'context/db.md', 'postgres://admin:secret@db.internal/app'],
    ['SEC_SENSITIVE_FILE', '.env', 'TOKEN=example'],
    ['SEC_EXECUTABLE_FILE', 'scripts/deploy.sh', '#!/bin/sh\necho deploy'],
    ['SEC_ORG_TERM', 'context/internal.md', 'Project Moonstone is confidential'],
  ])('detects %s without returning secret evidence', async (ruleId, path, content) => {
    const report = await scanPackage([file(path, content)], {
      ...defaultScanPolicy,
      customTerms: ['Project Moonstone'],
    });
    const finding = report.findings.find((item) => item.ruleId === ruleId);
    expect(finding).toBeDefined();
    expect(finding?.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(finding)).not.toContain('secret');
  });

  it('detects a high entropy token but ignores explicit examples', async () => {
    const report = await scanPackage([
      file('context/token.md', 'token=Qm9vdHN0cmFwX1NlY3JldF8xMjM0NTY3ODkwYWJjZGVm'),
      file('context/example.md', 'token=YOUR_TOKEN_HERE'),
    ]);
    expect(report.findings.filter((item) => item.ruleId === 'SEC_HIGH_ENTROPY')).toHaveLength(1);
  });

  it('reports line numbers, sorts findings, and blocks high severity by default', async () => {
    const report = await scanPackage([
      file('z.md', 'safe\npostgres://user:password@host/db'),
      file('a.md', '-----BEGIN PRIVATE KEY-----'),
    ]);
    expect(report.blocked).toBe(true);
    expect(report.findings.map((finding) => finding.path)).toEqual(['a.md', 'z.md']);
    expect(report.findings[1]?.line).toBe(2);
  });

  it('allows declared executable paths and clean content', async () => {
    const report = await scanPackage(
      [file('scripts/verified.sh', '#!/bin/sh\necho safe'), file('README.md', 'hello')],
      {
        ...defaultScanPolicy,
        allowedExecutablePaths: ['scripts/verified.sh'],
      },
    );
    expect(report).toEqual({ blocked: false, findings: [], scannedFiles: 2, scannedBytes: 24 });
  });
});
