import type {
  AgentId,
  ArtifactUploadPlan,
  CapabilitySummary,
  CapabilityVersionSummary,
  ErrorEnvelope,
  InstallPlan,
  OrganizationSummary,
  PublicationSummary,
  PublicUser,
  SpaceSummary,
  TenantContext,
  TokenPair,
} from '@agentdoor/contracts';
import type { CloudClient, DeviceSummary, InstallationSummary, LocalPackageExport, Session } from './types';

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
): CloudClient {
  async function request<T>(
    path: string,
    options: RequestInit & { session?: Session; organizationId?: string } = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (options.session) headers.set('authorization', `Bearer ${options.session.accessToken}`);
    if (options.organizationId) headers.set('x-organization-id', options.organizationId);
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ code: 'NETWORK_ERROR', message: '请求失败，请稍后重试' }))) as ErrorEnvelope;
      throw new CloudError(error.code, error.message, error.fieldErrors);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async function createCapabilityDraft(input: {
    session: Session;
    organizationId: string;
    spaceId: string;
    slug: string;
    agent: AgentId;
    archive: LocalPackageExport;
  }) {
    const created = await request<{ capability: CapabilitySummary; draft: { id: string } }>('/capabilities', {
      method: 'POST',
      session: input.session,
      organizationId: input.organizationId,
      body: JSON.stringify({
        spaceId: input.spaceId,
        slug: input.slug,
        name: input.slug,
        description: '',
        tags: [],
        compatibility: [input.agent],
      }),
    });
    const upload = await request<ArtifactUploadPlan>('/artifacts/uploads', {
      method: 'POST',
      session: input.session,
      organizationId: input.organizationId,
      body: JSON.stringify({
        spaceId: input.spaceId,
        fileName: input.archive.fileName,
        contentType: 'application/zip',
        sizeBytes: input.archive.sizeBytes,
        sha256: input.archive.sha256,
      }),
    });
    const uploadBytes = base64Bytes(input.archive.archiveBase64);
    const uploadResponse = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: uploadBytes.buffer as ArrayBuffer,
    });
    if (!uploadResponse.ok) throw new CloudError('ARTIFACT_UPLOAD_FAILED', '能力包上传失败，请重试');
    const artifact = await request<{ artifactId: string }>(`/artifacts/uploads/${upload.uploadId}/confirm`, {
      method: 'POST',
      session: input.session,
      organizationId: input.organizationId,
    });
    await request(`/capabilities/${created.capability.id}/drafts/${created.draft.id}/revisions`, {
      method: 'POST',
      session: input.session,
      organizationId: input.organizationId,
      body: JSON.stringify({ artifactId: artifact.artifactId }),
    });
    return { capabilityId: created.capability.id, draftId: created.draft.id };
  }

  return {
    isOnline: () => navigator.onLine,
    login: (input) => request<TokenPair>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    register: (input) => request('/auth/register', { method: 'POST', body: JSON.stringify(input) }),
    verify: (input) => request('/auth/verify', { method: 'POST', body: JSON.stringify(input) }),
    me: (session) => request<PublicUser>('/auth/me', { session }),
    organizations: (session) => request<OrganizationSummary[]>('/organizations', { session }),
    createOrganization: (session, input) =>
      request<OrganizationSummary>('/organizations', { method: 'POST', session, body: JSON.stringify(input) }),
    acceptInvitation: (session, token) =>
      request('/organizations/invitations/accept', { method: 'POST', session, body: JSON.stringify({ token }) }),
    switchOrganization: (session, organizationId) =>
      request<TenantContext>(`/organizations/${organizationId}/switch`, { method: 'POST', session }),
    spaces: (session, organizationId) => request<SpaceSummary[]>('/spaces', { session, organizationId }),
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
    submitPublication: async (input) => {
      const publication = await request<{ id: string }>(`/capabilities/${input.capabilityId}/publications`, {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ draftId: input.draftId, targetSpaceId: input.targetSpaceId, version: input.version }),
      });
      return { publicationId: publication.id };
    },
    reportInstallation: async (input) => {
      await request('/installations', {
        method: 'POST',
        session: input.session,
        organizationId: input.organizationId,
        headers: { 'idempotency-key': crypto.randomUUID() },
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
  };
}
