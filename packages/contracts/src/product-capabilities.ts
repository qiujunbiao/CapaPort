import type { CapabilitySummary } from './capabilities.js';

export const WEB_GOVERNANCE_CAPABILITIES = [
  'organization.overview',
  'capability.assets',
  'publication.review',
  'organization.members',
  'organization.spaces',
  'organization.security',
  'organization.audit',
  'organization.analytics',
  'organization.settings',
] as const;

export const DESKTOP_PRODUCT_CAPABILITIES = [
  ...WEB_GOVERNANCE_CAPABILITIES,
  'local.discovery',
  'local.authoring',
  'local.installation',
  'local.updates',
  'local.conflicts',
  'local.project-bindings',
  'local.diagnostics',
] as const;

export type WebGovernanceCapability = (typeof WEB_GOVERNANCE_CAPABILITIES)[number];
export type DesktopProductCapability = (typeof DESKTOP_PRODUCT_CAPABILITIES)[number];

export function isInstallableCapability(capability: CapabilitySummary): boolean {
  return capability.hasPublishedVersion === true;
}
