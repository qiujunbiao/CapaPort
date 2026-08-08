import { describe, expect, it } from 'vitest';
import {
  createOrganizationRequestSchema,
  inviteMemberRequestSchema,
  transferOwnershipRequestSchema,
} from './organizations.js';

describe('organization contracts', () => {
  it('normalizes organization slugs and applies the default invitation role', () => {
    expect(createOrganizationRequestSchema.parse({ name: ' Platform ', slug: 'PLATFORM-TEAM' })).toEqual({
      name: 'Platform',
      slug: 'platform-team',
    });
    expect(inviteMemberRequestSchema.parse({ kind: 'email', target: 'member@example.com' }).role).toBe('member');
  });

  it('accepts organization creation without exposing a technical slug', () => {
    expect(createOrganizationRequestSchema.parse({ name: ' 海岸小香蕉 ' })).toEqual({ name: '海岸小香蕉' });
  });

  it('rejects invalid organization slugs and membership identifiers', () => {
    expect(createOrganizationRequestSchema.safeParse({ name: 'Platform', slug: '../platform' }).success).toBe(false);
    expect(transferOwnershipRequestSchema.safeParse({ membershipId: 'not-a-uuid' }).success).toBe(false);
  });
});
