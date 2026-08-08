import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseConfig } from '../config/config.js';
import { DatabaseService } from './database/database.service.js';
import { OutboxService } from './database/outbox.service.js';
import { createSmsProvider, SMS_PROVIDER } from './notifications/sms.provider.js';
import { RedisService } from './redis/redis.service.js';
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
    SMS_PROVIDER,
  ],
})
export class PlatformModule {}
