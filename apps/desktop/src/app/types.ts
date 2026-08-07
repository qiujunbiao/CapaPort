import type {
  AgentId,
  CapabilitySummary,
  CapabilityVersionSummary,
  InstallPlan as CloudInstallPlan,
  OrganizationSummary,
  PublicationSummary,
  PublicUser,
  SpaceSummary,
  TenantContext,
  TokenPair,
  UpdateCheck,
} from '@agentdoor/contracts';
import type {
  AgentDescriptor,
  ApplyResult,
  InstallPlan,
  InstallPreview,
  LocalCapabilitySummary,
  LocalScanReport,
  SyncQueueStatus,
} from '../generated/commands';

export type Session = Omit<TokenPair, 'expiresIn'> & { expiresIn?: number; organizationId?: string };

export type InstallationSummary = {
  id: string;
  deviceId: string;
  capabilityId: string;
  versionId: string;
  agent: AgentId;
  status: 'installed' | 'failed' | 'uninstalled';
  updatedAt: string;
};

export type DeviceSummary = {
  id: string;
  name: string;
  platform: 'macos' | 'windows' | 'linux';
  appVersion: string;
  supportedAgents: AgentId[];
  status: 'active' | 'revoked';
};

export type LocalPackageExport = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  archiveBase64: string;
};

export type ImportLocalInput = {
  spaceId: string;
  targetSpaceId: string;
  version: string;
  adapterId: AgentId;
  rootPath: string;
  componentType: string;
  slug: string;
};

export interface CloudClient {
  isOnline(): boolean;
  login(input: { kind: 'email' | 'phone'; target: string; password: string; deviceName: string }): Promise<TokenPair>;
  register?(input: {
    kind: 'email' | 'phone';
    target: string;
    password: string;
    displayName: string;
  }): Promise<{ challengeId: string; maskedTarget: string }>;
  verify?(input: { challengeId: string; code: string }): Promise<{ verified: true }>;
  me(session: Session): Promise<PublicUser>;
  organizations(session: Session): Promise<OrganizationSummary[]>;
  createOrganization?(session: Session, input: { name: string; slug: string }): Promise<OrganizationSummary>;
  acceptInvitation?(session: Session, token: string): Promise<{ status: string; organizationId?: string }>;
  switchOrganization(session: Session, organizationId: string): Promise<TenantContext>;
  spaces(session: Session, organizationId: string): Promise<SpaceSummary[]>;
  capabilities(session: Session, organizationId: string, query?: string): Promise<CapabilitySummary[]>;
  publications(session: Session, organizationId: string): Promise<PublicationSummary[]>;
  installations(session: Session, organizationId: string): Promise<InstallationSummary[]>;
  updateCheck(session: Session, organizationId: string, installationId: string): Promise<UpdateCheck>;
  devices?(session: Session, organizationId: string): Promise<DeviceSummary[]>;
  registerDevice?(session: Session, organizationId: string, agents: AgentId[]): Promise<DeviceSummary>;
  versions?(session: Session, organizationId: string, capabilityId: string): Promise<CapabilityVersionSummary[]>;
  createInstallPlan(input: {
    session: Session;
    organizationId: string;
    deviceId: string;
    capabilityId: string;
    versionId: string;
    agent: AgentId;
  }): Promise<CloudInstallPlan>;
  createCapabilityDraft(input: {
    session: Session;
    organizationId: string;
    spaceId: string;
    slug: string;
    agent: AgentId;
    archive: LocalPackageExport;
  }): Promise<{ capabilityId: string; draftId: string }>;
  submitPublication(input: {
    session: Session;
    organizationId: string;
    capabilityId: string;
    draftId: string;
    targetSpaceId: string;
    version: string;
  }): Promise<{ publicationId: string }>;
  reportInstallation(input: {
    session: Session;
    organizationId: string;
    deviceId: string;
    capabilityId: string;
    versionId: string;
    agent: AgentId;
    outcome: 'installed' | 'failed';
    failureCode?: string;
  }): Promise<void>;
}

export interface LocalClient {
  detectAgents(): Promise<AgentDescriptor[]>;
  inventoryAgent(input: { adapterId: string; rootPath: string }): Promise<LocalCapabilitySummary[]>;
  scanLocalPackage(path: string): Promise<LocalScanReport>;
  exportLocalPackage?(input: {
    adapterId: string;
    rootPath: string;
    componentType: string;
    slug: string;
  }): Promise<LocalPackageExport>;
  previewInstall(plan: InstallPlan): Promise<InstallPreview>;
  applyInstall(plan: InstallPlan): Promise<ApplyResult>;
  rollbackInstall(transactionId: string): Promise<ApplyResult>;
  bindProjectDirectory(input: { spaceId: string; path: string }): Promise<string>;
  syncQueueStatus(): Promise<SyncQueueStatus>;
  storeSession?(session: Session): Promise<void>;
  loadSession?(): Promise<Session | undefined>;
  clearSession?(): Promise<void>;
}

export type SessionStore = {
  get(): Session | undefined;
  set(session: Session): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
};
