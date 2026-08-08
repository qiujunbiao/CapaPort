import type {
  AgentId,
  ArtifactUploadPlan,
  CapabilitySummary,
  CapabilityVersionSummary,
  InstallPlan,
  OrganizationSummary,
  OrganizationSecurityPolicy,
  ProjectBindingSummary,
  ProjectContextSummary,
  ProductEvent,
  PublicationSummary,
  PublicUser,
  SpaceSummary,
  TenantContext,
  TokenPair,
} from '@agentdoor/contracts';
import { AgentdoorClient, AgentdoorSdkError } from '@agentdoor/sdk';
import type {
  CloudClient,
  DeviceSummary,
  InstallationSummary,
  LocalPackageExport,
  Session,
  SessionStore,
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

export function createCloudClient(
  baseUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3210/api/v1',
  sessionStore?: SessionStore,
): CloudClient {
  const sdk = new AgentdoorClient({
    baseUrl,
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
    try {
      return await sdk.request<T>(path, {
        ...(method ? { method } : {}),
        ...(body === undefined ? {} : { body }),
        ...(headers ? { headers } : {}),
        ...(session ? { session } : { authenticated: false }),
        ...(organizationId ? { organizationId } : {}),
      });
    } catch (error) {
      if (error instanceof AgentdoorSdkError) throw new CloudError(error.code, error.message, error.fieldErrors);
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
    const created = await request<{ capability: CapabilitySummary; draft: { id: string } }>('/capabilities', {
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
          name: navigator.userAgent.includes('Windows') ? 'Agentdoor Windows' : 'Agentdoor Mac',
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
