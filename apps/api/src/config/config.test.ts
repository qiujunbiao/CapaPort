import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: 'postgres://agentdoor:agentdoor@localhost:5432/agentdoor',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'https://objects.example.com',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'agentdoor',
  S3_ACCESS_KEY: 'agentdoor',
  S3_SECRET_KEY: 'agentdoor-secret',
  JWT_SECRET: 'jwt-secret-that-is-longer-than-thirty-two-characters',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-that-is-longer-than-thirty-two-characters',
  VERIFICATION_PEPPER: 'verification-pepper-longer-than-thirty-two-characters',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Agentdoor <no-reply@agentdoor.local>',
};

describe('configuration', () => {
  it('parses and types a complete environment', () => {
    expect(parseConfig(validEnvironment)).toMatchObject({
      nodeEnv: 'test',
      port: 3100,
      s3: { bucket: 'agentdoor', publicEndpoint: 'https://objects.example.com' },
      auth: { accessTtlSeconds: 900, refreshTtlDays: 30 },
    });
  });

  it('rejects missing and malformed values before application startup', () => {
    expect(() => parseConfig({ ...validEnvironment, PORT: 'invalid' })).toThrow(/PORT/);
    expect(() => parseConfig({ ...validEnvironment, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});
