import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/config.js';
import { encryptionRequest } from './storage.service.js';

function config(encryption?: AppConfig['s3']['encryption']): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3100,
    corsOrigins: ['http://localhost:1430'],
    databaseUrl: 'postgres://localhost/capaport',
    redisUrl: 'redis://localhost:6379',
    s3: {
      endpoint: 'http://localhost:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'capaport',
      accessKey: 'capaport',
      secretKey: 'capaport-secret',
      ...(encryption ? { encryption } : {}),
    },
    auth: {
      jwtSecret: 'j'.repeat(32),
      refreshPepper: 'r'.repeat(32),
      verificationPepper: 'v'.repeat(32),
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
      verificationTtlMinutes: 10,
      passwordRisk: { mode: 'development', timeoutMs: 500 },
    },
    notification: { smtpHost: 'localhost', smtpPort: 1025, smtpFrom: 'no-reply@example.com' },
    metricsToken: 'm'.repeat(32),
  };
}

describe('storage encryption request', () => {
  it('keeps local object stores compatible when encryption is not configured', () => {
    expect(encryptionRequest(config())).toEqual({ command: {}, headers: {} });
  });

  it('returns matching signed upload command and client headers for AES-256', () => {
    expect(encryptionRequest(config({ algorithm: 'AES256' }))).toEqual({
      command: { ServerSideEncryption: 'AES256' },
      headers: { 'x-amz-server-side-encryption': 'AES256' },
    });
  });

  it('includes the required KMS key in the command and client headers', () => {
    expect(encryptionRequest(config({ algorithm: 'aws:kms', kmsKeyId: 'alias/capaport' }))).toEqual({
      command: { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'alias/capaport' },
      headers: {
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': 'alias/capaport',
      },
    });
  });
});
