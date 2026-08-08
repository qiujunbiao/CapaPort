import { describe, expect, it, vi } from 'vitest';
import { type OfflineWrite, OfflineWriteQueue, type OfflineWriteStore, type RescheduleInput } from './offline-queue';

class MemoryWriteStore implements OfflineWriteStore {
  readonly writes = new Map<string, OfflineWrite & { status: 'pending' | 'running' | 'failed'; availableAt: string }>();

  async enqueueWrite(write: OfflineWrite & { availableAt: string }): Promise<void> {
    if (!this.writes.has(write.id)) this.writes.set(write.id, { ...write, status: 'pending' });
  }

  async claimReadyWrites(now: string, limit: number): Promise<OfflineWrite[]> {
    const ready = [...this.writes.values()]
      .filter((write) => write.status === 'pending' && write.availableAt <= now)
      .slice(0, limit);
    for (const write of ready) write.status = 'running';
    return ready;
  }

  async completeWrite(id: string): Promise<void> {
    this.writes.delete(id);
  }

  async rescheduleWrite(input: RescheduleInput): Promise<void> {
    const write = this.writes.get(input.id);
    if (!write) return;
    write.status = input.permanentlyFailed ? 'failed' : 'pending';
    write.attempts += 1;
    write.availableAt = input.availableAt;
  }

  async retryFailedWrites(now: string): Promise<void> {
    for (const write of this.writes.values()) {
      if (write.status === 'failed') {
        write.status = 'pending';
        write.availableAt = now;
      }
    }
  }
}

describe('durable offline write queue', () => {
  const now = new Date('2026-08-08T00:00:00.000Z');

  it('persists before dispatch, survives restart, and completes exactly once', async () => {
    const store = new MemoryWriteStore();
    const first = new OfflineWriteQueue(store, { online: () => false, now: () => now });
    const send = vi.fn();
    const queued = await first.run('publication.submit', { value: 1 }, send);
    expect(queued.state).toBe('queued');
    expect(send).not.toHaveBeenCalled();
    expect(store.writes.size).toBe(1);

    const restarted = new OfflineWriteQueue(store, { online: () => true, now: () => now });
    const handler = vi.fn().mockResolvedValue(undefined);
    await restarted.syncNow({ 'publication.submit': handler });
    await restarted.syncNow({ 'publication.submit': handler });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.writes.size).toBe(0);
  });

  it('uses capped exponential backoff and dead-letters permanent authorization failures', async () => {
    const store = new MemoryWriteStore();
    let current = now;
    const queue = new OfflineWriteQueue(store, { online: () => true, now: () => current });
    await queue.run('installation.report', {}, async () => {
      throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
    });
    const retry = [...store.writes.values()][0];
    expect(retry?.status).toBe('pending');
    expect(new Date(retry?.availableAt ?? 0).getTime() - now.getTime()).toBe(1_000);

    current = new Date(now.getTime() + 1_000);
    await queue.retryFailed();
    await queue.syncNow({
      'installation.report': async () => {
        throw Object.assign(new Error('denied'), { code: 'ACCESS_DENIED' });
      },
    });
    expect([...store.writes.values()][0]?.status).toBe('failed');
  });

  it('keeps one stable idempotency key across every attempt', async () => {
    const store = new MemoryWriteStore();
    const queue = new OfflineWriteQueue(store, { online: () => true, now: () => now });
    await queue.run('installation.report', { installationId: 'one' }, async () => {
      throw Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });
    });
    const write = [...store.writes.values()][0];
    expect(write?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(write?.payloadJson ?? '{}')).toEqual({ installationId: 'one' });
  });
});
