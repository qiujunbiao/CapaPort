import { describe, expect, it } from 'vitest';
import { addSpaceMemberRequestSchema, createSpaceRequestSchema } from './spaces.js';

describe('space contracts', () => {
  it('only permits user-created team and project spaces', () => {
    expect(createSpaceRequestSchema.parse({ type: 'team', name: ' Platform ', slug: 'PLATFORM' })).toEqual({
      type: 'team',
      name: 'Platform',
      slug: 'platform',
      reviewPolicy: 'required',
    });
    expect(createSpaceRequestSchema.safeParse({ type: 'personal', name: 'Personal', slug: 'personal' }).success).toBe(
      false,
    );
  });

  it('accepts space creation without exposing a technical slug', () => {
    expect(createSpaceRequestSchema.parse({ type: 'team', name: ' 团队一 ' })).toEqual({
      type: 'team',
      name: '团队一',
      reviewPolicy: 'required',
    });
  });

  it('rejects non-organization member identifiers at the contract boundary', () => {
    expect(addSpaceMemberRequestSchema.safeParse({ userId: 'other-tenant', role: 'viewer' }).success).toBe(false);
  });
});
