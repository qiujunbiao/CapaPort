import { randomUUID } from 'node:crypto';
import {
  type CapabilityManifest,
  extractArchive,
  hashPackage,
  type PackageFile,
  parseManifest,
  unsupportedComponentsForAgent,
} from '@capaport/capability-kit';
import type {
  AgentId,
  CapabilitySearchQuery,
  CapabilitySummary,
  CreateCapabilityRequest,
  UpdateCapabilityRequest,
} from '@capaport/contracts/capabilities';
import type { TenantContext } from '@capaport/contracts/organizations';
import type { SpaceSummary } from '@capaport/contracts/spaces';
import type { ScanReport } from '@capaport/security-scan';
import { scanPackage } from '@capaport/security-scan';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { SpaceService } from '../access/space.service.js';
import { SecurityPolicyService } from '../organizations/security-policy.service.js';
import { ArtifactService } from './artifact.service.js';

export type CapabilityRecord = CapabilitySummary & {
  publishedSpaceIds?: string[];
};
export type CapabilityDraftRecord = {
  id: string;
  organizationId: string;
  spaceId: string;
  capabilityId: string;
  createdByUserId: string;
  status: 'draft' | 'ready' | 'blocked' | 'submitted';
  currentRevisionId?: string;
  createdAt: Date;
  updatedAt: Date;
};
export type DraftRevisionRecord = {
  id: string;
  organizationId: string;
  spaceId: string;
  draftId: string;
  sequence: number;
  artifactId: string;
  contentDigest: string;
  manifest: CapabilityManifest;
  scanStatus: 'passed' | 'blocked';
  scanReport: ScanReport;
  createdByUserId: string;
  createdAt: Date;
};
export type CapabilityVersionRecord = {
  id: string;
  organizationId: string;
  spaceId: string;
  capabilityId: string;
  status: 'published' | 'deprecated' | 'withdrawn' | 'archived';
};

export interface CapabilityDataStore {
  createCapability(input: {
    id: string;
    draftId: string;
    organizationId: string;
    userId: string;
    spaceId: string;
    slug: string;
    name: string;
    description: string;
    tags: string[];
    compatibility: AgentId[];
    forkedFromVersionId?: string;
  }): Promise<{ capability: CapabilityRecord; draft: CapabilityDraftRecord }>;
  updateCapability(
    organizationId: string,
    capabilityId: string,
    actorUserId: string,
    input: UpdateCapabilityRequest,
  ): Promise<CapabilityRecord>;
  findCapability(organizationId: string, capabilityId: string): Promise<CapabilityRecord | undefined>;
  createDraft(input: {
    id: string;
    organizationId: string;
    spaceId: string;
    capabilityId: string;
    userId: string;
  }): Promise<CapabilityDraftRecord>;
  searchCapabilities(
    organizationId: string,
    accessibleSpaceIds: string[],
    query: CapabilitySearchQuery,
  ): Promise<CapabilityRecord[]>;
  findDraft(organizationId: string, capabilityId: string, draftId: string): Promise<CapabilityDraftRecord | undefined>;
  createRevision(input: {
    id: string;
    organizationId: string;
    spaceId: string;
    capabilityId: string;
    draftId: string;
    artifactId: string;
    contentDigest: string;
    manifest: CapabilityManifest;
    scanStatus: 'passed' | 'blocked';
    scanReport: ScanReport;
    draftStatus: 'ready' | 'blocked';
    userId: string;
  }): Promise<DraftRevisionRecord>;
  listDrafts(organizationId: string, capabilityId: string): Promise<CapabilityDraftRecord[]>;
  listRevisions(organizationId: string, capabilityId: string, draftId: string): Promise<DraftRevisionRecord[]>;
  findRevision(
    organizationId: string,
    capabilityId: string,
    draftId: string,
    revisionId: string,
  ): Promise<DraftRevisionRecord | undefined>;
  findVersion(organizationId: string, versionId: string): Promise<CapabilityVersionRecord | undefined>;
}

@Injectable()
export class CapabilityService {
  constructor(
    @Inject('CAPABILITY_DATA_STORE') private readonly repository: CapabilityDataStore,
    @Inject(ArtifactService) private readonly artifacts: Pick<ArtifactService, 'readArtifact' | 'createDownload'>,
    @Inject(SpaceService) private readonly spaces: Pick<SpaceService, 'authorize' | 'list'>,
    @Inject(SecurityPolicyService)
    private readonly securityPolicies: Pick<SecurityPolicyService, 'scanPolicyForOrganization'>,
  ) {}

  async create(tenant: TenantContext, userId: string, input: CreateCapabilityRequest) {
    await this.spaces.authorize(tenant, userId, input.spaceId, 'content:create');
    if (input.forkedFromVersionId) {
      const source = await this.repository.findVersion(tenant.organizationId, input.forkedFromVersionId);
      if (!source || (source.status !== 'published' && source.status !== 'deprecated')) {
        throw new AppError('CAPABILITY_FORK_SOURCE_INVALID', 'Fork source is unavailable.', 404);
      }
      await this.spaces.authorize(tenant, userId, source.spaceId, 'content:view-published');
    }
    try {
      return await this.repository.createCapability({
        id: randomUUID(),
        draftId: randomUUID(),
        organizationId: tenant.organizationId,
        userId,
        spaceId: input.spaceId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        tags: [...new Set(input.tags)],
        compatibility: [...new Set(input.compatibility)],
        ...(input.forkedFromVersionId ? { forkedFromVersionId: input.forkedFromVersionId } : {}),
      });
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new AppError('CAPABILITY_SLUG_EXISTS', 'Capability slug already exists.', 409);
      throw error;
    }
  }

  async get(tenant: TenantContext, userId: string, capabilityId: string): Promise<CapabilityRecord> {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.authorizeCapability(tenant, userId, capability);
    return capability;
  }

  async update(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    input: UpdateCapabilityRequest,
  ): Promise<CapabilityRecord> {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:edit');
    return this.repository.updateCapability(tenant.organizationId, capabilityId, userId, input);
  }

  async search(tenant: TenantContext, userId: string, query: CapabilitySearchQuery): Promise<CapabilityRecord[]> {
    const accessibleSpaces = await this.spaces.list(tenant, userId);
    const candidates = await this.repository.searchCapabilities(
      tenant.organizationId,
      accessibleSpaces.map((space: SpaceSummary) => space.id),
      query,
    );
    const allowed: CapabilityRecord[] = [];
    for (const capability of candidates) {
      try {
        await this.authorizeCapability(tenant, userId, capability);
        allowed.push(capability);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'ACCESS_DENIED') throw error;
      }
    }
    return allowed;
  }

  async drafts(tenant: TenantContext, userId: string, capabilityId: string): Promise<CapabilityDraftRecord[]> {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:view-private');
    return this.repository.listDrafts(tenant.organizationId, capabilityId);
  }

  async createDraft(tenant: TenantContext, userId: string, capabilityId: string): Promise<CapabilityDraftRecord> {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:edit');
    return this.repository.createDraft({
      id: randomUUID(),
      organizationId: tenant.organizationId,
      spaceId: capability.spaceId,
      capabilityId,
      userId,
    });
  }

  async revisions(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    draftId: string,
  ): Promise<DraftRevisionRecord[]> {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:view-private');
    if (!(await this.repository.findDraft(tenant.organizationId, capabilityId, draftId))) this.denied();
    return this.repository.listRevisions(tenant.organizationId, capabilityId, draftId);
  }

  async downloadRevision(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    draftId: string,
    revisionId: string,
  ) {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:view-private');
    const revision = await this.repository.findRevision(tenant.organizationId, capabilityId, draftId, revisionId);
    if (!revision || revision.spaceId !== capability.spaceId) this.denied();
    return {
      revisionId: revision.id,
      ...(await this.artifacts.createDownload(tenant.organizationId, revision.artifactId)),
    };
  }

  async createRevision(
    tenant: TenantContext,
    userId: string,
    capabilityId: string,
    draftId: string,
    artifactId: string,
  ): Promise<DraftRevisionRecord> {
    const capability = await this.requireCapability(tenant.organizationId, capabilityId);
    await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:edit');
    const draft = await this.repository.findDraft(tenant.organizationId, capabilityId, draftId);
    if (!draft || draft.spaceId !== capability.spaceId) this.denied();
    const { bytes } = await this.artifacts.readArtifact(tenant.organizationId, artifactId);
    const files = this.validateArchive(bytes, capability.slug);
    const manifestFile = files.find((file) => file.path === 'capaport.yaml');
    if (!manifestFile) throw new AppError('CAPABILITY_PACKAGE_INVALID', 'Package manifest is required.', 400);
    let manifest: CapabilityManifest;
    try {
      manifest = parseManifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.content));
    } catch (error) {
      throw new AppError('CAPABILITY_MANIFEST_INVALID', this.safeValidationMessage(error), 400);
    }
    if (manifest.metadata.slug !== capability.slug) {
      throw new AppError('CAPABILITY_MANIFEST_MISMATCH', 'Manifest slug must match the capability slug.', 409);
    }
    const declaredAgents = [...manifest.spec.compatibility.agents].sort();
    const registeredAgents = [...capability.compatibility].sort();
    if (declaredAgents.join(',') !== registeredAgents.join(',')) {
      throw new AppError(
        'CAPABILITY_MANIFEST_MISMATCH',
        'Manifest compatibility must match the capability metadata.',
        409,
      );
    }
    const componentTypes = manifest.spec.components.map((component) => component.type);
    const incompatibleAgents = manifest.spec.compatibility.agents.filter(
      (agent) => unsupportedComponentsForAgent(agent, componentTypes).length > 0,
    );
    if (incompatibleAgents.length) {
      throw new AppError(
        'CAPABILITY_COMPATIBILITY_INVALID',
        `Manifest contains components unsupported by: ${incompatibleAgents.join(', ')}.`,
        400,
      );
    }
    this.validateManifestPaths(manifest, files);
    const scanPolicy = await this.securityPolicies.scanPolicyForOrganization(tenant.organizationId);
    const [contentDigest, scanReport] = await Promise.all([hashPackage(files), scanPackage(files, scanPolicy)]);
    const scanStatus = scanReport.blocked ? 'blocked' : 'passed';
    return this.repository.createRevision({
      id: randomUUID(),
      organizationId: tenant.organizationId,
      spaceId: capability.spaceId,
      capabilityId,
      draftId,
      artifactId,
      contentDigest,
      manifest,
      scanStatus,
      scanReport,
      draftStatus: scanReport.blocked ? 'blocked' : 'ready',
      userId,
    });
  }

  private validateArchive(bytes: Uint8Array, slug: string): PackageFile[] {
    let files: PackageFile[];
    try {
      files = extractArchive(bytes);
    } catch (error) {
      throw new AppError('CAPABILITY_ARCHIVE_INVALID', this.safeValidationMessage(error), 400);
    }
    const paths = new Set(files.map((file) => file.path));
    if (!paths.has('capaport.yaml') || !paths.has('README.md')) {
      throw new AppError('CAPABILITY_PACKAGE_INVALID', 'Package requires capaport.yaml and README.md.', 400);
    }
    if (!slug) throw new AppError('CAPABILITY_PACKAGE_INVALID', 'Capability slug is required.', 400);
    return files;
  }

  private validateManifestPaths(manifest: CapabilityManifest, files: PackageFile[]): void {
    const paths = new Set(files.map((file) => file.path));
    for (const component of manifest.spec.components) {
      if (![...paths].some((path) => path === component.path || path.startsWith(`${component.path}/`))) {
        throw new AppError('CAPABILITY_COMPONENT_MISSING', 'A declared package component is missing.', 400);
      }
    }
    for (const entrypoint of Object.values(manifest.spec.entrypoints)) {
      if (!paths.has(entrypoint)) {
        throw new AppError('CAPABILITY_ENTRYPOINT_MISSING', 'A declared package entrypoint is missing.', 400);
      }
    }
  }

  private async authorizeCapability(
    tenant: TenantContext,
    userId: string,
    capability: CapabilityRecord,
  ): Promise<void> {
    try {
      await this.spaces.authorize(tenant, userId, capability.spaceId, 'content:view-private');
    } catch (error) {
      if (!capability.hasPublishedVersion) throw error;
      for (const spaceId of capability.publishedSpaceIds ?? []) {
        try {
          await this.spaces.authorize(tenant, userId, spaceId, 'content:view-published');
          return;
        } catch (publishedError) {
          if (!(publishedError instanceof AppError) || publishedError.code !== 'ACCESS_DENIED') throw publishedError;
        }
      }
      throw error;
    }
  }

  private async requireCapability(organizationId: string, capabilityId: string): Promise<CapabilityRecord> {
    const capability = await this.repository.findCapability(organizationId, capabilityId);
    if (!capability) this.denied();
    return capability;
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this capability.', 403);
  }

  private safeValidationMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : 'Capability package validation failed.';
  }

  private isUniqueViolation(error: unknown): boolean {
    let current = error;
    const visited = new Set<unknown>();
    while (typeof current === 'object' && current !== null && !visited.has(current)) {
      if ('code' in current && current.code === '23505') return true;
      visited.add(current);
      current = 'cause' in current ? current.cause : undefined;
    }
    return false;
  }
}
