import type {
  AgentId,
  AuditEntry,
  CapabilitySummary,
  CapabilityVersionDiff,
  CapabilityVersionSummary,
  InstallPlan as CloudInstallPlan,
  OrganizationRole,
  OrganizationSecurityPolicy,
  OrganizationSummary,
  ProductEvent,
  PublicationCandidateDiff,
  PublicationSummary,
  PublicUser,
  SpaceReviewPolicy,
  SpaceRole,
  SpaceSummary,
  TenantContext,
  TokenPair,
  UpdateCapabilityRequest,
  UpdateCheck,
} from '@capaport/contracts';
import type { ProjectBindingSummary, ProjectContextSummary } from '@capaport/contracts/projects';
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
  LocalSkillDiscoveryResult,
  ManagedFileContent,
  ProjectInventory,
  SyncQueueStatus,
} from '../generated/commands';
import type { OfflineWrite, RescheduleInput } from './offline-queue';

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

export type OrganizationMember = {
  id: string;
  userId: string;
  displayName: string;
  role: OrganizationRole;
  status: 'active' | 'disabled' | 'left';
  joinedAt: string;
};

export type OrganizationInvitation = {
  id: string;
  kind: 'email' | 'phone';
  target: string;
  role: Exclude<OrganizationRole, 'owner'>;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type SpaceMember = {
  id: string;
  userId: string;
  displayName: string;
  role: SpaceRole;
  status: 'active' | 'disabled';
  createdAt: string;
};

export type SessionSummary = {
  id: string;
  deviceName: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
};

export type AuditPage = { entries: AuditEntry[]; nextCursor?: string };
export type AnalyticsMetrics = {
  range: { from: string; to: string };
  productEvents: Record<string, number>;
  publicationFunnel: Record<string, number>;
  installationOutcomes: Record<string, number>;
  activeDevices: number;
  daily?: Array<{ day: string; metrics: Record<string, number> }>;
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

export type CapabilityDraftSummary = {
  id: string;
  capabilityId: string;
  status: 'draft' | 'ready' | 'blocked' | 'submitted';
  currentRevisionId?: string;
};

export type DraftRevisionSummary = {
  id: string;
  sequence: number;
  contentDigest: string;
  scanStatus: 'passed' | 'blocked';
  riskFindingDigests: string[];
  createdAt: string;
};

export interface CloudClient {
  isOnline(): boolean;
  logout(session: Session): Promise<void>;
  login(input: { kind: 'email' | 'phone'; target: string; password: string; deviceName: string }): Promise<TokenPair>;
  register?(input: {
    kind: 'email' | 'phone';
    target: string;
    password: string;
    displayName: string;
  }): Promise<{ challengeId: string; maskedTarget: string; developmentCode?: string }>;
  verify?(input: { challengeId: string; code: string }): Promise<{ verified: true }>;
  startRecovery?(input: {
    kind: 'email' | 'phone';
    target: string;
  }): Promise<{ challengeId: string; maskedTarget: string; developmentCode?: string }>;
  completeRecovery?(input: { challengeId: string; code: string; newPassword: string }): Promise<{ recovered: true }>;
  me(session: Session): Promise<PublicUser>;
  organizations(session: Session): Promise<OrganizationSummary[]>;
  createOrganization?(session: Session, input: { name: string; slug?: string }): Promise<OrganizationSummary>;
  updateOrganization?(session: Session, organizationId: string, input: { name: string }): Promise<void>;
  acceptInvitation?(session: Session, token: string): Promise<{ status: string; organizationId?: string }>;
  switchOrganization(session: Session, organizationId: string): Promise<TenantContext>;
  spaces(session: Session, organizationId: string): Promise<SpaceSummary[]>;
  securityPolicy(session: Session, organizationId: string): Promise<OrganizationSecurityPolicy>;
  recordAnalyticsEvent(session: Session, organizationId: string, event: ProductEvent): Promise<void>;
  capabilities(session: Session, organizationId: string, query?: string): Promise<CapabilitySummary[]>;
  publications(session: Session, organizationId: string): Promise<PublicationSummary[]>;
  reviewPublication(
    session: Session,
    organizationId: string,
    publicationId: string,
    decision: 'approve' | 'request-changes' | 'reject',
    reason: string,
  ): Promise<PublicationSummary>;
  publicationDetails(
    session: Session,
    organizationId: string,
    publicationId: string,
  ): Promise<PublicationSummary & { reviews?: Array<Record<string, unknown>> }>;
  scanReport(session: Session, organizationId: string, publicationId: string): Promise<Record<string, unknown>>;
  publicationDiff(session: Session, organizationId: string, publicationId: string): Promise<PublicationCandidateDiff>;
  withdrawPublication(session: Session, organizationId: string, publicationId: string): Promise<void>;
  updateCapability(
    session: Session,
    organizationId: string,
    capabilityId: string,
    input: UpdateCapabilityRequest,
  ): Promise<CapabilitySummary>;
  versionDiff(
    session: Session,
    organizationId: string,
    capabilityId: string,
    versionId: string,
    againstVersionId: string,
  ): Promise<CapabilityVersionDiff>;
  transitionVersion(
    session: Session,
    organizationId: string,
    capabilityId: string,
    versionId: string,
    action: 'deprecate' | 'withdraw' | 'archive',
  ): Promise<void>;
  members(session: Session, organizationId: string): Promise<OrganizationMember[]>;
  invitations(session: Session, organizationId: string): Promise<OrganizationInvitation[]>;
  invite(
    session: Session,
    organizationId: string,
    input: { kind: 'email' | 'phone'; target: string; role: 'admin' | 'auditor' | 'member' },
  ): Promise<void>;
  revokeInvitation(session: Session, organizationId: string, invitationId: string): Promise<void>;
  changeMemberRole(
    session: Session,
    organizationId: string,
    membershipId: string,
    role: 'admin' | 'auditor' | 'member',
  ): Promise<void>;
  removeMember(session: Session, organizationId: string, membershipId: string): Promise<void>;
  createSpace(
    session: Session,
    organizationId: string,
    input: { type: 'team' | 'project'; name: string; slug?: string | undefined; reviewPolicy: SpaceReviewPolicy },
  ): Promise<SpaceSummary>;
  updateSpacePolicy(
    session: Session,
    organizationId: string,
    spaceId: string,
    reviewPolicy: SpaceReviewPolicy,
  ): Promise<void>;
  archiveSpace(session: Session, organizationId: string, spaceId: string): Promise<void>;
  spaceMembers(session: Session, organizationId: string, spaceId: string): Promise<SpaceMember[]>;
  addSpaceMember(
    session: Session,
    organizationId: string,
    spaceId: string,
    userId: string,
    role: SpaceRole,
  ): Promise<void>;
  changeSpaceMemberRole(
    session: Session,
    organizationId: string,
    spaceId: string,
    membershipId: string,
    role: SpaceRole,
  ): Promise<void>;
  removeSpaceMember(session: Session, organizationId: string, spaceId: string, membershipId: string): Promise<void>;
  updateSecurityPolicy(
    session: Session,
    organizationId: string,
    policy: OrganizationSecurityPolicy,
  ): Promise<OrganizationSecurityPolicy>;
  audit(session: Session, organizationId: string, query?: { action?: string; cursor?: string }): Promise<AuditPage>;
  metrics(session: Session, organizationId: string): Promise<AnalyticsMetrics>;
  sessions(session: Session): Promise<SessionSummary[]>;
  revokeSession(session: Session, sessionId: string): Promise<void>;
  deadLetters(session: Session, organizationId: string): Promise<Array<Record<string, unknown>>>;
  retryDeadLetter(
    session: Session,
    organizationId: string,
    kind: 'operation' | 'outbox' | 'delivery',
    jobId: string,
  ): Promise<void>;
  exportOrganization(session: Session, organizationId: string): Promise<Record<string, unknown>>;
  closeOrganization(session: Session, organizationId: string, confirmation: string): Promise<OrganizationSummary>;
  cancelOrganizationClosure(session: Session, organizationId: string): Promise<OrganizationSummary>;
  transferOwnership(session: Session, organizationId: string, membershipId: string): Promise<void>;
  leaveOrganization(session: Session, organizationId: string): Promise<void>;
  exportAccount(session: Session): Promise<Record<string, unknown>>;
  requestAccountDeletion(session: Session): Promise<{ deletionScheduledAt: string }>;
  cancelAccountDeletion(session: Session): Promise<{ cancelled: true }>;
  accountDeletionStatus(session: Session): Promise<{ status: string; deletionScheduledAt?: string }>;
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
    name?: string;
    description?: string;
    tags?: string[];
    agents?: AgentId[];
  }): Promise<{
    capabilityId: string;
    draftId: string;
    revisionId?: string;
    sequence?: number;
    riskFindingDigests: string[];
  }>;
  createCapabilityRevisionDraft(
    session: Session,
    organizationId: string,
    capabilityId: string,
  ): Promise<CapabilityDraftSummary>;
  saveCapabilityRevision(input: {
    session: Session;
    organizationId: string;
    spaceId: string;
    capabilityId: string;
    draftId: string;
    archive: LocalPackageExport;
  }): Promise<{ revisionId: string; sequence: number; blocked: boolean; riskFindingDigests: string[] }>;
  capabilityDrafts(session: Session, organizationId: string, capabilityId: string): Promise<CapabilityDraftSummary[]>;
  draftRevisions(
    session: Session,
    organizationId: string,
    capabilityId: string,
    draftId: string,
  ): Promise<DraftRevisionSummary[]>;
  downloadDraftRevision(
    session: Session,
    organizationId: string,
    capabilityId: string,
    draftId: string,
    revisionId: string,
  ): Promise<Uint8Array>;
  submitPublication(input: {
    session: Session;
    organizationId: string;
    capabilityId: string;
    draftId: string;
    targetSpaceId: string;
    version: string;
    riskAcceptance?: { findingDigests: string[]; reason: string };
    idempotencyKey?: string;
  }): Promise<{ publicationId: string; queued?: boolean }>;
  reportInstallation(input: {
    session: Session;
    organizationId: string;
    deviceId: string;
    capabilityId: string;
    versionId: string;
    agent: AgentId;
    outcome: 'installed' | 'failed' | 'uninstalled';
    failureCode?: string;
    idempotencyKey?: string;
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
  discoverLocalSkills(): Promise<LocalSkillDiscoveryResult>;
  inventoryAgent(input: { adapterId: string; rootPath: string }): Promise<LocalCapabilitySummary[]>;
  scanLocalPackage(path: string): Promise<LocalScanReport>;
  readManagedFile(input: { rootPath: string; relativePath: string }): Promise<ManagedFileContent>;
  exportLocalPackage?(input: {
    adapterId: string;
    rootPath: string;
    componentType: string;
    slug: string;
    sourcePath?: string;
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
  enqueueWrite(write: OfflineWrite & { availableAt: string }): Promise<void>;
  claimReadyWrites(now: string, limit: number): Promise<OfflineWrite[]>;
  completeWrite(id: string): Promise<void>;
  rescheduleWrite(input: RescheduleInput): Promise<void>;
  retryFailedWrites(now: string): Promise<void>;
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
