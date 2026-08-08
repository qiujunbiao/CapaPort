import type { PackageFile } from '@capaport/capability-kit';
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
      blockedTerms: ['Project Moonstone'],
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

  it('does not classify a manifest slug with a timestamp suffix as a secret', async () => {
    const report = await scanPackage([
      file('capaport.yaml', 'metadata:\n  slug: publication-e2e-1786124899401-95310'),
    ]);
    expect(report.findings.filter((item) => item.ruleId === 'SEC_HIGH_ENTROPY')).toHaveLength(0);
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
    expect(report).toEqual({
      blocked: false,
      requiresConfirmation: false,
      findings: [],
      scannedFiles: 2,
      scannedBytes: 24,
    });
  });

  it.each([
    ['SEC_PERSONAL_DATA', 'context/contact.md', 'owner: developer@example.com'],
    ['SEC_INTERNAL_ADDRESS', 'context/network.md', 'service: api.corp.internal'],
    ['SEC_NETWORK_HOST', 'capaport.yaml', 'endpoint: https://unapproved.example/api'],
    ['SEC_SOURCE_TREE', 'src/payment.ts', 'export const payment = true'],
    ['SEC_OVERSIZED_FILE', 'context/large.md', 'x'.repeat(101)],
  ])('applies organization policy category %s', async (ruleId, path, content) => {
    const report = await scanPackage([file(path, content)], {
      ...defaultScanPolicy,
      maxFileBytes: 100,
      allowedNetworkHosts: ['approved.example'],
    });
    expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
  });

  it('turns medium findings into an explicit confirmation requirement', async () => {
    const report = await scanPackage([file('scripts/run.sh', '#!/bin/sh\necho safe')]);
    expect(report.blocked).toBe(false);
    expect(report.requiresConfirmation).toBe(true);
  });

  it('returns a redacted path-escape finding instead of throwing', async () => {
    const report = await scanPackage([file('../private.env', 'safe')]);
    expect(report).toMatchObject({ blocked: true, findings: [{ ruleId: 'SEC_PATH_ESCAPE' }] });
  });
});
