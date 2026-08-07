import { randomUUID } from 'node:crypto';
import { type CapabilityManifest, classifyVersion, diffPackages, extractArchive } from '@agentdoor/capability-kit';
import type { TenantContext } from '@agentdoor/contracts/organizations';
import type {
  PromotePublicationRequest,
  PublicationListQuery,
  PublicationStatus,
  SubmitPublicationRequest,
  VersionStatus,
} from '@agentdoor/contracts/publications';
import type { ScanReport } from '@agentdoor/security-scan';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { SpaceService } from '../access/space.service.js';
import { ArtifactService } from '../capabilities/artifact.service.js';
import { transitionVersion, type VersionAction } from './publication.state.js';

export type FrozenPublicationCandidate = {
  capabilityId: string;
  sourceSpaceId: string;
  sourceRevisionId?: string;
  sourceVersionId?: string;
  artifactId: string;
  contentDigest: string;
  manifest: CapabilityManifest;
  scanReport: ScanReport;
};

export type PublicationRecord = {
  id: string;
  organizationId: string;
  capabilityId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  sourceRevisionId?: string;
  sourceVersionId?: string;
  candidateArtifactId: string;
  candidateDigest: string;
  candidateManifest: CapabilityManifest;
  candidateScanReport: ScanReport;
  version: string;
  reviewRequired: boolean;
  status: PublicationStatus;
  submittedByUserId: string;
  idempotencyKey: string;
  publishedVersionId?: string;
  createdAt: Date;
  resolvedAt?: Date;
};

export type PublishedVersionRecord = {
  id: string;
  organizationId: string;
  capabilityId: string;
  spaceId: string;
  version: string;
  artifactId: string;
  contentDigest: string;
  manifest: CapabilityManifest;
  status: VersionStatus;
  publishedAt: Date;
};

export interface PublicationDataStore {
  findByIdempotency(
    organizationId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<PublicationRecord | undefined>;
  findDraftCandidate(
    organizationId: string,
    capabilityId: string,
    draftId: string,
  ): Promise<FrozenPublicationCandidate | undefined>;
  findVersionCandidate(organizationId: string, versionId: string): Promise<FrozenPublicationCandidate | undefined>;
  submit(input: {
    publicationId: string;
    versionId: string;
    organizationId: string;
    userId: string;
    targetSpaceId: string;
    version: string;
    idempotencyKey: string;
    reviewRequired: boolean;
    candidate: FrozenPublicationCandidate;
  }): Promise<PublicationRecord>;
  findPublication(organizationId: string, publicationId: string): Promise<PublicationRecord | undefined>;
  listPublications(organizationId: string, query: PublicationListQuery): Promise<PublicationRecord[]>;
  review(input: {
    reviewId: string;
    versionId: string;
    organizationId: string;
    publicationId: string;
    reviewerUserId: string;
    decision: 'approve' | 'request_changes' | 'reject';
    reason: string;
    expectedDigest: string;
  }): Promise<PublicationRecord>;
  withdraw(input: { organizationId: string; publicationId: string; actorUserId: string }): Promise<PublicationRecord>;
  listVersions(organizationId: string, capabilityId: string): Promise<PublishedVersionRecord[]>;
  findVersion(organizationId: string, versionId: string): Promise<PublishedVersionRecord | undefined>;
  transitionVersion(input: {
    organizationId: string;
    versionId: string;
    actorUserId: string;
    from: VersionStatus;
    to: VersionStatus;
  }): Promise<PublishedVersionRecord>;
}

@Injectable()
export class PublishingService {
  constructor(
    @Inject('PUBLICATION_DATA_STORE') private readonly repository: PublicationDataStore,
    @Inject(SpaceService) private readonly spaces: Pick<SpaceService, 'authorize'>,
    @Inject(ArtifactService) private readonly artifacts: Pick<ArtifactService, 'readArtifact'>,
  ) {}

  async submit(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    idempotencyKey: string,
    input: SubmitPublicationRequest,
  ): Promise<PublicationRecord> {
    this.requireIdempotencyKey(idempotencyKey);
    const replay = await this.replay(tenant, userId, capabilityId, idempotencyKey, input.targetSpaceId, input.version);
    if (replay) return replay;
    const candidate = await this.repository.findDraftCandidate(tenant.organizationId, capabilityId, input.draftId);
    if (!candidate) this.denied();
    await this.spaces.authorize(tenant, userId, candidate.sourceSpaceId, 'content:submit');
    const target = await this.spaces.authorize(tenant, userId, input.targetSpaceId, 'content:submit');
    return this.submitCandidate(tenant, userId, idempotencyKey, input.targetSpaceId, input.version, candidate, {
      type: target.space.type,
      reviewPolicy: target.space.reviewPolicy,
    });
  }

  async promote(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    idempotencyKey: string,
    input: PromotePublicationRequest,
  ): Promise<PublicationRecord> {
    this.requireIdempotencyKey(idempotencyKey);
    const replay = await this.replay(tenant, userId, capabilityId, idempotencyKey, input.targetSpaceId, input.version);
    if (replay) return replay;
    const candidate = await this.repository.findVersionCandidate(tenant.organizationId, input.sourceVersionId);
    if (!candidate || candidate.capabilityId !== capabilityId) this.denied();
    await this.spaces.authorize(tenant, userId, candidate.sourceSpaceId, 'content:view-published');
    const target = await this.spaces.authorize(tenant, userId, input.targetSpaceId, 'content:submit');
    return this.submitCandidate(tenant, userId, idempotencyKey, input.targetSpaceId, input.version, candidate, {
      type: target.space.type,
      reviewPolicy: target.space.reviewPolicy,
    });
  }

  async get(tenant: TenantContext, userId: string, publicationId: string): Promise<PublicationRecord> {
    const publication = await this.requirePublication(tenant.organizationId, publicationId);
    await this.authorizePublicationView(tenant, userId, publication);
    return publication;
  }

  async list(tenant: TenantContext, userId: string, query: PublicationListQuery): Promise<PublicationRecord[]> {
    const rows = await this.repository.listPublications(tenant.organizationId, query);
    const visible: PublicationRecord[] = [];
    for (const publication of rows) {
      try {
        await this.authorizePublicationView(tenant, userId, publication);
        visible.push(publication);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'ACCESS_DENIED') throw error;
      }
    }
    return visible;
  }

  async review(
    tenant: TenantContext,
    userId: string,
    publicationId: string,
    decision: 'approve' | 'request_changes' | 'reject',
    reason: string,
  ): Promise<PublicationRecord> {
    const publication = await this.requirePublication(tenant.organizationId, publicationId);
    if (publication.submittedByUserId === userId) {
      throw new AppError('PUBLICATION_SELF_REVIEW', 'Submitters cannot review their own publication.', 403);
    }
    await this.spaces.authorize(tenant, userId, publication.targetSpaceId, 'content:review');
    return this.repository.review({
      reviewId: randomUUID(),
      versionId: randomUUID(),
      organizationId: tenant.organizationId,
      publicationId,
      reviewerUserId: userId,
      decision,
      reason,
      expectedDigest: publication.candidateDigest,
    });
  }

  async withdraw(tenant: TenantContext, userId: string, publicationId: string): Promise<PublicationRecord> {
    const publication = await this.requirePublication(tenant.organizationId, publicationId);
    if (publication.status === 'in_review' && publication.submittedByUserId === userId) {
      await this.spaces.authorize(tenant, userId, publication.sourceSpaceId, 'content:submit');
    } else {
      await this.spaces.authorize(tenant, userId, publication.targetSpaceId, 'content:review');
    }
    return this.repository.withdraw({ organizationId: tenant.organizationId, publicationId, actorUserId: userId });
  }

  async scanReport(tenant: TenantContext, userId: string, publicationId: string): Promise<ScanReport> {
    return (await this.get(tenant, userId, publicationId)).candidateScanReport;
  }

  async versions(tenant: TenantContext, userId: string, capabilityId: string): Promise<PublishedVersionRecord[]> {
    const rows = await this.repository.listVersions(tenant.organizationId, capabilityId);
    const visible: PublishedVersionRecord[] = [];
    for (const version of rows) {
      try {
        await this.spaces.authorize(tenant, userId, version.spaceId, 'content:view-published');
        visible.push(version);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'ACCESS_DENIED') throw error;
      }
    }
    return visible;
  }

  async version(tenant: TenantContext, userId: string, capabilityId: string, versionId: string) {
    const version = await this.requireVersion(tenant.organizationId, capabilityId, versionId);
    await this.spaces.authorize(tenant, userId, version.spaceId, 'content:view-published');
    return version;
  }

  async diff(tenant: TenantContext, userId: string, capabilityId: string, versionId: string, againstVersionId: string) {
    const [to, from] = await Promise.all([
      this.requireVersion(tenant.organizationId, capabilityId, versionId),
      this.requireVersion(tenant.organizationId, capabilityId, againstVersionId),
    ]);
    await Promise.all([
      this.spaces.authorize(tenant, userId, to.spaceId, 'content:view-published'),
      this.spaces.authorize(tenant, userId, from.spaceId, 'content:view-published'),
    ]);
    const [toArtifact, fromArtifact] = await Promise.all([
      this.artifacts.readArtifact(tenant.organizationId, to.artifactId),
      this.artifacts.readArtifact(tenant.organizationId, from.artifactId),
    ]);
    const packageDiff = diffPackages(extractArchive(fromArtifact.bytes), extractArchive(toArtifact.bytes));
    return {
      fromVersionId: from.id,
      toVersionId: to.id,
      ...packageDiff,
      recommendedChange: classifyVersion(packageDiff),
    };
  }

  async transition(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    versionId: string,
    action: VersionAction,
  ): Promise<PublishedVersionRecord> {
    const version = await this.requireVersion(tenant.organizationId, capabilityId, versionId);
    await this.spaces.authorize(tenant, userId, version.spaceId, 'content:review');
    return this.repository.transitionVersion({
      organizationId: tenant.organizationId,
      versionId,
      actorUserId: userId,
      from: version.status,
      to: transitionVersion(version.status, action),
    });
  }

  private submitCandidate(
    tenant: TenantContext,
    userId: string,
    idempotencyKey: string,
    targetSpaceId: string,
    version: string,
    candidate: FrozenPublicationCandidate,
    target: { type: 'personal' | 'team' | 'project' | 'organization'; reviewPolicy: 'direct' | 'required' },
  ): Promise<PublicationRecord> {
    if (candidate.scanReport.blocked) {
      throw new AppError('PUBLICATION_SCAN_BLOCKED', 'Blocked capability packages cannot be published.', 409);
    }
    const reviewRequired =
      target.type === 'organization' ||
      ((target.type === 'team' || target.type === 'project') && target.reviewPolicy === 'required');
    return this.repository.submit({
      publicationId: randomUUID(),
      versionId: randomUUID(),
      organizationId: tenant.organizationId,
      userId,
      targetSpaceId,
      version,
      idempotencyKey,
      reviewRequired,
      candidate,
    });
  }

  private async authorizePublicationView(
    tenant: TenantContext,
    userId: string,
    publication: PublicationRecord,
  ): Promise<void> {
    try {
      await this.spaces.authorize(tenant, userId, publication.sourceSpaceId, 'content:view-private');
    } catch (sourceError) {
      try {
        await this.spaces.authorize(
          tenant,
          userId,
          publication.targetSpaceId,
          publication.status === 'published' ? 'content:view-published' : 'content:view-private',
        );
      } catch {
        throw sourceError;
      }
    }
  }

  private async replay(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    idempotencyKey: string,
    targetSpaceId: string,
    version: string,
  ): Promise<PublicationRecord | undefined> {
    const publication = await this.repository.findByIdempotency(tenant.organizationId, userId, idempotencyKey);
    if (!publication) return undefined;
    if (
      publication.capabilityId !== capabilityId ||
      publication.targetSpaceId !== targetSpaceId ||
      publication.version !== version
    ) {
      throw new AppError('IDEMPOTENCY_KEY_CONFLICT', 'This Idempotency-Key was used for another request.', 409);
    }
    await this.authorizePublicationView(tenant, userId, publication);
    return publication;
  }

  private async requirePublication(organizationId: string, publicationId: string): Promise<PublicationRecord> {
    const publication = await this.repository.findPublication(organizationId, publicationId);
    if (!publication) this.denied();
    return publication;
  }

  private async requireVersion(organizationId: string, capabilityId: string, versionId: string) {
    const version = await this.repository.findVersion(organizationId, versionId);
    if (!version || version.capabilityId !== capabilityId) this.denied();
    return version;
  }

  private requireIdempotencyKey(value: string): void {
    if (value.trim().length < 8 || value.length > 200) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'A stable Idempotency-Key is required.', 400);
    }
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this publication.', 403);
  }
}
