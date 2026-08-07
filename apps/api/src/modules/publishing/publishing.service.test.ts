import type { CapabilityManifest } from '@agentdoor/capability-kit';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../platform/errors/app-error.js';
import { type FrozenPublicationCandidate, type PublicationDataStore, PublishingService } from './publishing.service.js';

const tenant = { organizationId: 'org-1', membershipId: 'membership-1', organizationRole: 'member' as const };
const manifest = {
  apiVersion: 'agentdoor.io/v1alpha1',
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
  scanReport: { blocked: false, findings: [], scannedFiles: 2, scannedBytes: 1_024 },
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
});
