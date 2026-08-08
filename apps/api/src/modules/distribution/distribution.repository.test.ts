import { describe, expect, it, vi } from 'vitest';
import { DistributionRepository } from './distribution.repository.js';

describe('DistributionRepository installation projection', () => {
  it('queries only the latest state per device, capability, and agent', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new DistributionRepository({ pool: { query } } as never);

    await repository.listInstallations('organization-a', 'user-a');

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DISTINCT ON (device_id,capability_id,agent)');
    expect(sql).toContain('ORDER BY device_id,capability_id,agent,updated_at DESC,created_at DESC,id DESC');
    expect(parameters).toEqual(['organization-a', 'user-a']);
  });
});
