import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: 'postgres://capaport:capaport@localhost:5432/capaport',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'https://objects.example.com',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'capaport',
  S3_ACCESS_KEY: 'capaport',
  S3_SECRET_KEY: 'capaport-secret',
  JWT_SECRET: 'jwt-secret-that-is-longer-than-thirty-two-characters',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-that-is-longer-than-thirty-two-characters',
  VERIFICATION_PEPPER: 'verification-pepper-longer-than-thirty-two-characters',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'CapaPort <no-reply@capaport.local>',
};

describe('configuration', () => {
  it('parses and types a complete environment', () => {
    expect(parseConfig(validEnvironment)).toMatchObject({
      nodeEnv: 'test',
      port: 3100,
      s3: { bucket: 'capaport', publicEndpoint: 'https://objects.example.com' },
      auth: { accessTtlSeconds: 900, refreshTtlDays: 30 },
    });
  });

  it('parses explicit browser origins for hosted clients', () => {
    expect(
      parseConfig({ ...validEnvironment, CORS_ORIGINS: 'https://app.example.com, https://admin.example.com' }),
    ).toMatchObject({ corsOrigins: ['https://app.example.com', 'https://admin.example.com'] });
  });

  it('rejects missing and malformed values before application startup', () => {
    expect(() => parseConfig({ ...validEnvironment, PORT: 'invalid' })).toThrow(/PORT/);
    expect(() => parseConfig({ ...validEnvironment, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('requires a complete SMS provider configuration in production', () => {
    const production = { ...validEnvironment, NODE_ENV: 'production', METRICS_TOKEN: 'm'.repeat(32) };
    expect(() => parseConfig(production)).toThrow(/S3_SERVER_SIDE_ENCRYPTION/);
    expect(
      parseConfig({
        ...production,
        SMS_PROVIDER_URL: 'https://sms.example.com/v1/messages',
        SMS_PROVIDER_TOKEN: 'sms-provider-secret-token',
        SMS_SENDER: 'CapaPort',
        S3_SERVER_SIDE_ENCRYPTION: 'AES256',
        S3_KMS_KEY_ID: '',
      }),
    ).toMatchObject({
      notification: { sms: { endpoint: 'https://sms.example.com/v1/messages', sender: 'CapaPort' } },
    });
  });

  it('requires a KMS key when KMS encryption is selected', () => {
    expect(() => parseConfig({ ...validEnvironment, S3_SERVER_SIDE_ENCRYPTION: 'aws:kms' })).toThrow(/S3_KMS_KEY_ID/);
    expect(
      parseConfig({
        ...validEnvironment,
        S3_SERVER_SIDE_ENCRYPTION: 'aws:kms',
        S3_KMS_KEY_ID: 'alias/capaport',
      }),
    ).toMatchObject({ s3: { encryption: { algorithm: 'aws:kms', kmsKeyId: 'alias/capaport' } } });
  });
});
