import { randomUUID } from 'node:crypto';
import type { CapabilityManifest } from '@agentdoor/capability-kit';
import type { AgentId } from '@agentdoor/contracts/capabilities';
import type {
  CreateInstallPlanRequest,
  RegisterDeviceRequest,
  ReportInstallationRequest,
  UpdateDeviceRequest,
} from '@agentdoor/contracts/distribution';
import type { TenantContext } from '@agentdoor/contracts/organizations';
import type { VersionStatus } from '@agentdoor/contracts/publications';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../platform/errors/app-error.js';
import { StorageService } from '../../platform/storage/storage.service.js';
import { SpaceService } from '../access/space.service.js';

export type DeviceRecord = {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  platform: 'macos' | 'windows' | 'linux';
  appVersion: string;
  supportedAgents: readonly AgentId[];
  status: 'active' | 'revoked';
  lastSeenAt: Date;
};

export type DistributionVersionRecord = {
  id: string;
  organizationId: string;
  capabilityId: string;
  spaceId: string;
  version: string;
  artifactId: string;
  objectKey: string;
  contentDigest: string;
  manifest: CapabilityManifest;
  status: VersionStatus;
  publishedAt?: Date;
};

export type InstallationRecord = {
  id: string;
  organizationId: string;
  userId: string;
  deviceId: string;
  capabilityId: string;
  versionId: string;
  agent: AgentId;
  status: 'installed' | 'failed' | 'uninstalled';
  failureCode?: string;
  installedAt?: Date;
  updatedAt: Date;
};

export interface DistributionDataStore {
  registerDevice(input: DeviceRecord): Promise<DeviceRecord>;
  listDevices(organizationId: string, userId: string): Promise<DeviceRecord[]>;
  findDevice(organizationId: string, userId: string, deviceId: string): Promise<DeviceRecord | undefined>;
  updateDevice(
    organizationId: string,
    userId: string,
    deviceId: string,
    input: UpdateDeviceRequest,
  ): Promise<DeviceRecord>;
  revokeDevice(organizationId: string, userId: string, deviceId: string): Promise<void>;
  findVersion(organizationId: string, versionId: string): Promise<DistributionVersionRecord | undefined>;
  listVersions(organizationId: string, capabilityId: string, spaceId: string): Promise<DistributionVersionRecord[]>;
  recordDownloadPlan(input: {
    organizationId: string;
    userId: string;
    deviceId: string;
    capabilityId: string;
    versionId: string;
    agent: AgentId;
    expiresIn: number;
  }): Promise<void>;
  reportInstallation(input: {
    installationId: string;
    organizationId: string;
    userId: string;
    idempotencyKey: string;
    deviceId: string;
    capabilityId: string;
    versionId: string;
    versionSpaceId: string;
    digest: string;
    agent: AgentId;
    outcome: 'installed' | 'failed' | 'uninstalled';
    failureCode?: string;
  }): Promise<InstallationRecord>;
  findInstallation(
    organizationId: string,
    userId: string,
    installationId: string,
  ): Promise<InstallationRecord | undefined>;
  listInstallations(organizationId: string, userId: string): Promise<InstallationRecord[]>;
}

export interface DistributionObjectStore {
  createDownloadUrl(objectKey: string, expiresIn: number): Promise<string>;
}

@Injectable()
export class DistributionService {
  constructor(
    @Inject('DISTRIBUTION_DATA_STORE') private readonly repository: DistributionDataStore,
    @Inject(SpaceService) private readonly spaces: Pick<SpaceService, 'authorize'>,
    @Inject(StorageService) private readonly storage: DistributionObjectStore,
  ) {}

  registerDevice(tenant: TenantContext, userId: string, input: RegisterDeviceRequest): Promise<DeviceRecord> {
    return this.repository.registerDevice({
      id: randomUUID(),
      organizationId: tenant.organizationId,
      userId,
      name: input.name,
      platform: input.platform,
      appVersion: input.appVersion,
      supportedAgents: [...new Set(input.supportedAgents)],
      status: 'active',
      lastSeenAt: new Date(),
    });
  }

  listDevices(tenant: TenantContext, userId: string): Promise<DeviceRecord[]> {
    return this.repository.listDevices(tenant.organizationId, userId);
  }

  async updateDevice(
    tenant: TenantContext,
    userId: string,
    deviceId: string,
    input: UpdateDeviceRequest,
  ): Promise<DeviceRecord> {
    await this.requireDevice(tenant.organizationId, userId, deviceId);
    return this.repository.updateDevice(tenant.organizationId, userId, deviceId, input);
  }

  async revokeDevice(tenant: TenantContext, userId: string, deviceId: string): Promise<void> {
    await this.requireDevice(tenant.organizationId, userId, deviceId);
    await this.repository.revokeDevice(tenant.organizationId, userId, deviceId);
  }

  async installPlan(tenant: TenantContext, userId: string, input: CreateInstallPlanRequest) {
    const [device, version] = await Promise.all([
      this.requireDevice(tenant.organizationId, userId, input.deviceId),
      this.requireVersion(tenant.organizationId, input.capabilityId, input.versionId),
    ]);
    if (device.status !== 'active') this.denied();
    if (version.status !== 'published' && version.status !== 'deprecated') {
      throw new AppError('DISTRIBUTION_UNAVAILABLE', 'Capability version is unavailable.', 404);
    }
    await this.spaces.authorize(tenant, userId, version.spaceId, 'content:install');
    this.requireCompatibility(device, version, input.agent);
    const expiresIn = 120;
    const url = await this.storage.createDownloadUrl(version.objectKey, expiresIn);
    await this.repository.recordDownloadPlan({
      organizationId: tenant.organizationId,
      userId,
      deviceId: device.id,
      capabilityId: version.capabilityId,
      versionId: version.id,
      agent: input.agent,
      expiresIn,
    });
    return {
      capabilityId: version.capabilityId,
      versionId: version.id,
      version: version.version,
      digest: version.contentDigest,
      adapter: input.agent,
      permissions: version.manifest.spec.permissions,
      download: { url, expiresIn },
    };
  }

  listInstallations(tenant: TenantContext, userId: string): Promise<InstallationRecord[]> {
    return this.repository.listInstallations(tenant.organizationId, userId);
  }

  async report(
    tenant: TenantContext,
    userId: string,
    idempotencyKey: string,
    input: ReportInstallationRequest,
  ): Promise<InstallationRecord> {
    this.requireIdempotencyKey(idempotencyKey);
    const [device, version] = await Promise.all([
      this.requireDevice(tenant.organizationId, userId, input.deviceId),
      this.requireVersion(tenant.organizationId, input.capabilityId, input.versionId),
    ]);
    await this.spaces.authorize(tenant, userId, version.spaceId, 'content:install');
    if (input.outcome === 'installed') {
      if (version.status !== 'published' && version.status !== 'deprecated') {
        throw new AppError('DISTRIBUTION_UNAVAILABLE', 'Capability version is unavailable.', 404);
      }
      this.requireCompatibility(device, version, input.agent);
    }
    return this.repository.reportInstallation({
      installationId: randomUUID(),
      organizationId: tenant.organizationId,
      userId,
      idempotencyKey,
      deviceId: input.deviceId,
      capabilityId: input.capabilityId,
      versionId: input.versionId,
      versionSpaceId: version.spaceId,
      digest: version.contentDigest,
      agent: input.agent,
      outcome: input.outcome,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    });
  }

  async updateCheck(tenant: TenantContext, userId: string, installationId: string) {
    const installation = await this.repository.findInstallation(tenant.organizationId, userId, installationId);
    if (!installation) this.denied();
    await this.requireDevice(tenant.organizationId, userId, installation.deviceId);
    const current = await this.requireVersion(tenant.organizationId, installation.capabilityId, installation.versionId);
    await this.spaces.authorize(tenant, userId, current.spaceId, 'content:install');
    if (current.status === 'withdrawn' || current.status === 'archived') {
      return { action: 'remove' as const, currentVersionId: current.id, reason: current.status };
    }
    const versions = await this.repository.listVersions(tenant.organizationId, current.capabilityId, current.spaceId);
    const latest = versions
      .filter((candidate) => candidate.status === 'published' || candidate.status === 'deprecated')
      .filter((candidate) => candidate.manifest.spec.compatibility.agents.includes(installation.agent))
      .sort((left, right) => this.compareVersions(right.version, left.version))[0];
    if (latest && this.compareVersions(latest.version, current.version) > 0) {
      return {
        action: 'update' as const,
        currentVersionId: current.id,
        availableVersionId: latest.id,
        availableVersion: latest.version,
      };
    }
    return { action: 'none' as const, currentVersionId: current.id };
  }

  private async requireDevice(organizationId: string, userId: string, deviceId: string): Promise<DeviceRecord> {
    const device = await this.repository.findDevice(organizationId, userId, deviceId);
    if (!device) this.denied();
    return device;
  }

  private async requireVersion(
    organizationId: string,
    capabilityId: string,
    versionId: string,
  ): Promise<DistributionVersionRecord> {
    const version = await this.repository.findVersion(organizationId, versionId);
    if (!version || version.capabilityId !== capabilityId) this.denied();
    return version;
  }

  private requireCompatibility(device: DeviceRecord, version: DistributionVersionRecord, agent: AgentId): void {
    if (!device.supportedAgents.includes(agent) || !version.manifest.spec.compatibility.agents.includes(agent)) {
      throw new AppError('DISTRIBUTION_INCOMPATIBLE', 'The selected Agent is not compatible.', 409);
    }
  }

  private compareVersions(left: string, right: string): number {
    const parse = (value: string) => {
      const [core = '0.0.0'] = value.split('-');
      return core.split('.').map(Number);
    };
    const leftParts = parse(left);
    const rightParts = parse(right);
    for (let index = 0; index < 3; index += 1) {
      const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
      if (delta !== 0) return delta;
    }
    return left.includes('-') === right.includes('-') ? left.localeCompare(right) : left.includes('-') ? -1 : 1;
  }

  private requireIdempotencyKey(value: string): void {
    if (value.trim().length < 8 || value.length > 200) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'A stable Idempotency-Key is required.', 400);
    }
  }

  private denied(): never {
    throw new AppError('ACCESS_DENIED', 'You do not have access to this distribution resource.', 403);
  }
}
