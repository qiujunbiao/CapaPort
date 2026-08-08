/** Generated from apps/api/openapi.json by scripts/generate-sdk.ts. Do not edit. */
export const apiOperations = [
  {
    method: 'POST',
    path: '/analytics/events',
    operationId: 'analytics_event',
  },
  {
    method: 'GET',
    path: '/analytics/metrics',
    operationId: 'analytics_metrics',
  },
  {
    method: 'POST',
    path: '/artifacts/uploads',
    operationId: 'artifact_requestUpload',
  },
  {
    method: 'POST',
    path: '/artifacts/uploads/{uploadId}/confirm',
    operationId: 'artifact_confirmUpload',
  },
  {
    method: 'GET',
    path: '/audit',
    operationId: 'audit_list',
  },
  {
    method: 'POST',
    path: '/auth/login',
    operationId: 'auth_login',
  },
  {
    method: 'POST',
    path: '/auth/logout',
    operationId: 'auth_logout',
  },
  {
    method: 'GET',
    path: '/auth/me',
    operationId: 'auth_me',
  },
  {
    method: 'POST',
    path: '/auth/recovery/complete',
    operationId: 'auth_completeRecovery',
  },
  {
    method: 'POST',
    path: '/auth/recovery/start',
    operationId: 'auth_startRecovery',
  },
  {
    method: 'POST',
    path: '/auth/refresh',
    operationId: 'auth_refresh',
  },
  {
    method: 'POST',
    path: '/auth/register',
    operationId: 'auth_register',
  },
  {
    method: 'GET',
    path: '/auth/sessions',
    operationId: 'auth_listSessions',
  },
  {
    method: 'DELETE',
    path: '/auth/sessions/{sessionId}',
    operationId: 'auth_revokeSession',
  },
  {
    method: 'POST',
    path: '/auth/verify',
    operationId: 'auth_verify',
  },
  {
    method: 'GET',
    path: '/capabilities',
    operationId: 'capability_search',
  },
  {
    method: 'POST',
    path: '/capabilities',
    operationId: 'capability_create',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}',
    operationId: 'capability_get',
  },
  {
    method: 'PATCH',
    path: '/capabilities/{capabilityId}',
    operationId: 'capability_update',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}/drafts',
    operationId: 'capability_drafts',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/drafts',
    operationId: 'capability_createDraft',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}/drafts/{draftId}/revisions',
    operationId: 'capability_revisions',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/drafts/{draftId}/revisions',
    operationId: 'capability_createRevision',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}/drafts/{draftId}/revisions/{revisionId}/download',
    operationId: 'capability_downloadRevision',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/promotions',
    operationId: 'version_promote',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/publications',
    operationId: 'version_submit',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}/versions',
    operationId: 'version_versions',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}/versions/{versionId}',
    operationId: 'version_version',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/versions/{versionId}/archive',
    operationId: 'version_archive',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/versions/{versionId}/deprecate',
    operationId: 'version_deprecate',
  },
  {
    method: 'GET',
    path: '/capabilities/{capabilityId}/versions/{versionId}/diff',
    operationId: 'version_diff',
  },
  {
    method: 'POST',
    path: '/capabilities/{capabilityId}/versions/{versionId}/withdraw',
    operationId: 'version_withdrawVersion',
  },
  {
    method: 'GET',
    path: '/devices',
    operationId: 'device_list',
  },
  {
    method: 'POST',
    path: '/devices',
    operationId: 'device_register',
  },
  {
    method: 'DELETE',
    path: '/devices/{deviceId}',
    operationId: 'device_revoke',
  },
  {
    method: 'PATCH',
    path: '/devices/{deviceId}',
    operationId: 'device_update',
  },
  {
    method: 'POST',
    path: '/distribution/install-plans',
    operationId: 'distribution_installPlan',
  },
  {
    method: 'GET',
    path: '/health/live',
    operationId: 'health_live',
  },
  {
    method: 'GET',
    path: '/health/ready',
    operationId: 'health_ready',
  },
  {
    method: 'GET',
    path: '/installations',
    operationId: 'installation_list',
  },
  {
    method: 'POST',
    path: '/installations',
    operationId: 'installation_report',
  },
  {
    method: 'GET',
    path: '/installations/{installationId}/update-check',
    operationId: 'installation_updateCheck',
  },
  {
    method: 'GET',
    path: '/metrics',
    operationId: 'telemetry_metrics',
  },
  {
    method: 'GET',
    path: '/notifications',
    operationId: 'notification_list',
  },
  {
    method: 'PATCH',
    path: '/notifications/{notificationId}/read',
    operationId: 'notification_markRead',
  },
  {
    method: 'GET',
    path: '/notifications/dead-letters',
    operationId: 'notification_deadLetters',
  },
  {
    method: 'POST',
    path: '/notifications/dead-letters/{kind}/{jobId}/retry',
    operationId: 'notification_retryDeadLetter',
  },
  {
    method: 'GET',
    path: '/organizations',
    operationId: 'organization_list',
  },
  {
    method: 'POST',
    path: '/organizations',
    operationId: 'organization_create',
  },
  {
    method: 'DELETE',
    path: '/organizations/{organizationId}',
    operationId: 'organization_archive',
  },
  {
    method: 'GET',
    path: '/organizations/{organizationId}',
    operationId: 'organization_get',
  },
  {
    method: 'PATCH',
    path: '/organizations/{organizationId}',
    operationId: 'organization_update',
  },
  {
    method: 'GET',
    path: '/organizations/{organizationId}/invitations',
    operationId: 'organization_invitations',
  },
  {
    method: 'POST',
    path: '/organizations/{organizationId}/invitations',
    operationId: 'organization_invite',
  },
  {
    method: 'DELETE',
    path: '/organizations/{organizationId}/invitations/{invitationId}',
    operationId: 'organization_revokeInvitation',
  },
  {
    method: 'POST',
    path: '/organizations/{organizationId}/leave',
    operationId: 'organization_leave',
  },
  {
    method: 'GET',
    path: '/organizations/{organizationId}/members',
    operationId: 'organization_members',
  },
  {
    method: 'DELETE',
    path: '/organizations/{organizationId}/members/{membershipId}',
    operationId: 'organization_removeMember',
  },
  {
    method: 'PATCH',
    path: '/organizations/{organizationId}/members/{membershipId}/role',
    operationId: 'organization_changeRole',
  },
  {
    method: 'POST',
    path: '/organizations/{organizationId}/owner/transfer',
    operationId: 'organization_transferOwnership',
  },
  {
    method: 'POST',
    path: '/organizations/{organizationId}/switch',
    operationId: 'organization_switch',
  },
  {
    method: 'POST',
    path: '/organizations/invitations/accept',
    operationId: 'organization_accept',
  },
  {
    method: 'GET',
    path: '/projects/{spaceId}/bindings',
    operationId: 'project_listBindings',
  },
  {
    method: 'POST',
    path: '/projects/{spaceId}/bindings',
    operationId: 'project_createBinding',
  },
  {
    method: 'DELETE',
    path: '/projects/{spaceId}/bindings/{bindingId}',
    operationId: 'project_removeBinding',
  },
  {
    method: 'GET',
    path: '/projects/{spaceId}/contexts',
    operationId: 'project_listContexts',
  },
  {
    method: 'POST',
    path: '/projects/{spaceId}/contexts',
    operationId: 'project_registerContext',
  },
  {
    method: 'GET',
    path: '/projects/{spaceId}/contexts/{contextId}/download',
    operationId: 'project_downloadContext',
  },
  {
    method: 'GET',
    path: '/publications',
    operationId: 'publication_list',
  },
  {
    method: 'GET',
    path: '/publications/{publicationId}',
    operationId: 'publication_get',
  },
  {
    method: 'POST',
    path: '/publications/{publicationId}/approve',
    operationId: 'publication_approve',
  },
  {
    method: 'GET',
    path: '/publications/{publicationId}/diff',
    operationId: 'publication_candidateDiff',
  },
  {
    method: 'POST',
    path: '/publications/{publicationId}/reject',
    operationId: 'publication_reject',
  },
  {
    method: 'POST',
    path: '/publications/{publicationId}/request-changes',
    operationId: 'publication_requestChanges',
  },
  {
    method: 'GET',
    path: '/publications/{publicationId}/scan-report',
    operationId: 'publication_scanReport',
  },
  {
    method: 'POST',
    path: '/publications/{publicationId}/withdraw',
    operationId: 'publication_withdraw',
  },
  {
    method: 'GET',
    path: '/spaces',
    operationId: 'space_list',
  },
  {
    method: 'POST',
    path: '/spaces',
    operationId: 'space_create',
  },
  {
    method: 'DELETE',
    path: '/spaces/{spaceId}',
    operationId: 'space_archive',
  },
  {
    method: 'GET',
    path: '/spaces/{spaceId}',
    operationId: 'space_get',
  },
  {
    method: 'PATCH',
    path: '/spaces/{spaceId}',
    operationId: 'space_update',
  },
  {
    method: 'GET',
    path: '/spaces/{spaceId}/members',
    operationId: 'space_members',
  },
  {
    method: 'POST',
    path: '/spaces/{spaceId}/members',
    operationId: 'space_addMember',
  },
  {
    method: 'DELETE',
    path: '/spaces/{spaceId}/members/{spaceMembershipId}',
    operationId: 'space_removeMember',
  },
  {
    method: 'PATCH',
    path: '/spaces/{spaceId}/members/{spaceMembershipId}',
    operationId: 'space_changeMemberRole',
  },
  {
    method: 'PATCH',
    path: '/spaces/{spaceId}/review-policy',
    operationId: 'space_updateReviewPolicy',
  },
] as const;

export type ApiOperation = (typeof apiOperations)[number];
export type ApiMethod = ApiOperation['method'];
export type ApiPath = ApiOperation['path'];
export type ApiOperationId = ApiOperation['operationId'];

export type GeneratedRequest<Operation extends ApiOperationId> = {
  operationId: Operation;
  path: ApiPath;
  method: ApiMethod;
  body?: unknown;
};

export type GeneratedResponse<Operation extends ApiOperationId> = {
  operationId: Operation;
  statusCode: number;
  body: unknown;
};
