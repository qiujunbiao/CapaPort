import { buildArchive, type CapabilityManifest } from '@capaport/capability-kit';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import { type FrozenPublicationCandidate, type PublicationDataStore, PublishingService } from './publishing.service.js';

const tenant = { organizationId: 'org-1', membershipId: 'membership-1', organizationRole: 'member' as const };
const manifest = {
  apiVersion: 'capaport.io/v1alpha1',
  kind: 'CapabilityPackage',
  metadata: { slug: 'release-helper', name: 'Release Helper', version: '1.0.0' },
  spec: { compatibility: { agents: ['codex'] }, components: [], entrypoints: {} },
} as unknown as CapabilityManifest;
const candidate: FrozenPublicationCandidate = {
  capabilityId: 'capability-1',
  sourceSpaceId: 'personal-space',
  sourceRevisionId: 'revision-1',
  artifactId: 'artifact-1',
  contentDigest: 'a'.repeat(64),
  manifest,
  scanReport: { blocked: false, requiresConfirmation: false, findings: [], scannedFiles: 2, scannedBytes: 1_024 },
};

function setup(space: { type: 'personal' | 'team' | 'project' | 'organization'; reviewPolicy: 'direct' | 'required' }) {
  const publication = {
    id: 'publication-1',
    organizationId: tenant.organizationId,
    capabilityId: candidate.capabilityId,
    sourceSpaceId: candidate.sourceSpaceId,
    targetSpaceId: 'target-space',
    candidateArtifactId: candidate.artifactId,
    candidateDigest: candidate.contentDigest,
    candidateManifest: candidate.manifest,
    candidateScanReport: candidate.scanReport,
    sourceRevisionId: candidate.sourceRevisionId,
    version: '1.0.0',
    reviewRequired: space.type === 'organization' || space.reviewPolicy === 'required',
    status: 'in_review' as const,
    submittedByUserId: 'user-1',
    idempotencyKey: 'submit-1',
    createdAt: new Date(),
  };
  const repository: PublicationDataStore = {
    findByIdempotency: vi.fn().mockResolvedValue(undefined),
    findDraftCandidate: vi.fn().mockResolvedValue(candidate),
    findVersionCandidate: vi.fn(),
    submit: vi.fn().mockImplementation(async (input) => ({
      ...publication,
      reviewRequired: input.reviewRequired,
      status: input.reviewRequired ? 'in_review' : 'published',
      ...(input.reviewRequired ? {} : { publishedVersionId: 'version-1', resolvedAt: new Date() }),
    })),
    findPublication: vi.fn().mockResolvedValue(publication),
    listPublications: vi.fn().mockResolvedValue([publication]),
    review: vi.fn().mockResolvedValue({ ...publication, status: 'published', publishedVersionId: 'version-1' }),
    withdraw: vi.fn(),
    listVersions: vi.fn().mockResolvedValue([]),
    findVersion: vi.fn(),
    transitionVersion: vi.fn(),
  };
  const spaces = {
    authorize: vi.fn().mockResolvedValue({
      space: { id: 'target-space', organizationId: tenant.organizationId, status: 'active', ...space },
    }),
  };
  return {
    service: new PublishingService(repository, spaces as never, { readArtifact: vi.fn() } as never),
    repository,
    spaces,
  };
}

describe('PublishingService', () => {
  it('publishes directly to a personal space', async () => {
    const { service, repository } = setup({ type: 'personal', reviewPolicy: 'direct' });
    const result = await service.submit(tenant, 'user-1', candidate.capabilityId, 'submit-1', {
      draftId: 'draft-1',
      targetSpaceId: 'target-space',
      version: '1.0.0',
    });
    expect(result.status).toBe('published');
    expect(repository.submit).toHaveBeenCalledWith(expect.objectContaining({ reviewRequired: false }));
  });

  it('forces review for an organization space regardless of its stored policy', async () => {
    const { service, repository } = setup({ type: 'organization', reviewPolicy: 'direct' });
    const result = await service.submit(tenant, 'user-1', candidate.capabilityId, 'submit-1', {
      draftId: 'draft-1',
      targetSpaceId: 'target-space',
      version: '1.0.0',
    });
    expect(result.status).toBe('in_review');
    expect(repository.submit).toHaveBeenCalledWith(expect.objectContaining({ reviewRequired: true }));
  });

  it('requires an explicit reason for every non-blocking risk finding', async () => {
    const { service, repository } = setup({ type: 'organization', reviewPolicy: 'required' });
    vi.mocked(repository.findDraftCandidate).mockResolvedValue({
      ...candidate,
      scanReport: {
        ...candidate.scanReport,
        findings: [
          {
            ruleId: 'SEC_EXECUTABLE_FILE',
            severity: 'medium',
            path: 'scripts/run.sh',
            evidenceDigest: 'b'.repeat(64),
            message: 'Executable file',
            blocking: false,
          },
        ],
      },
    });
    await expect(
      service.submit(tenant, 'user-1', candidate.capabilityId, 'submit-risk-1', {
        draftId: 'draft-1',
        targetSpaceId: 'target-space',
        version: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'PUBLICATION_RISK_ACCEPTANCE_REQUIRED', statusCode: 409 });
    await service.submit(tenant, 'user-1', candidate.capabilityId, 'submit-risk-2', {
      draftId: 'draft-1',
      targetSpaceId: 'target-space',
      version: '1.0.0',
      riskAcceptance: { findingDigests: ['b'.repeat(64)], reason: '业务需要执行经过审核的本地脚本' },
    });
    expect(repository.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        riskAcceptance: expect.objectContaining({
          findingDigests: ['b'.repeat(64)],
          reason: '业务需要执行经过审核的本地脚本',
          acceptedByUserId: 'user-1',
        }),
      }),
    );
  });

  it('replays a completed submission after its source draft is frozen', async () => {
    const { service, repository } = setup({ type: 'organization', reviewPolicy: 'required' });
    const stored = await repository.findPublication(tenant.organizationId, 'publication-1');
    vi.mocked(repository.findByIdempotency).mockResolvedValue(stored);
    vi.mocked(repository.findDraftCandidate).mockRejectedValue(new Error('frozen draft must not be read'));
    const result = await service.submit(tenant, 'user-1', candidate.capabilityId, 'submit-1', {
      draftId: 'draft-1',
      targetSpaceId: 'target-space',
      version: '1.0.0',
    });
    expect(result.id).toBe('publication-1');
    expect(repository.findDraftCandidate).not.toHaveBeenCalled();
  });

  it('does not let a submitter approve their own publication', async () => {
    const { service, repository } = setup({ type: 'organization', reviewPolicy: 'required' });
    await expect(service.review(tenant, 'user-1', 'publication-1', 'approve', 'Looks good')).rejects.toMatchObject({
      code: 'PUBLICATION_SELF_REVIEW',
      statusCode: 403,
    } satisfies Partial<AppError>);
    expect(repository.review).not.toHaveBeenCalled();
  });

  it('lets an organization owner approve their own submission in a single-manager organization', async () => {
    const { service, repository } = setup({ type: 'organization', reviewPolicy: 'required' });
    const ownerTenant = { ...tenant, organizationRole: 'owner' as const };

    const result = await service.review(ownerTenant, 'user-1', 'publication-1', 'approve', '管理员确认发布');

    expect(result.status).toBe('published');
    expect(repository.review).toHaveBeenCalledWith(
      expect.objectContaining({ publicationId: 'publication-1', reviewerUserId: 'user-1', allowSelfReview: true }),
    );
  });

  it('delegates approval atomically using the frozen candidate digest', async () => {
    const { service, repository } = setup({ type: 'organization', reviewPolicy: 'required' });
    const result = await service.review(tenant, 'reviewer-1', 'publication-1', 'approve', 'Looks good');
    expect(result.status).toBe('published');
    expect(repository.review).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationId: 'publication-1',
        reviewerUserId: 'reviewer-1',
        expectedDigest: 'a'.repeat(64),
      }),
    );
  });

  it('returns an all-added candidate diff when no published baseline exists', async () => {
    const { service } = setup({ type: 'organization', reviewPolicy: 'required' });
    const readArtifact = vi
      .fn()
      .mockResolvedValue({ bytes: buildArchive([{ path: 'README.md', content: new TextEncoder().encode('hello') }]) });
    Object.assign(service, { artifacts: { readArtifact } });
    const result = await service.candidateDiff(tenant, 'reviewer-1', 'publication-1');
    expect(result).toMatchObject({
      fromVersionId: null,
      candidateDigest: 'a'.repeat(64),
      added: ['README.md'],
      modified: [],
      removed: [],
    });
  });
});
