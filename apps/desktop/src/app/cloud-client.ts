import type {
  AgentId,
  ArtifactUploadPlan,
  CapabilitySummary,
  CapabilityVersionDiff,
  CapabilityVersionSummary,
  InstallPlan,
  OrganizationSecurityPolicy,
  OrganizationSummary,
  ProductEvent,
  ProjectBindingSummary,
  ProjectContextSummary,
  PublicationCandidateDiff,
  PublicationSummary,
  PublicUser,
  SpaceSummary,
  TenantContext,
  TokenPair,
} from '@capaport/contracts';
import { CapaPortClient, CapaPortSdkError } from '@capaport/sdk';
import { invoke } from '@tauri-apps/api/core';
import type {
  AnalyticsMetrics,
  AuditPage,
  CloudClient,
  DeviceSummary,
  InstallationSummary,
  LocalPackageExport,
  OrganizationInvitation,
  OrganizationMember,
  Session,
  SessionStore,
  SessionSummary,
  SpaceMember,
} from './types';

export class CloudError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

function base64Bytes(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

type NativeHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}

async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  if (init?.body !== undefined && typeof init.body !== 'string') {
    throw new TypeError('The native CapaPort API bridge only accepts text request bodies.');
  }
  const response = await invoke<NativeHttpResponse>('api_request', {
    request: {
      url,
      method: init?.method ?? 'GET',
      headers,
      ...(init?.body === undefined ? {} : { body: init.body }),
    },
  });
  return new Response(response.body || null, {
    status: response.status,
    headers: response.headers,
  });
}

export function createCloudClient(
  baseUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3210/api/v1',
  sessionStore?: SessionStore,
): CloudClient {
  const sdk = new CapaPortClient({
    baseUrl,
    ...(isTauriRuntime() ? { fetch: nativeFetch } : {}),
    ...(sessionStore
      ? {
          session: sessionStore.get,
          saveSession: (session) => sessionStore.set(session),
        }
      : {}),
  });

  async function request<T>(
    path: string,
    options: RequestInit & { session?: Session; organizationId?: string } = {},
  ): Promise<T> {
    const { session, organizationId, method, body, headers } = options;
    const requestHeaders = new Headers(headers);
    if (body !== undefined && !requestHeaders.has('content-type'))
      requestHeaders.set('content-type', 'application/json');
    try {
      return await sdk.request<T>(path, {
        ...(method ? { method } : {}),
        ...(body === undefined ? {} : { body }),
        ...(Array.from(requestHeaders).length ? { headers: requestHeaders } : {}),
        ...(session ? { session } : { authenticated: false }),
        ...(organizationId ? { organizationId } : {}),
      });
    } catch (error) {
      if (error instanceof CapaPortSdkError) throw new CloudError(error.code, error.message, error.fieldErrors);
      throw error;
    }
  }

  async function createCapabilityDraft(input: {
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
  }) {
    let created: { capability: CapabilitySummary; draft: { id: string } };
    try {
      created = await request('/capabilities', {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        body: JSON.stringify({
          spaceId: input.spaceId,
          slug: input.slug,
          name: input.name ?? input.slug,
          description: input.description ?? '',
          tags: input.tags ?? [],
          compatibility: input.agents ?? [input.agent],
        }),
      });
    } catch (error) {
      if (!(error instanceof CloudError) || error.code !== 'CAPABILITY_SLUG_EXISTS') throw error;
      const matches = await request<CapabilitySummary[]>(
        `/capabilities?query=${encodeURIComponent(input.slug)}&limit=100`,
        { session: input.session, organizationId: input.organizationId },
      );
      const capability = matches.find(
        (candidate) => candidate.slug === input.slug && candidate.spaceId === input.spaceId,
      );
      if (!capability) throw error;
      const drafts = await request<Array<{ id: string; status: string }>>(`/capabilities/${capability.id}/drafts`, {
        session: input.session,
        organizationId: input.organizationId,
      });
      const draft =
        drafts.find((candidate) => candidate.status === 'draft') ??
        (await request<{ id: string }>(`/capabilities/${capability.id}/drafts`, {
          method: 'POST',
          session: input.session,
          organizationId: input.organizationId,
        }));
      created = { capability, draft };
    }
    const revision = await saveCapabilityRevision({
      session: input.session,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      capabilityId: created.capability.id,
      draftId: created.draft.id,
      archive: input.archive,
    });
    return {
      capabilityId: created.capability.id,
      draftId: created.draft.id,
      revisionId: revision.revisionId,
      sequence: revision.sequence,
      riskFindingDigests: revision.riskFindingDigests,
    };
  }

  async function uploadArchive(
    session: Session,
    organizationId: string,
    spaceId: string,
    fileName: string,
    sha256: string,
    archiveBase64: string,
  ) {
    const bytes = base64Bytes(archiveBase64);
    const upload = await request<ArtifactUploadPlan>('/artifacts/uploads', {
      method: 'POST',
      session,
      organizationId,
      body: JSON.stringify({ spaceId, fileName, contentType: 'application/zip', sizeBytes: bytes.byteLength, sha256 }),
    });
    const response = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: bytes.buffer as ArrayBuffer,
    });
    if (!response.ok) throw new CloudError('ARTIFACT_UPLOAD_FAILED', '上下文包上传失败，请重试');
    return request<{ artifactId: string }>(`/artifacts/uploads/${upload.uploadId}/confirm`, {
      method: 'POST',
      session,
      organizationId,
    });
  }

  async function saveCapabilityRevision(input: {
    session: Session;
    organizationId: string;
    spaceId: string;
    capabilityId: string;
    draftId: string;
    archive: LocalPackageExport;
  }) {
    const artifact = await uploadArchive(
      input.session,
      input.organizationId,
      input.spaceId,
      input.archive.fileName,
      input.archive.sha256,
      input.archive.archiveBase64,
    );
    const revision = await request<{
      id: string;
      sequence: number;
      scanStatus: 'passed' | 'blocked';
      scanReport: { findings: Array<{ blocking: boolean; evidenceDigest: string }> };
    }>(`/capabilities/${input.capabilityId}/drafts/${input.draftId}/revisions`, {
      method: 'POST',
      session: input.session,
      organizationId: input.organizationId,
      body: JSON.stringify({ artifactId: artifact.artifactId }),
    });
    return {
      revisionId: revision.id,
      sequence: revision.sequence,
      blocked: revision.scanStatus === 'blocked',
      riskFindingDigests: revision.scanReport.findings
        .filter((finding) => !finding.blocking)
        .map((finding) => finding.evidenceDigest),
    };
  }

  return {
    isOnline: () => navigator.onLine,
    logout: (session) => request<void>('/auth/logout', { method: 'POST', session }),
    login: (input) => request<TokenPair>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    register: (input) => request('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
    verify: (input) => request('/auth/verify', { method: 'POST', body: JSON.stringify(input) }),
    startRecovery: (input) => request('/auth/recovery/start', { method: 'POST', body: JSON.stringify(input) }),
    completeRecovery: (input) => request('/auth/recovery/complete', { method: 'POST', body: JSON.stringify(input) }),
    me: (session) => request<PublicUser>('/auth/me', { session }),
    organizations: (session) => request<OrganizationSummary[]>('/organizations', { session }),
    createOrganization: (session, input) =>
      request<OrganizationSummary>('/organizations', { method: 'POST', session, body: JSON.stringify(input) }),
    updateOrganization: (session, organizationId, input) =>
      request<void>(`/organizations/${organizationId}`, {
        method: 'PATCH',
        session,
        organizationId,
        body: JSON.stringify(input),
      }),
    acceptInvitation: (session, token) =>
      request('/organizations/invitations/accept', { method: 'POST', session, body: JSON.stringify({ token }) }),
    switchOrganization: (session, organizationId) =>
      request<TenantContext>(`/organizations/${organizationId}/switch`, { method: 'POST', session }),
    spaces: (session, organizationId) => request<SpaceSummary[]>('/spaces', { session, organizationId }),
    securityPolicy: (session, organizationId) =>
      request<OrganizationSecurityPolicy>(`/organizations/${organizationId}/security-policy`, {
        session,
        organizationId,
      }),
    recordAnalyticsEvent: (session, organizationId, event: ProductEvent) =>
      request<void>('/analytics/events', {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify(event),
      }),
    capabilities: (session, organizationId, query = '') =>
      request<CapabilitySummary[]>(`/capabilities?query=${encodeURIComponent(query)}&limit=100`, {
        session,
        organizationId,
      }),
    publications: (session, organizationId) =>
      request<PublicationSummary[]>('/publications?limit=100', { session, organizationId }),
    reviewPublication: (session, organizationId, publicationId, decision, reason) =>
      request<PublicationSummary>(`/publications/${publicationId}/${decision}`, {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify({ reason }),
      }),
    publicationDetails: (session, organizationId, publicationId) =>
      request<PublicationSummary & { reviews?: Array<Record<string, unknown>> }>(`/publications/${publicationId}`, {
        session,
        organizationId,
      }),
    scanReport: (session, organizationId, publicationId) =>
      request<Record<string, unknown>>(`/publications/${publicationId}/scan-report`, { session, organizationId }),
    publicationDiff: (session, organizationId, publicationId) =>
      request<PublicationCandidateDiff>(`/publications/${publicationId}/diff`, { session, organizationId }),
    withdrawPublication: (session, organizationId, publicationId) =>
      request<void>(`/publications/${publicationId}/withdraw`, { method: 'POST', session, organizationId }),
    updateCapability: (session, organizationId, capabilityId, input) =>
      request<CapabilitySummary>(`/capabilities/${capabilityId}`, {
        method: 'PATCH',
        session,
        organizationId,
        body: JSON.stringify(input),
      }),
    versionDiff: (session, organizationId, capabilityId, versionId, againstVersionId) =>
      request<CapabilityVersionDiff>(
        `/capabilities/${capabilityId}/versions/${versionId}/diff?against=${encodeURIComponent(againstVersionId)}`,
        { session, organizationId },
      ),
    transitionVersion: (session, organizationId, capabilityId, versionId, action) =>
      request<void>(`/capabilities/${capabilityId}/versions/${versionId}/${action}`, {
        method: 'POST',
        session,
        organizationId,
      }),
    members: (session, organizationId) =>
      request<OrganizationMember[]>(`/organizations/${organizationId}/members`, { session, organizationId }),
    invitations: (session, organizationId) =>
      request<OrganizationInvitation[]>(`/organizations/${organizationId}/invitations`, { session, organizationId }),
    invite: (session, organizationId, input) =>
      request<void>(`/organizations/${organizationId}/invitations`, {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify(input),
      }),
    revokeInvitation: (session, organizationId, invitationId) =>
      request<void>(`/organizations/${organizationId}/invitations/${invitationId}`, {
        method: 'DELETE',
        session,
        organizationId,
      }),
    changeMemberRole: (session, organizationId, membershipId, role) =>
      request<void>(`/organizations/${organizationId}/members/${membershipId}/role`, {
        method: 'PATCH',
        session,
        organizationId,
        body: JSON.stringify({ role }),
      }),
    removeMember: (session, organizationId, membershipId) =>
      request<void>(`/organizations/${organizationId}/members/${membershipId}`, {
        method: 'DELETE',
        session,
        organizationId,
      }),
    createSpace: (session, organizationId, input) =>
      request<SpaceSummary>('/spaces', {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify(input),
      }),
    updateSpacePolicy: (session, organizationId, spaceId, reviewPolicy) =>
      request<void>(`/spaces/${spaceId}/review-policy`, {
        method: 'PATCH',
        session,
        organizationId,
        body: JSON.stringify({ reviewPolicy }),
      }),
    archiveSpace: (session, organizationId, spaceId) =>
      request<void>(`/spaces/${spaceId}`, { method: 'DELETE', session, organizationId }),
    spaceMembers: (session, organizationId, spaceId) =>
      request<SpaceMember[]>(`/spaces/${spaceId}/members`, { session, organizationId }),
    addSpaceMember: (session, organizationId, spaceId, userId, role) =>
      request<void>(`/spaces/${spaceId}/members`, {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify({ userId, role }),
      }),
    changeSpaceMemberRole: (session, organizationId, spaceId, membershipId, role) =>
      request<void>(`/spaces/${spaceId}/members/${membershipId}`, {
        method: 'PATCH',
        session,
        organizationId,
        body: JSON.stringify({ role }),
      }),
    removeSpaceMember: (session, organizationId, spaceId, membershipId) =>
      request<void>(`/spaces/${spaceId}/members/${membershipId}`, {
        method: 'DELETE',
        session,
        organizationId,
      }),
    updateSecurityPolicy: (session, organizationId, policy) =>
      request<OrganizationSecurityPolicy>(`/organizations/${organizationId}/security-policy`, {
        method: 'PATCH',
        session,
        organizationId,
        body: JSON.stringify(policy),
      }),
    audit: (session, organizationId, query = {}) => {
      const params = new URLSearchParams({ limit: '50' });
      if (query.action) params.set('action', query.action);
      if (query.cursor) params.set('cursor', query.cursor);
      return request<AuditPage>(`/audit?${params}`, { session, organizationId });
    },
    metrics: (session, organizationId) => request<AnalyticsMetrics>('/analytics/metrics', { session, organizationId }),
    sessions: (session) => request<SessionSummary[]>('/auth/sessions', { session }),
    revokeSession: (session, sessionId) => request<void>(`/auth/sessions/${sessionId}`, { method: 'DELETE', session }),
    deadLetters: (session, organizationId) =>
      request<Array<Record<string, unknown>>>('/notifications/dead-letters?limit=50', { session, organizationId }),
    retryDeadLetter: (session, organizationId, kind, jobId) =>
      request<void>(`/notifications/dead-letters/${kind}/${jobId}/retry`, {
        method: 'POST',
        session,
        organizationId,
      }),
    exportOrganization: (session, organizationId) =>
      request<Record<string, unknown>>(`/organizations/${organizationId}/export`, { session, organizationId }),
    closeOrganization: (session, organizationId, confirmation) =>
      request<OrganizationSummary>(`/organizations/${organizationId}/closure`, {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify({ confirmation }),
      }),
    cancelOrganizationClosure: (session, organizationId) =>
      request<OrganizationSummary>(`/organizations/${organizationId}/closure`, {
        method: 'DELETE',
        session,
        organizationId,
      }),
    transferOwnership: (session, organizationId, membershipId) =>
      request<void>(`/organizations/${organizationId}/owner/transfer`, {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify({ membershipId }),
      }),
    leaveOrganization: (session, organizationId) =>
      request<void>(`/organizations/${organizationId}/leave`, { method: 'POST', session, organizationId }),
    exportAccount: (session) => request<Record<string, unknown>>('/auth/me/export', { session }),
    requestAccountDeletion: (session) =>
      request<{ deletionScheduledAt: string }>('/auth/me/deletion', { method: 'POST', session }),
    cancelAccountDeletion: (session) =>
      request<{ cancelled: true }>('/auth/me/deletion', { method: 'DELETE', session }),
    accountDeletionStatus: (session) =>
      request<{ status: string; deletionScheduledAt?: string }>('/auth/me/deletion', { session }),
    installations: (session, organizationId) =>
      request<InstallationSummary[]>('/installations', { session, organizationId }),
    updateCheck: (session, organizationId, installationId) =>
      request(`/installations/${installationId}/update-check`, { session, organizationId }),
    devices: (session, organizationId) => request<DeviceSummary[]>('/devices', { session, organizationId }),
    registerDevice: (session, organizationId, supportedAgents) =>
      request<DeviceSummary>('/devices', {
        method: 'POST',
        session,
        organizationId,
        body: JSON.stringify({
          name: navigator.userAgent.includes('Windows') ? 'CapaPort Windows' : 'CapaPort Mac',
          platform: navigator.userAgent.includes('Windows') ? 'windows' : 'macos',
          appVersion: '0.1.0',
          supportedAgents,
        }),
      }),
    notifications: (session, organizationId) => request('/notifications?limit=20', { session, organizationId }),
    markNotificationRead: (session, organizationId, notificationId) =>
      request(`/notifications/${notificationId}/read`, { method: 'PATCH', session, organizationId }),
    versions: (session, organizationId, capabilityId) =>
      request<CapabilityVersionSummary[]>(`/capabilities/${capabilityId}/versions`, { session, organizationId }),
    createInstallPlan: (input) =>
      request<InstallPlan>('/distribution/install-plans', {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        body: JSON.stringify({
          deviceId: input.deviceId,
          capabilityId: input.capabilityId,
          versionId: input.versionId,
          agent: input.agent,
        }),
      }),
    createCapabilityDraft,
    createCapabilityRevisionDraft: (session, organizationId, capabilityId) =>
      request(`/capabilities/${capabilityId}/drafts`, { method: 'POST', session, organizationId }),
    saveCapabilityRevision,
    capabilityDrafts: (session, organizationId, capabilityId) =>
      request(`/capabilities/${capabilityId}/drafts`, { session, organizationId }),
    draftRevisions: async (session, organizationId, capabilityId, draftId) => {
      const revisions = await request<
        Array<{
          id: string;
          sequence: number;
          contentDigest: string;
          scanStatus: 'passed' | 'blocked';
          scanReport: { findings: Array<{ blocking: boolean; evidenceDigest: string }> };
          createdAt: string;
        }>
      >(`/capabilities/${capabilityId}/drafts/${draftId}/revisions`, { session, organizationId });
      return revisions.map((revision) => ({
        id: revision.id,
        sequence: revision.sequence,
        contentDigest: revision.contentDigest,
        scanStatus: revision.scanStatus,
        riskFindingDigests: revision.scanReport.findings
          .filter((finding) => !finding.blocking)
          .map((finding) => finding.evidenceDigest),
        createdAt: revision.createdAt,
      }));
    },
    downloadDraftRevision: async (session, organizationId, capabilityId, draftId, revisionId) => {
      const download = await request<{ url: string }>(
        `/capabilities/${capabilityId}/drafts/${draftId}/revisions/${revisionId}/download`,
        { session, organizationId },
      );
      const response = await fetch(download.url);
      if (!response.ok) throw new CloudError('ARTIFACT_DOWNLOAD_FAILED', '草稿修订下载失败，请重试');
      return new Uint8Array(await response.arrayBuffer());
    },
    submitPublication: async (input) => {
      const publication = await request<{ id: string }>(`/capabilities/${input.capabilityId}/publications`, {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        headers: { 'idempotency-key': input.idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({
          draftId: input.draftId,
          targetSpaceId: input.targetSpaceId,
          version: input.version,
          ...(input.riskAcceptance ? { riskAcceptance: input.riskAcceptance } : {}),
        }),
      });
      return { publicationId: publication.id };
    },
    reportInstallation: async (input) => {
      await request('/installations', {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        headers: { 'idempotency-key': input.idempotencyKey ?? crypto.randomUUID() },
        body: JSON.stringify({
          deviceId: input.deviceId,
          capabilityId: input.capabilityId,
          versionId: input.versionId,
          agent: input.agent,
          outcome: input.outcome,
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
        }),
      });
    },
    createProjectBinding: (input) =>
      request<ProjectBindingSummary>(`/projects/${input.spaceId}/bindings`, {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        body: JSON.stringify({
          deviceId: input.deviceId,
          localBindingId: input.localBindingId,
          agents: input.agents,
        }),
      }),
    projectBindings: (session, organizationId, spaceId) =>
      request<ProjectBindingSummary[]>(`/projects/${spaceId}/bindings`, { session, organizationId }),
    removeProjectBinding: (session, organizationId, spaceId, bindingId) =>
      request<void>(`/projects/${spaceId}/bindings/${bindingId}`, {
        method: 'DELETE',
        session,
        organizationId,
      }),
    syncProjectContext: async (input) => {
      const artifact = await uploadArchive(
        input.session,
        input.organizationId,
        input.spaceId,
        `project-context-${input.context.selectionDigest.slice(0, 12)}.zip`,
        input.context.digest,
        input.context.archiveBase64,
      );
      return request<ProjectContextSummary>(`/projects/${input.spaceId}/contexts`, {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        body: JSON.stringify({
          bindingId: input.bindingId,
          artifactId: artifact.artifactId,
          digest: input.context.digest,
          selectionDigest: input.context.selectionDigest,
          fileCount: input.context.fileCount,
          totalBytes: input.context.totalBytes,
          agents: input.context.agents,
          scan: {
            status: 'passed',
            engineVersion: input.context.scanEngineVersion,
            scannedAt: input.context.scannedAt,
          },
        }),
      });
    },
  };
}
