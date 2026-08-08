import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { APP_CONFIG, parseConfig } from '../config/config.js';
import { DatabaseService } from './database/database.service.js';
import { OutboxService } from './database/outbox.service.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor.js';
import { IDEMPOTENCY_STORE, RedisIdempotencyStore } from './idempotency/idempotency.store.js';
import { createSmsProvider, SMS_PROVIDER } from './notifications/sms.provider.js';
import { RedisService } from './redis/redis.service.js';
import { RATE_LIMIT_STORE, RateLimitService, RedisRateLimitStore } from './security/rate-limit.service.js';
import { RecentAuthGuard } from './security/recent-auth.guard.js';
import { StorageService } from './storage/storage.service.js';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => parseConfig(process.env) },
    DatabaseService,
    { provide: 'DATABASE_SERVICE', useExisting: DatabaseService },
    RedisService,
    { provide: 'REDIS_SERVICE', useExisting: RedisService },
    StorageService,
    OutboxService,
    RedisRateLimitStore,
    { provide: RATE_LIMIT_STORE, useExisting: RedisRateLimitStore },
    RateLimitService,
    RecentAuthGuard,
    RedisIdempotencyStore,
    { provide: IDEMPOTENCY_STORE, useExisting: RedisIdempotencyStore },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    {
      provide: SMS_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof parseConfig>) => createSmsProvider(config),
    },
  ],
  exports: [
    APP_CONFIG,
    DatabaseService,
    'DATABASE_SERVICE',
    RedisService,
    'REDIS_SERVICE',
    StorageService,
    OutboxService,
    RateLimitService,
    RecentAuthGuard,
    SMS_PROVIDER,
  ],
})
export class PlatformModule {}
