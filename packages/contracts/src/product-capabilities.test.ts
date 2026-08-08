import { describe, expect, it } from 'vitest';
import {
  DESKTOP_PRODUCT_CAPABILITIES,
  isInstallableCapability,
  WEB_GOVERNANCE_CAPABILITIES,
} from './product-capabilities.js';

describe('product capability inventory', () => {
  it('keeps Desktop as a functional superset of Web governance', () => {
    expect(WEB_GOVERNANCE_CAPABILITIES.every((id) => DESKTOP_PRODUCT_CAPABILITIES.includes(id))).toBe(true);
    expect(DESKTOP_PRODUCT_CAPABILITIES).toContain('local.discovery');
    expect(DESKTOP_PRODUCT_CAPABILITIES).toContain('local.installation');
  });

  it('treats only capabilities with a published version as installable', () => {
    const base = {
      id: 'capability-a',
      organizationId: 'organization-a',
      spaceId: 'space-a',
      slug: 'release-helper',
      name: 'Release helper',
      description: '',
      tags: [],
      compatibility: ['codex'] as const,
      ownerUserId: 'user-a',
      status: 'active' as const,
    };

    expect(
      isInstallableCapability({ ...base, compatibility: [...base.compatibility], hasPublishedVersion: true }),
    ).toBe(true);
    expect(
      isInstallableCapability({ ...base, compatibility: [...base.compatibility], hasPublishedVersion: false }),
    ).toBe(false);
    expect(isInstallableCapability({ ...base, compatibility: [...base.compatibility] })).toBe(false);
  });
});
