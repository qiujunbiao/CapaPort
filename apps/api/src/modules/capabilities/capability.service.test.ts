import { buildArchive } from '@agentdoor/capability-kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityService } from './capability.service.js';

const tenant = { organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'member' as const };
const capability = {
  id: 'capability-a',
  organizationId: 'org-a',
  spaceId: 'space-a',
  slug: 'release-helper',
  name: 'Release helper',
  description: '',
  tags: ['release'],
  compatibility: ['codex'] as const,
  ownerUserId: 'user-a',
  status: 'active' as const,
};
const manifest = `schemaVersion: agentdoor.io/v1alpha1
kind: CapabilityPackage
metadata:
  slug: release-helper
  name: Release helper
  description: Safe release workflow
  tags: [release]
spec:
  components:
    - type: skill
      path: skills/release
  compatibility:
    agents: [codex]
  permissions:
    filesystem: read-project
    network: none
  entrypoints:
    default: skills/release/SKILL.md
  dependencies: []
`;

function archive(skillBody: string, includeReadme = true): Uint8Array {
  return buildArchive([
    { path: 'agentdoor.yaml', content: new TextEncoder().encode(manifest) },
    ...(includeReadme ? [{ path: 'README.md', content: new TextEncoder().encode('# Release helper') }] : []),
    { path: 'skills/release/SKILL.md', content: new TextEncoder().encode(skillBody) },
  ]);
}

describe('CapabilityService', () => {
  const spaces = {
    authorize: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([{ id: 'space-a' }]),
  };
  const artifacts = { readArtifact: vi.fn(), createDownload: vi.fn() };
  const policies = { scanPolicyForOrganization: vi.fn() };
  const repository = {
    createCapability: vi.fn(),
    updateCapability: vi.fn(),
    findCapability: vi.fn().mockResolvedValue(capability),
    createDraft: vi.fn(),
    searchCapabilities: vi.fn().mockResolvedValue([capability]),
    findDraft: vi.fn().mockResolvedValue({ ...capability, id: 'draft-a', capabilityId: capability.id }),
    createRevision: vi.fn(),
    listDrafts: vi.fn().mockResolvedValue([]),
    listRevisions: vi.fn().mockResolvedValue([]),
    findRevision: vi.fn(),
    findVersion: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    policies.scanPolicyForOrganization.mockResolvedValue(undefined);
  });

  it('validates, canonically hashes, and scans a confirmed package before making a draft ready', async () => {
    artifacts.readArtifact.mockResolvedValue({
      artifact: { id: 'artifact-a', organizationId: 'org-a', status: 'ready' },
      bytes: archive('Use the verified release checklist.'),
    });
    repository.createRevision.mockImplementation(async (input) => ({ id: 'revision-a', sequence: 1, ...input }));
    const service = new CapabilityService(repository, artifacts, spaces, policies);
    const result = await service.createRevision(tenant, 'user-a', 'capability-a', 'draft-a', 'artifact-a');
    expect(result).toMatchObject({ scanStatus: 'passed', sequence: 1 });
    expect(result.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        spaceId: 'space-a',
        artifactId: 'artifact-a',
        draftStatus: 'ready',
      }),
    );
  });

  it('persists a blocked revision when server-side scanning finds a secret', async () => {
    artifacts.readArtifact.mockResolvedValue({
      artifact: { id: 'artifact-a', organizationId: 'org-a', status: 'ready' },
      bytes: archive('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456'),
    });
    repository.createRevision.mockImplementation(async (input) => ({ id: 'revision-a', sequence: 1, ...input }));
    const service = new CapabilityService(repository, artifacts, spaces, policies);
    const result = await service.createRevision(tenant, 'user-a', 'capability-a', 'draft-a', 'artifact-a');
    expect(result.scanStatus).toBe('blocked');
    expect(result.scanReport).toMatchObject({ blocked: true });
    expect(repository.createRevision).toHaveBeenCalledWith(expect.objectContaining({ draftStatus: 'blocked' }));
  });

  it('rejects an archive missing required package files without writing a revision', async () => {
    artifacts.readArtifact.mockResolvedValue({
      artifact: { id: 'artifact-a', organizationId: 'org-a', status: 'ready' },
      bytes: archive('Safe content.', false),
    });
    const service = new CapabilityService(repository, artifacts, spaces, policies);
    await expect(
      service.createRevision(tenant, 'user-a', 'capability-a', 'draft-a', 'artifact-a'),
    ).rejects.toMatchObject({ code: 'CAPABILITY_PACKAGE_INVALID' });
    expect(repository.createRevision).not.toHaveBeenCalled();
  });

  it('limits search to the subject accessible space identifiers', async () => {
    const service = new CapabilityService(repository, artifacts, spaces, policies);
    await service.search(tenant, 'user-a', { query: 'release', limit: 25 });
    expect(repository.searchCapabilities).toHaveBeenCalledWith(
      'org-a',
      ['space-a'],
      expect.objectContaining({ query: 'release' }),
    );
  });

  it('authorizes and returns a short-lived download for an editable draft revision', async () => {
    repository.findRevision.mockResolvedValue({
      id: 'revision-a',
      organizationId: 'org-a',
      spaceId: 'space-a',
      draftId: 'draft-a',
      artifactId: 'artifact-a',
    });
    artifacts.createDownload.mockResolvedValue({ url: 'https://download.test/revision', expiresIn: 120 });
    const service = new CapabilityService(repository, artifacts, spaces, policies);
    await expect(service.downloadRevision(tenant, 'user-a', 'capability-a', 'draft-a', 'revision-a')).resolves.toEqual({
      revisionId: 'revision-a',
      url: 'https://download.test/revision',
      expiresIn: 120,
    });
    expect(spaces.authorize).toHaveBeenCalledWith(tenant, 'user-a', 'space-a', 'content:view-private');
    expect(artifacts.createDownload).toHaveBeenCalledWith('org-a', 'artifact-a');
  });

  it('applies organization blocked terms during the authoritative server scan', async () => {
    artifacts.readArtifact.mockResolvedValue({
      artifact: { id: 'artifact-a', organizationId: 'org-a', status: 'ready' },
      bytes: archive('This document contains the internal codename ORCHID.'),
    });
    policies.scanPolicyForOrganization.mockResolvedValue({
      blockedSeverities: ['medium', 'high', 'critical'],
      confirmationSeverities: [],
      blockedTerms: ['ORCHID'],
      allowedExecutablePaths: [],
      allowedNetworkHosts: [],
      executablePolicy: 'confirm',
      highEntropyMinimumLength: 32,
      highEntropyThreshold: 4.2,
      maxFileBytes: 2_000_000,
      maxPackageBytes: 50_000_000,
      sourceTreePatterns: ['.git/', 'node_modules/', 'src/', 'app/'],
    });
    repository.createRevision.mockImplementation(async (input) => ({ id: 'revision-a', sequence: 1, ...input }));

    const result = await new CapabilityService(repository, artifacts, spaces, policies).createRevision(
      tenant,
      'user-a',
      'capability-a',
      'draft-a',
      'artifact-a',
    );

    expect(result.scanStatus).toBe('blocked');
    expect(result.scanReport.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'SEC_ORG_TERM' })]));
  });
});
