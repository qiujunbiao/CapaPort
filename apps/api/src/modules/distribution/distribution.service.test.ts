import type { CapabilityManifest } from '@agentdoor/capability-kit';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import {
  type DistributionDataStore,
  DistributionService,
  type DistributionVersionRecord,
} from './distribution.service.js';

const tenant = { organizationId: 'org-1', membershipId: 'membership-1', organizationRole: 'member' as const };
const version: DistributionVersionRecord = {
  id: 'version-1',
  organizationId: 'org-1',
  capabilityId: 'capability-1',
  spaceId: 'organization-space',
  version: '1.0.0',
  artifactId: 'artifact-1',
  objectKey: 'artifacts/org-1/one',
  contentDigest: 'a'.repeat(64),
  status: 'published',
  manifest: {
    spec: {
      compatibility: { agents: ['codex'] },
      permissions: { filesystem: 'read-project', network: 'none' },
    },
  } as CapabilityManifest,
};

function setup() {
  const device = {
    id: 'device-1',
    organizationId: 'org-1',
    userId: 'user-1',
    name: 'Mac',
    platform: 'macos' as const,
    appVersion: '1.0.0',
    supportedAgents: ['codex'] as const,
    status: 'active' as const,
    lastSeenAt: new Date(),
  };
  const repository: DistributionDataStore = {
    registerDevice: vi.fn().mockResolvedValue(device),
    listDevices: vi.fn().mockResolvedValue([device]),
    findDevice: vi.fn().mockResolvedValue(device),
    updateDevice: vi.fn().mockResolvedValue(device),
    revokeDevice: vi.fn(),
    findVersion: vi.fn().mockResolvedValue(version),
    listVersions: vi.fn().mockResolvedValue([version]),
    recordDownloadPlan: vi.fn(),
    reportInstallation: vi.fn(),
    findInstallation: vi.fn(),
    listInstallations: vi.fn().mockResolvedValue([]),
  };
  const spaces = { authorize: vi.fn().mockResolvedValue({}) };
  const storage = { createDownloadUrl: vi.fn().mockResolvedValue('https://download.test/signed') };
  return { service: new DistributionService(repository, spaces as never, storage), repository, storage };
}

describe('DistributionService', () => {
  it('returns a short-lived install plan with digest, permissions, and adapter', async () => {
    const { service, storage } = setup();
    const plan = await service.installPlan(tenant, 'user-1', {
      deviceId: 'device-1',
      capabilityId: 'capability-1',
      versionId: 'version-1',
      agent: 'codex',
    });
    expect(plan).toMatchObject({
      digest: 'a'.repeat(64),
      adapter: 'codex',
      permissions: { filesystem: 'read-project', network: 'none' },
      download: { expiresIn: 120 },
    });
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(version.objectKey, 120);
  });

  it('rejects an agent that is unsupported by either device or package', async () => {
    const { service } = setup();
    await expect(
      service.installPlan(tenant, 'user-1', {
        deviceId: 'device-1',
        capabilityId: 'capability-1',
        versionId: 'version-1',
        agent: 'cursor',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_INCOMPATIBLE', statusCode: 409 } satisfies Partial<AppError>);
  });

  it('does not distribute a withdrawn version', async () => {
    const { service, repository } = setup();
    vi.mocked(repository.findVersion).mockResolvedValue({ ...version, status: 'withdrawn' });
    await expect(
      service.installPlan(tenant, 'user-1', {
        deviceId: 'device-1',
        capabilityId: 'capability-1',
        versionId: 'version-1',
        agent: 'codex',
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_UNAVAILABLE', statusCode: 404 } satisfies Partial<AppError>);
  });
});
