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
import type { ProjectBindingSummary, ProjectContextSummary } from '@agentdoor/contracts/projects';
import type {
  AgentDescriptor,
  ApplyResult,
  ContextPackageExport,
  InstallLock,
  InstallPlan,
  InstallPreview,
  LocalCapabilitySummary,
  LocalProjectBinding,
  LocalScanReport,
  ProjectInventory,
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
export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};
export type NotificationPage = { notifications: NotificationItem[]; unreadCount: number; nextCursor?: string };

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
  startRecovery?(input: {
    kind: 'email' | 'phone';
    target: string;
  }): Promise<{ challengeId: string; maskedTarget: string }>;
  completeRecovery?(input: { challengeId: string; code: string; newPassword: string }): Promise<{ recovered: true }>;
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
  notifications?(session: Session, organizationId: string): Promise<NotificationPage>;
  markNotificationRead?(session: Session, organizationId: string, notificationId: string): Promise<void>;
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
  }): Promise<{ capabilityId: string; draftId: string; riskFindingDigests: string[] }>;
  submitPublication(input: {
    session: Session;
    organizationId: string;
    capabilityId: string;
    draftId: string;
    targetSpaceId: string;
    version: string;
    riskAcceptance?: { findingDigests: string[]; reason: string };
  }): Promise<{ publicationId: string }>;
  reportInstallation(input: {
    session: Session;
    organizationId: string;
    deviceId: string;
    capabilityId: string;
    versionId: string;
    agent: AgentId;
    outcome: 'installed' | 'failed' | 'uninstalled';
    failureCode?: string;
  }): Promise<void>;
  createProjectBinding(input: {
    session: Session;
    organizationId: string;
    spaceId: string;
    deviceId: string;
    localBindingId: string;
    agents: AgentId[];
  }): Promise<ProjectBindingSummary>;
  projectBindings(session: Session, organizationId: string, spaceId: string): Promise<ProjectBindingSummary[]>;
  removeProjectBinding?(session: Session, organizationId: string, spaceId: string, bindingId: string): Promise<void>;
  syncProjectContext(input: {
    session: Session;
    organizationId: string;
    spaceId: string;
    bindingId: string;
    context: ContextPackageExport;
  }): Promise<ProjectContextSummary>;
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
  loadInstallLock(input: {
    adapterId: string;
    capabilitySlug: string;
    rootPath: string;
  }): Promise<InstallLock | undefined>;
  uninstall(input: { adapterId: string; capabilitySlug: string; rootPath: string }): Promise<ApplyResult>;
  bindProjectDirectory(input: { spaceId: string; path: string; agents?: AgentId[] }): Promise<LocalProjectBinding>;
  listProjectBindings(spaceId: string): Promise<LocalProjectBinding[]>;
  removeProjectBinding(localBindingId: string): Promise<void>;
  inventoryProjectContext(localBindingId: string): Promise<ProjectInventory>;
  exportProjectContext(input: {
    localBindingId: string;
    selectedPaths: string[];
    agents: AgentId[];
  }): Promise<ContextPackageExport>;
  projectContextPlan(input: {
    localBindingId: string;
    selectedPaths: string[];
    adapterId: AgentId;
    rootPath: string;
  }): Promise<InstallPlan>;
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
