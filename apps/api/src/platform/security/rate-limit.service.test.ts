import { describe, expect, it } from 'vitest';
import type { AppError } from '../errors/app-error.js';
import { RateLimitService, type RateLimitStore } from './rate-limit.service.js';

class MemoryRateLimitStore implements RateLimitStore {
  readonly counts = new Map<string, number>();

  async consume(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }
}

const config = { verificationPepper: 'rate-limit-pepper-with-more-than-thirty-two-characters' };

describe('RateLimitService', () => {
  it.each([
    ['verification', 5],
    ['recovery', 3],
    ['invitation', 20],
  ] as const)('enforces the %s account limit', async (purpose, allowed) => {
    const service = new RateLimitService(new MemoryRateLimitStore(), config);
    for (let index = 0; index < allowed; index += 1) {
      await expect(service.assertAllowed(purpose, { account: 'same-account' })).resolves.toBeUndefined();
    }
    await expect(service.assertAllowed(purpose, { account: 'same-account' })).rejects.toMatchObject({
      code: 'SECURITY_RATE_LIMITED',
      statusCode: 429,
    } satisfies Partial<AppError>);
  });

  it('tracks account, IP, and device independently without storing raw values', async () => {
    const store = new MemoryRateLimitStore();
    const service = new RateLimitService(store, config);
    await service.assertAllowed('verification', {
      account: 'person@example.com',
      ipAddress: '203.0.113.7',
      deviceId: 'desktop-device-1',
    });
    expect(store.counts.size).toBe(3);
    expect([...store.counts.keys()].join('|')).not.toContain('person@example.com');
    expect([...store.counts.keys()].join('|')).not.toContain('203.0.113.7');
    expect([...store.counts.keys()].join('|')).not.toContain('desktop-device-1');
  });
});
