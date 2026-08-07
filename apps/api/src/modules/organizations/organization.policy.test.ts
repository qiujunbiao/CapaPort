import { describe, expect, it } from 'vitest';
import { canChangeMemberRole, canRemoveMember, requireAnotherOwner } from './organization.policy.js';

describe('organization role policy', () => {
  it.each([
    ['owner', 'admin', 'member', true],
    ['owner', 'owner', 'admin', false],
    ['admin', 'member', 'auditor', true],
    ['admin', 'auditor', 'admin', true],
    ['admin', 'admin', 'member', false],
    ['admin', 'member', 'owner', false],
    ['auditor', 'member', 'member', false],
    ['member', 'member', 'admin', false],
  ] as const)('%s changing %s to %s => %s', (actor, target, desired, expected) => {
    expect(canChangeMemberRole(actor, target, desired)).toBe(expected);
  });

  it('protects owners from generic removal and requires a second owner before leaving', () => {
    expect(canRemoveMember('owner', 'owner')).toBe(false);
    expect(canRemoveMember('admin', 'member')).toBe(true);
    expect(() => requireAnotherOwner('owner', 1)).toThrow(/last owner/i);
    expect(requireAnotherOwner('owner', 2)).toBeUndefined();
    expect(requireAnotherOwner('member', 1)).toBeUndefined();
  });
});
