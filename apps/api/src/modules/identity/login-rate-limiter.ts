import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { AppError } from '../../platform/errors/app-error.js';
import type { RedisService } from '../../platform/redis/redis.service.js';
import type { RateLimiter } from './identity.service.js';

@Injectable()
export class RedisLoginRateLimiter implements RateLimiter {
  constructor(
    @Inject('REDIS_SERVICE') private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async assertAllowed(identity: string, ipAddress?: string): Promise<void> {
    const attempts = Number((await this.redis.client.get(this.key(identity, ipAddress))) ?? 0);
    if (attempts >= 5) throw new AppError('AUTH_LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.', 429);
  }

  async recordFailure(identity: string, ipAddress?: string): Promise<void> {
    const key = this.key(identity, ipAddress);
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) await this.redis.client.expire(key, 900);
  }

  async clear(identity: string, ipAddress?: string): Promise<void> {
    await this.redis.client.del(this.key(identity, ipAddress));
  }

  private key(identity: string, ipAddress?: string): string {
    const digest = createHmac('sha256', this.config.auth.verificationPepper)
      .update(`${identity}|${ipAddress ?? 'unknown'}`)
      .digest('hex');
    return `auth:login:${digest}`;
  }
}
