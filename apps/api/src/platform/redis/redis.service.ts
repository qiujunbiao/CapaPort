import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import type { DependencyProbe } from '../health/health.service.js';

@Injectable()
export class RedisService implements DependencyProbe, OnModuleDestroy {
  readonly name = 'redis';
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async check(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.ping();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
