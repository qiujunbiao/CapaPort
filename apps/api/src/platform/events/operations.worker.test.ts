import { describe, expect, it, vi } from 'vitest';
import {
  OPERATION_JOB_TYPES,
  type OperationJob,
  OperationJobRunner,
  type OperationJobStateStore,
  replaceDailyAggregate,
  versionUpdateRecipients,
} from './operations.worker.js';

function job(type: OperationJob['type'], attempts = 0, maxAttempts = 3): OperationJob {
  return {
    id: `job-${type}`,
    type,
    dedupKey: `${type}:2026-08-08`,
    payload: {},
    attempts,
    maxAttempts,
  };
}

function store(): OperationJobStateStore & { dead: OperationJob[] } {
  const dead: OperationJob[] = [];
  return {
    dead,
    claim: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn(async (failedJob, _code, deadLetter) => {
      if (deadLetter) dead.push(failedJob);
    }),
  };
}

describe('OperationJobRunner', () => {
  it('executes every supported durable job type', async () => {
    const state = store();
    const handlers = Object.fromEntries(OPERATION_JOB_TYPES.map((type) => [type, vi.fn()])) as never;
    const runner = new OperationJobRunner(state, handlers);
    for (const type of OPERATION_JOB_TYPES) await runner.run(job(type));
    for (const type of OPERATION_JOB_TYPES) expect(handlers[type]).toHaveBeenCalledOnce();
    expect(state.complete).toHaveBeenCalledTimes(OPERATION_JOB_TYPES.length);
  });

  it('does not execute duplicate deliveries after a job has been claimed', async () => {
    const state = store();
    vi.mocked(state.claim).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const handler = vi.fn();
    const runner = new OperationJobRunner(state, { server_scan: handler } as never);
    const input = job('server_scan');
    await runner.run(input);
    await runner.run(input);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('caps retries and marks the final failure as a dead letter', async () => {
    const state = store();
    const runner = new OperationJobRunner(state, {
      object_cleanup: vi.fn().mockRejectedValue(Object.assign(new Error('private details'), { code: 'S3_TIMEOUT' })),
    } as never);
    await expect(runner.run(job('object_cleanup', 2, 3))).resolves.toBeUndefined();
    expect(state.fail).toHaveBeenCalledWith(expect.anything(), 'S3_TIMEOUT', true);
  });

  it('fans new versions out to users with older installed versions', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ user_id: 'user-1' }, { user_id: 'user-2' }] });
    await expect(versionUpdateRecipients({ query } as never, 'org-1', 'version-new')).resolves.toEqual([
      'user-1',
      'user-2',
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('i.version_id<>published.id');
  });

  it('replaces a daily aggregate idempotently', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await replaceDailyAggregate({ query } as never, '2026-08-07');
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT (organization_id,day) DO UPDATE');
    expect(query).toHaveBeenCalledWith(expect.any(String), ['2026-08-07']);
  });
});
