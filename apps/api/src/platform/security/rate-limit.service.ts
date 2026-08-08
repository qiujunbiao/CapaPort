import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { AppError } from '../errors/app-error.js';
import type { RedisService } from '../redis/redis.service.js';

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export type RateLimitPurpose = 'verification' | 'recovery' | 'invitation';
export type RateLimitDimensions = { account?: string; ipAddress?: string; deviceId?: string };
export interface RateLimitStore {
  consume(key: string, windowSeconds: number): Promise<number>;
}

const policies: Record<
  RateLimitPurpose,
  { windowSeconds: number; account: number; ipAddress: number; deviceId: number }
> = {
  verification: { windowSeconds: 3600, account: 5, ipAddress: 30, deviceId: 10 },
  recovery: { windowSeconds: 3600, account: 3, ipAddress: 20, deviceId: 6 },
  invitation: { windowSeconds: 3600, account: 20, ipAddress: 60, deviceId: 30 },
};

@Injectable()
export class RedisRateLimitStore implements RateLimitStore {
  constructor(@Inject('REDIS_SERVICE') private readonly redis: RedisService) {}

  async consume(key: string, windowSeconds: number): Promise<number> {
    const result = await this.redis.client.eval(
      "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return current",
      1,
      key,
      windowSeconds,
    );
    return Number(result);
  }
}

@Injectable()
export class RateLimitService {
  private readonly pepper: string;

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(APP_CONFIG) config: Pick<AppConfig['auth'], 'verificationPepper'> | AppConfig,
  ) {
    this.pepper = 'auth' in config ? config.auth.verificationPepper : config.verificationPepper;
  }

  async assertAllowed(purpose: RateLimitPurpose, dimensions: RateLimitDimensions): Promise<void> {
    const policy = policies[purpose];
    const checks = (['account', 'ipAddress', 'deviceId'] as const)
      .filter((dimension) => dimensions[dimension])
      .map(async (dimension) => ({
        dimension,
        count: await this.store.consume(
          `security:rate:${purpose}:${dimension}:${this.digest(`${dimension}:${dimensions[dimension]}`)}`,
          policy.windowSeconds,
        ),
      }));
    const results = await Promise.all(checks);
    if (results.some(({ dimension, count }) => count > policy[dimension])) {
      throw new AppError('SECURITY_RATE_LIMITED', 'Too many requests. Try again later.', 429);
    }
  }

  private digest(value: string): string {
    return createHmac('sha256', this.pepper).update(value).digest('hex');
  }
}
