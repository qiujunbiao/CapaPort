import type {
  AuditEntry,
  CapabilitySummary,
  CapabilityVersionSummary,
  OrganizationRole,
  OrganizationSummary,
  PublicationSummary,
  PublicUser,
  SpaceReviewPolicy,
  SpaceSummary,
  TokenPair,
} from '@agentdoor/contracts';

export type WebSession = Omit<TokenPair, 'expiresIn'> & { expiresIn?: number; organizationId?: string };

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
};

export interface WebClient {
  login(input: { kind: 'email' | 'phone'; target: string; password: string; deviceName: string }): Promise<TokenPair>;
  register(input: {
    kind: 'email' | 'phone';
    target: string;
    password: string;
    displayName: string;
  }): Promise<{ challengeId: string; maskedTarget: string }>;
  verify(input: { challengeId: string; code: string }): Promise<{ verified: true }>;
  logout(): Promise<void>;
  me(): Promise<PublicUser>;
  organizations(): Promise<OrganizationSummary[]>;
  createOrganization(input: { name: string; slug: string }): Promise<OrganizationSummary>;
  switchOrganization(organizationId: string): Promise<void>;
  acceptInvitation(token: string): Promise<{ status: string; organizationId?: string }>;
  updateOrganization(organizationId: string, name: string): Promise<void>;
  members(organizationId: string): Promise<OrganizationMember[]>;
  invitations(organizationId: string): Promise<OrganizationInvitation[]>;
  invite(
    organizationId: string,
    input: { kind: 'email' | 'phone'; target: string; role: 'admin' | 'auditor' | 'member' },
  ): Promise<void>;
  revokeInvitation(organizationId: string, invitationId: string): Promise<void>;
  changeMemberRole(organizationId: string, membershipId: string, role: 'admin' | 'auditor' | 'member'): Promise<void>;
  removeMember(organizationId: string, membershipId: string): Promise<void>;
  spaces(): Promise<SpaceSummary[]>;
  createSpace(input: {
    type: 'team' | 'project';
    name: string;
    slug: string;
    reviewPolicy: SpaceReviewPolicy;
  }): Promise<SpaceSummary>;
  updateSpacePolicy(spaceId: string, reviewPolicy: SpaceReviewPolicy): Promise<void>;
  archiveSpace(spaceId: string): Promise<void>;
  capabilities(query?: string): Promise<CapabilitySummary[]>;
  versions(capabilityId: string): Promise<CapabilityVersionSummary[]>;
  transitionVersion(
    capabilityId: string,
    versionId: string,
    action: 'deprecate' | 'withdraw' | 'archive',
  ): Promise<void>;
  publications(status?: string): Promise<PublicationSummary[]>;
  publication(publicationId: string): Promise<PublicationSummary & { reviews?: Array<Record<string, unknown>> }>;
  scanReport(publicationId: string): Promise<Record<string, unknown>>;
  review(publicationId: string, decision: 'approve' | 'request-changes' | 'reject', reason: string): Promise<void>;
  withdrawPublication(publicationId: string): Promise<void>;
  audit(query?: { action?: string; cursor?: string }): Promise<AuditPage>;
  metrics(): Promise<AnalyticsMetrics>;
  sessions(): Promise<SessionSummary[]>;
  revokeSession(sessionId: string): Promise<void>;
  deadLetters(): Promise<Array<Record<string, unknown>>>;
}

export type WebSessionStore = {
  get(): WebSession | undefined;
  set(session: WebSession): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
};
