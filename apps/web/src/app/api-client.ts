import { AgentdoorClient } from '@agentdoor/sdk';
import type { WebClient, WebSessionStore } from './types';

type RequestOptions = {
  method?: string;
  body?: unknown;
  organizationId?: string;
  authenticated?: boolean;
  idempotencyKey?: string;
};

export function createWebClient(baseUrl: string, sessionStore: WebSessionStore): WebClient {
  const api = baseUrl.replace(/\/$/, '');
  const sdk = new AgentdoorClient({
    baseUrl: api,
    session: () => sessionStore.get(),
    saveSession: (session) => sessionStore.set(session),
  });

  function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return sdk.request<T>(path, options);
  }

  const org = (organizationId: string) => ({ organizationId });
  return {
    login: (input) => request('/auth/login', { method: 'POST', body: input, authenticated: false }),
    register: (input) => request('/auth/register', { method: 'POST', body: input, authenticated: false }),
    verify: (input) => request('/auth/verify', { method: 'POST', body: input, authenticated: false }),
    startRecovery: (input) => request('/auth/recovery/start', { method: 'POST', body: input, authenticated: false }),
    completeRecovery: (input) =>
      request('/auth/recovery/complete', { method: 'POST', body: input, authenticated: false }),
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
    leaveOrganization: (organizationId) =>
      request(`/organizations/${organizationId}/leave`, { method: 'POST', ...org(organizationId) }),
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
    spaceMembers: (spaceId) => request(`/spaces/${spaceId}/members`),
    addSpaceMember: (spaceId, userId, role) =>
      request(`/spaces/${spaceId}/members`, { method: 'POST', body: { userId, role } }),
    changeSpaceMemberRole: (spaceId, membershipId, role) =>
      request(`/spaces/${spaceId}/members/${membershipId}`, { method: 'PATCH', body: { role } }),
    removeSpaceMember: (spaceId, membershipId) =>
      request(`/spaces/${spaceId}/members/${membershipId}`, { method: 'DELETE' }),
    capabilities: (query = '') => request(`/capabilities?query=${encodeURIComponent(query)}&limit=100`),
    updateCapability: (capabilityId, input) =>
      request(`/capabilities/${capabilityId}`, { method: 'PATCH', body: input }),
    versions: (capabilityId) => request(`/capabilities/${capabilityId}/versions`),
    versionDiff: (capabilityId, versionId, againstVersionId) =>
      request(
        `/capabilities/${capabilityId}/versions/${versionId}/diff?against=${encodeURIComponent(againstVersionId)}`,
      ),
    transitionVersion: (capabilityId, versionId, action) =>
      request(`/capabilities/${capabilityId}/versions/${versionId}/${action}`, { method: 'POST' }),
    publications: (status) =>
      request(`/publications?limit=100${status ? `&status=${encodeURIComponent(status)}` : ''}`),
    publication: (publicationId) => request(`/publications/${publicationId}`),
    scanReport: (publicationId) => request(`/publications/${publicationId}/scan-report`),
    publicationDiff: (publicationId) => request(`/publications/${publicationId}/diff`),
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
    notifications: () => request('/notifications?limit=20'),
    markNotificationRead: (notificationId) => request(`/notifications/${notificationId}/read`, { method: 'PATCH' }),
    deadLetters: () => request('/notifications/dead-letters?limit=50'),
  };
}
