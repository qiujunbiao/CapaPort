import { createHash } from 'node:crypto';
import { buildArchive } from '@capaport/capability-kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ProjectBindingRecord, ProjectService } from './project.service.js';

const tenant = { organizationId: 'org-a', membershipId: 'member-a', organizationRole: 'member' as const };
const binding: ProjectBindingRecord = {
  id: 'binding-a',
  organizationId: 'org-a',
  projectSpaceId: 'project-a',
  userId: 'user-a',
  deviceId: 'device-a',
  localBindingId: 'local-a',
  agents: ['codex'],
  status: 'active',
  createdAt: new Date(0).toISOString(),
};

describe('ProjectService', () => {
  const spaces = {
    authorize: vi.fn().mockResolvedValue({
      space: { id: 'project-a', type: 'project', status: 'active' },
    }),
  };
  const store = {
    findOwnedDevice: vi.fn().mockResolvedValue(true),
    createBinding: vi.fn(),
    listBindings: vi.fn().mockResolvedValue([binding]),
    findBinding: vi.fn().mockResolvedValue(binding),
    removeBinding: vi.fn().mockResolvedValue(undefined),
    createContext: vi.fn(),
    listContexts: vi.fn().mockResolvedValue([]),
    findContext: vi.fn(),
  };
  const artifacts = { readArtifact: vi.fn(), createDownload: vi.fn() };
  const policies = { scanPolicyForOrganization: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => vi.clearAllMocks());

  it.each([
    [
      'createBinding',
      () =>
        new ProjectService(store, spaces as never, artifacts as never, policies as never).createBinding(
          tenant,
          'user-a',
          'project-a',
          {
            deviceId: 'device-a',
            localBindingId: '11111111-1111-4111-8111-111111111111',
            agents: ['codex'],
          },
        ),
    ],
    [
      'removeBinding',
      () =>
        new ProjectService(store, spaces as never, artifacts as never, policies as never).removeBinding(
          tenant,
          'user-a',
          'project-a',
          'binding-a',
        ),
    ],
  ])('requires content creation authority for %s', async (_operation, invoke) => {
    store.createBinding.mockImplementation(async (input) => input);

    await invoke();

    expect(spaces.authorize).toHaveBeenCalledWith(tenant, 'user-a', 'project-a', 'content:create');
  });

  it('requires content creation authority before registering project context', async () => {
    const service = new ProjectService(store, spaces as never, artifacts as never, policies as never);

    await expect(
      service.registerContext(tenant, 'user-a', 'project-a', {
        bindingId: '11111111-1111-4111-8111-111111111111',
        artifactId: '22222222-2222-4222-8222-222222222222',
        digest: 'a'.repeat(64),
        selectionDigest: 'b'.repeat(64),
        fileCount: 1,
        totalBytes: 40,
        agents: ['claude-code'],
        scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: new Date().toISOString() },
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_AGENT_NOT_BOUND' });
    expect(spaces.authorize).toHaveBeenCalledWith(tenant, 'user-a', 'project-a', 'content:create');
  });

  it('creates device-safe metadata without accepting or forwarding a local path', async () => {
    store.createBinding.mockImplementation(async (input) => input);
    const service = new ProjectService(store, spaces as never, artifacts as never, policies as never);
    const result = await service.createBinding(tenant, 'user-a', 'project-a', {
      deviceId: 'device-a',
      localBindingId: '11111111-1111-4111-8111-111111111111',
      agents: ['codex'],
    });
    expect(result).not.toHaveProperty('path');
    expect(store.createBinding).toHaveBeenCalledWith(
      expect.not.objectContaining({ localPath: expect.anything(), path: expect.anything() }),
    );
  });

  it('rejects a context projection to an agent not enabled by the binding', async () => {
    const service = new ProjectService(store, spaces as never, artifacts as never, policies as never);
    await expect(
      service.registerContext(tenant, 'user-a', 'project-a', {
        bindingId: '11111111-1111-4111-8111-111111111111',
        artifactId: '22222222-2222-4222-8222-222222222222',
        digest: 'a'.repeat(64),
        selectionDigest: 'b'.repeat(64),
        fileCount: 1,
        totalBytes: 40,
        agents: ['claude-code'],
        scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: new Date().toISOString() },
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_AGENT_NOT_BOUND' });
  });

  it('allows removal after the local directory has disappeared', async () => {
    const service = new ProjectService(store, spaces as never, artifacts as never, policies as never);
    await service.removeBinding(tenant, 'user-a', 'project-a', 'binding-a');
    expect(store.removeBinding).toHaveBeenCalledWith('org-a', 'project-a', 'user-a', 'binding-a');
  });

  it('shares registered context with every authorized member of the project space', async () => {
    store.listContexts.mockResolvedValueOnce([
      {
        id: 'context-a',
        organizationId: 'org-a',
        projectSpaceId: 'project-a',
        bindingId: 'binding-a',
        deviceId: 'device-a',
        artifactId: 'artifact-a',
        digest: 'a'.repeat(64),
        selectionDigest: 'b'.repeat(64),
        fileCount: 1,
        totalBytes: 20,
        agents: ['codex'],
        scanEngineVersion: '1.0.0',
        createdAt: new Date(0).toISOString(),
      },
    ]);
    const service = new ProjectService(store, spaces as never, artifacts as never, policies as never);

    const contexts = await service.listContexts(tenant, 'another-project-member', 'project-a');

    expect(contexts).toHaveLength(1);
    expect(store.listContexts).toHaveBeenCalledWith('org-a', 'project-a');
  });

  it('re-scans the uploaded archive and blocks a secret even after a client pass claim', async () => {
    const content = new TextEncoder().encode('api_key=very-private-server-secret');
    const manifest = new TextEncoder().encode(
      JSON.stringify({ selectionDigest: 'b'.repeat(64), fileCount: 1, totalBytes: content.byteLength }),
    );
    const archive = buildArchive([
      { path: 'context.json', content: manifest },
      { path: 'context/README.md', content },
    ]);
    const digest = createHash('sha256').update(archive).digest('hex');
    artifacts.readArtifact.mockResolvedValue({ artifact: { sha256: digest }, bytes: archive });
    const service = new ProjectService(store, spaces as never, artifacts as never, policies as never);
    await expect(
      service.registerContext(tenant, 'user-a', 'project-a', {
        bindingId: '11111111-1111-4111-8111-111111111111',
        artifactId: '22222222-2222-4222-8222-222222222222',
        digest,
        selectionDigest: 'b'.repeat(64),
        fileCount: 1,
        totalBytes: content.byteLength,
        agents: ['codex'],
        scan: { status: 'passed', engineVersion: '1.0.0', scannedAt: new Date().toISOString() },
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_BLOCKED' });
    expect(store.createContext).not.toHaveBeenCalled();
  });
});
