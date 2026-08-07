import { describe, expect, it } from 'vitest';
import { asOrganizationId, SpaceType } from './index.js';

describe('domain types', () => {
  it('creates a branded organization id and exports all space types', () => {
    expect(asOrganizationId('org_1')).toBe('org_1');
    expect(Object.values(SpaceType)).toEqual(['personal', 'team', 'project', 'organization']);
  });
});
