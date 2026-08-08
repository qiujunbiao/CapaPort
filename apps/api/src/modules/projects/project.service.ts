import { randomUUID } from 'node:crypto';
import { extractArchive } from '@agentdoor/capability-kit';
import type { TenantContext } from '@agentdoor/contracts/organizations';
import type {
  CreateProjectBindingRequest,
  ProjectBindingSummary,
  ProjectContextSummary,
  RegisterProjectContextRequest,
} from '@agentdoor/contracts/projects';
import { scanPackage } from '@agentdoor/security-scan';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import type { AuthorizationAction } from '../access/authorization.js';
import { SpaceService } from '../access/space.service.js';
import { ArtifactService } from '../capabilities/artifact.service.js';
import { SecurityPolicyService } from '../organizations/security-policy.service.js';

export type ProjectBindingRecord = ProjectBindingSummary & { userId: string };

export interface ProjectDataStore {
  findOwnedDevice(organizationId: string, userId: string, deviceId: string): Promise<boolean>;
  createBinding(input: ProjectBindingRecord): Promise<ProjectBindingRecord>;
  listBindings(organizationId: string, projectSpaceId: string, userId: string): Promise<ProjectBindingRecord[]>;
  findBinding(
    organizationId: string,
    projectSpaceId: string,
    userId: string,
    bindingId: string,
  ): Promise<ProjectBindingRecord | undefined>;
  removeBinding(organizationId: string, projectSpaceId: string, userId: string, bindingId: string): Promise<void>;
  createContext(input: ProjectContextSummary & { userId: string; scannedAt: string }): Promise<ProjectContextSummary>;
  listContexts(organizationId: string, projectSpaceId: string): Promise<ProjectContextSummary[]>;
  findContext(
    organizationId: string,
    projectSpaceId: string,
    contextId: string,
  ): Promise<ProjectContextSummary | undefined>;
}

@Injectable()
export class ProjectService {
  constructor(
    @Inject('PROJECT_DATA_STORE') private readonly store: ProjectDataStore,
    @Inject(SpaceService) private readonly spaces: SpaceService,
    @Inject(ArtifactService) private readonly artifacts: ArtifactService,
    @Inject(SecurityPolicyService)
    private readonly securityPolicies: Pick<SecurityPolicyService, 'scanPolicyForOrganization'>,
  ) {}

  private async project(
    tenant: TenantContext,
    userId: string,
    spaceId: string,
    action: AuthorizationAction = 'space:view',
  ) {
    const access = await this.spaces.authorize(tenant, userId, spaceId, action);
    if (access.space.type !== 'project' || access.space.status !== 'active') this.notFound();
    return access.space;
  }

  async createBinding(
    tenant: TenantContext,
    userId: string,
    spaceId: string,
    input: CreateProjectBindingRequest,
  ): Promise<ProjectBindingSummary> {
    await this.project(tenant, userId, spaceId, 'content:create');
    if (!(await this.store.findOwnedDevice(tenant.organizationId, userId, input.deviceId))) this.notFound();
    const now = new Date().toISOString();
    return this.store.createBinding({
      id: randomUUID(),
      organizationId: tenant.organizationId,
      projectSpaceId: spaceId,
      userId,
      deviceId: input.deviceId,
      localBindingId: input.localBindingId,
      agents: input.agents,
      status: 'active',
      createdAt: now,
    });
  }

  async listBindings(tenant: TenantContext, userId: string, spaceId: string): Promise<ProjectBindingSummary[]> {
    await this.project(tenant, userId, spaceId);
    return this.store.listBindings(tenant.organizationId, spaceId, userId);
  }

  async removeBinding(tenant: TenantContext, userId: string, spaceId: string, bindingId: string): Promise<void> {
    await this.project(tenant, userId, spaceId, 'content:create');
    const binding = await this.store.findBinding(tenant.organizationId, spaceId, userId, bindingId);
    if (!binding) this.notFound();
    await this.store.removeBinding(tenant.organizationId, spaceId, userId, bindingId);
  }

  async registerContext(
    tenant: TenantContext,
    userId: string,
    spaceId: string,
    input: RegisterProjectContextRequest,
  ): Promise<ProjectContextSummary> {
    await this.project(tenant, userId, spaceId, 'content:create');
    const binding = await this.store.findBinding(tenant.organizationId, spaceId, userId, input.bindingId);
    if (binding?.status !== 'active') this.notFound();
    if (input.agents.some((agent) => !binding.agents.includes(agent))) {
      throw new AppError('PROJECT_AGENT_NOT_BOUND', 'Context target is not enabled for this binding.', 409);
    }
    const scannedAt = new Date(input.scan.scannedAt);
    const age = Date.now() - scannedAt.getTime();
    if (!Number.isFinite(age) || age < -60_000 || age > 15 * 60_000) {
      throw new AppError('PROJECT_SCAN_STALE', 'Run the local security scan again before syncing.', 409);
    }
    const artifact = await this.artifacts.readArtifact(tenant.organizationId, input.artifactId);
    if (artifact.artifact.sha256 !== input.digest) {
      throw new AppError('PROJECT_CONTEXT_DIGEST_MISMATCH', 'Context artifact digest does not match.', 409);
    }
    let files: ReturnType<typeof extractArchive>;
    try {
      files = extractArchive(artifact.bytes);
    } catch {
      throw new AppError('PROJECT_CONTEXT_INVALID', 'Context package is invalid.', 400);
    }
    const manifestFile = files.find((file) => file.path === 'context.json');
    const contentFiles = files.filter((file) => file.path !== 'context.json');
    if (!manifestFile || contentFiles.some((file) => !file.path.startsWith('context/'))) {
      throw new AppError('PROJECT_CONTEXT_INVALID', 'Context package is invalid.', 400);
    }
    const sourceExtension =
      /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|vue|svelte|sql|sh|ps1)$/i;
    if (contentFiles.some((file) => sourceExtension.test(file.path))) {
      throw new AppError('PROJECT_SOURCE_REJECTED', 'Business source files cannot be synchronized.', 400);
    }
    const totalBytes = contentFiles.reduce((total, file) => total + file.content.byteLength, 0);
    let manifest: { selectionDigest?: string; fileCount?: number; totalBytes?: number };
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestFile.content));
    } catch {
      throw new AppError('PROJECT_CONTEXT_INVALID', 'Context package is invalid.', 400);
    }
    if (
      contentFiles.length !== input.fileCount ||
      totalBytes !== input.totalBytes ||
      manifest.fileCount !== input.fileCount ||
      manifest.totalBytes !== input.totalBytes ||
      manifest.selectionDigest !== input.selectionDigest
    ) {
      throw new AppError('PROJECT_CONTEXT_METADATA_MISMATCH', 'Context selection metadata does not match.', 409);
    }
    const scanPolicy = await this.securityPolicies.scanPolicyForOrganization(tenant.organizationId);
    const serverScan = await scanPackage(contentFiles, scanPolicy);
    const secretPattern =
      /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s]{8,})/i;
    const containsSecret = contentFiles.some((file) => secretPattern.test(new TextDecoder().decode(file.content)));
    if (serverScan.blocked || containsSecret) {
      throw new AppError('PROJECT_CONTEXT_BLOCKED', 'Sensitive content was detected during server verification.', 409);
    }
    return this.store.createContext({
      id: randomUUID(),
      organizationId: tenant.organizationId,
      projectSpaceId: spaceId,
      bindingId: binding.id,
      deviceId: binding.deviceId,
      artifactId: input.artifactId,
      userId,
      digest: input.digest,
      selectionDigest: input.selectionDigest,
      fileCount: input.fileCount,
      totalBytes: input.totalBytes,
      agents: input.agents,
      scanEngineVersion: input.scan.engineVersion,
      scannedAt: input.scan.scannedAt,
      createdAt: new Date().toISOString(),
    });
  }

  async listContexts(tenant: TenantContext, userId: string, spaceId: string) {
    await this.project(tenant, userId, spaceId);
    return this.store.listContexts(tenant.organizationId, spaceId);
  }

  async downloadContext(tenant: TenantContext, userId: string, spaceId: string, contextId: string) {
    await this.project(tenant, userId, spaceId);
    const context = await this.store.findContext(tenant.organizationId, spaceId, contextId);
    if (!context) this.notFound();
    const download = await this.artifacts.createDownload(tenant.organizationId, context.artifactId);
    return { contextId: context.id, digest: context.digest, ...download };
  }

  private notFound(): never {
    throw new AppError('PROJECT_NOT_FOUND', 'Project resource was not found.', 404);
  }
}
