import type { TokenPair } from '@agentdoor/contracts';
import type { WebClient, WebSessionStore } from './types';

type RequestOptions = { method?: string; body?: unknown; organizationId?: string; authenticated?: boolean };

export function createWebClient(baseUrl: string, sessionStore: WebSessionStore): WebClient {
  const api = baseUrl.replace(/\/$/, '');

  async function request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
    const session = sessionStore.get();
    const headers = new Headers({ accept: 'application/json' });
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.authenticated !== false && session) headers.set('authorization', `Bearer ${session.accessToken}`);
    const organizationId = options.organizationId ?? session?.organizationId;
    if (organizationId) headers.set('x-organization-id', organizationId);
    const response = await fetch(`${api}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status === 401 && retry && session?.refreshToken && path !== '/auth/refresh') {
      const refreshed = await request<TokenPair>(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: session.refreshToken }, authenticated: false },
        false,
      );
      sessionStore.set({ ...refreshed, ...(session.organizationId ? { organizationId: session.organizationId } : {}) });
      return request<T>(path, options, false);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as
        | { message?: string; error?: { message?: string; code?: string } }
        | undefined;
      throw new Error(payload?.message ?? payload?.error?.message ?? `请求失败 (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  const org = (organizationId: string) => ({ organizationId });
  return {
    login: (input) => request('/auth/login', { method: 'POST', body: input, authenticated: false }),
    register: (input) => request('/auth/register', { method: 'POST', body: input, authenticated: false }),
    verify: (input) => request('/auth/verify', { method: 'POST', body: input, authenticated: false }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),
    organizations: () => request('/organizations'),
    createOrganization: (input) => request('/organizations', { method: 'POST', body: input }),
    switchOrganization: async (organizationId) => {
      await request(`/organizations/${organizationId}/switch`, { method: 'POST', organizationId });
    },
    acceptInvitation: (token) => request('/organizations/invitations/accept', { method: 'POST', body: { token } }),
    updateOrganization: (organizationId, name) =>
      request(`/organizations/${organizationId}`, { method: 'PATCH', body: { name }, ...org(organizationId) }),
    members: (organizationId) => request(`/organizations/${organizationId}/members`, org(organizationId)),
    invitations: (organizationId) => request(`/organizations/${organizationId}/invitations`, org(organizationId)),
    invite: (organizationId, input) =>
      request(`/organizations/${organizationId}/invitations`, { method: 'POST', body: input, ...org(organizationId) }),
    revokeInvitation: (organizationId, invitationId) =>
      request(`/organizations/${organizationId}/invitations/${invitationId}`, {
        method: 'DELETE',
        ...org(organizationId),
      }),
    changeMemberRole: (organizationId, membershipId, role) =>
      request(`/organizations/${organizationId}/members/${membershipId}/role`, {
        method: 'PATCH',
        body: { role },
        ...org(organizationId),
      }),
    removeMember: (organizationId, membershipId) =>
      request(`/organizations/${organizationId}/members/${membershipId}`, { method: 'DELETE', ...org(organizationId) }),
    spaces: () => request('/spaces'),
    createSpace: (input) => request('/spaces', { method: 'POST', body: input }),
    updateSpacePolicy: (spaceId, reviewPolicy) =>
      request(`/spaces/${spaceId}/review-policy`, { method: 'PATCH', body: { reviewPolicy } }),
    archiveSpace: (spaceId) => request(`/spaces/${spaceId}`, { method: 'DELETE' }),
    capabilities: (query = '') => request(`/capabilities?query=${encodeURIComponent(query)}&limit=100`),
    versions: (capabilityId) => request(`/capabilities/${capabilityId}/versions`),
    transitionVersion: (capabilityId, versionId, action) =>
      request(`/capabilities/${capabilityId}/versions/${versionId}/${action}`, { method: 'POST' }),
    publications: (status) =>
      request(`/publications?limit=100${status ? `&status=${encodeURIComponent(status)}` : ''}`),
    publication: (publicationId) => request(`/publications/${publicationId}`),
    scanReport: (publicationId) => request(`/publications/${publicationId}/scan-report`),
    review: (publicationId, decision, reason) =>
      request(`/publications/${publicationId}/${decision}`, { method: 'POST', body: { reason } }),
    withdrawPublication: (publicationId) => request(`/publications/${publicationId}/withdraw`, { method: 'POST' }),
    audit: (query = {}) => {
      const params = new URLSearchParams({ limit: '50' });
      if (query.action) params.set('action', query.action);
      if (query.cursor) params.set('cursor', query.cursor);
      return request(`/audit?${params}`);
    },
    metrics: () => request('/analytics/metrics'),
    sessions: () => request('/auth/sessions'),
    revokeSession: (sessionId) => request(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
    deadLetters: () => request('/notifications/dead-letters?limit=50'),
  };
}
