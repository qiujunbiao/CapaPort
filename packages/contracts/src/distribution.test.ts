import { describe, expect, it } from 'vitest';
import { registerDeviceRequestSchema, reportInstallationRequestSchema } from './distribution.js';

describe('distribution contracts', () => {
  it('collects capability metadata but rejects hardware identifiers', () => {
    const device = { name: 'Work Mac', platform: 'macos', appVersion: '1.0.0', supportedAgents: ['codex'] };
    expect(registerDeviceRequestSchema.safeParse(device).success).toBe(true);
    expect(registerDeviceRequestSchema.safeParse({ ...device, hardwareSerial: 'secret-serial' }).success).toBe(false);
  });

  it('accepts only minimized installation outcomes', () => {
    const base = {
      deviceId: '00000000-0000-4000-8000-000000000001',
      capabilityId: '00000000-0000-4000-8000-000000000002',
      versionId: '00000000-0000-4000-8000-000000000003',
      agent: 'codex',
    };
    expect(reportInstallationRequestSchema.safeParse({ ...base, outcome: 'installed' }).success).toBe(true);
    expect(reportInstallationRequestSchema.safeParse({ ...base, outcome: 'failed' }).success).toBe(false);
    expect(
      reportInstallationRequestSchema.safeParse({ ...base, outcome: 'failed', failureCode: 'adapter_conflict' })
        .success,
    ).toBe(true);
  });
});
