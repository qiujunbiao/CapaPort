export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type UserId = Brand<string, 'UserId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type SpaceId = Brand<string, 'SpaceId'>;
export type CapabilityId = Brand<string, 'CapabilityId'>;
export type CapabilityVersionId = Brand<string, 'CapabilityVersionId'>;
export type PublicationId = Brand<string, 'PublicationId'>;
export type DeviceId = Brand<string, 'DeviceId'>;

export const asUserId = (value: string) => value as UserId;
export const asOrganizationId = (value: string) => value as OrganizationId;
export const asMembershipId = (value: string) => value as MembershipId;
export const asSpaceId = (value: string) => value as SpaceId;
export const asCapabilityId = (value: string) => value as CapabilityId;
export const asCapabilityVersionId = (value: string) => value as CapabilityVersionId;
export const asPublicationId = (value: string) => value as PublicationId;
export const asDeviceId = (value: string) => value as DeviceId;

export const SpaceType = {
  Personal: 'personal',
  Team: 'team',
  Project: 'project',
  Organization: 'organization',
} as const;
export type SpaceType = (typeof SpaceType)[keyof typeof SpaceType];

export const OrganizationRole = {
  Owner: 'owner',
  Admin: 'admin',
  Auditor: 'auditor',
  Member: 'member',
} as const;
export type OrganizationRole = (typeof OrganizationRole)[keyof typeof OrganizationRole];

export const SpaceRole = {
  Manager: 'manager',
  Reviewer: 'reviewer',
  Contributor: 'contributor',
  Viewer: 'viewer',
} as const;
export type SpaceRole = (typeof SpaceRole)[keyof typeof SpaceRole];

export const CapabilityComponentType = {
  Skill: 'skill',
  Prompt: 'prompt',
  Context: 'context',
} as const;
export type CapabilityComponentType = (typeof CapabilityComponentType)[keyof typeof CapabilityComponentType];

export const PublicationStatus = {
  Draft: 'draft',
  Scanning: 'scanning',
  Blocked: 'blocked',
  InReview: 'in_review',
  ChangesRequested: 'changes_requested',
  Rejected: 'rejected',
  Published: 'published',
  Deprecated: 'deprecated',
  Withdrawn: 'withdrawn',
  Archived: 'archived',
} as const;
export type PublicationStatus = (typeof PublicationStatus)[keyof typeof PublicationStatus];

export const SupportedAgent = {
  Codex: 'codex',
  ClaudeCode: 'claude-code',
  Cursor: 'cursor',
  GeminiCli: 'gemini-cli',
  WorkBuddy: 'workbuddy',
  QwenWork: 'qwenwork',
} as const;
export type SupportedAgent = (typeof SupportedAgent)[keyof typeof SupportedAgent];
