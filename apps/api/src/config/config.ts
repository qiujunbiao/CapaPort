import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_100),
    CORS_ORIGINS: z.string().optional(),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    S3_ENDPOINT: z.url(),
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(8),
    S3_SERVER_SIDE_ENCRYPTION: z.enum(['AES256', 'aws:kms']).optional(),
    S3_KMS_KEY_ID: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
    JWT_SECRET: z.string().min(32),
    REFRESH_TOKEN_PEPPER: z.string().min(32),
    VERIFICATION_PEPPER: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    PASSWORD_RISK_MODE: z.enum(['google', 'development']).optional(),
    GOOGLE_CLOUD_PROJECT: z.string().trim().min(1).optional(),
    PASSWORD_RISK_TIMEOUT_MS: z.coerce.number().int().min(100).max(5_000).default(500),
    VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(2).max(60).default(10),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_FROM: z.string().min(3),
    SMS_PROVIDER_URL: z.url().optional(),
    SMS_PROVIDER_TOKEN: z.string().min(16).optional(),
    SMS_SENDER: z.string().trim().min(1).max(32).optional(),
    SMS_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    METRICS_TOKEN: z.string().min(32).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.METRICS_TOKEN) {
      context.addIssue({ code: 'custom', path: ['METRICS_TOKEN'], message: 'is required in production' });
    }
    if (value.PASSWORD_RISK_MODE === 'google' && !value.GOOGLE_CLOUD_PROJECT) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'is required when PASSWORD_RISK_MODE is google',
      });
    }
    if (value.NODE_ENV === 'production') {
      if ((value.PASSWORD_RISK_MODE ?? 'google') !== 'google') {
        context.addIssue({
          code: 'custom',
          path: ['PASSWORD_RISK_MODE'],
          message: 'must be google in production',
        });
      }
      if (!value.GOOGLE_CLOUD_PROJECT) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CLOUD_PROJECT'],
          message: 'is required in production',
        });
      }
      if (!value.S3_SERVER_SIDE_ENCRYPTION) {
        context.addIssue({
          code: 'custom',
          path: ['S3_SERVER_SIDE_ENCRYPTION'],
          message: 'is required in production',
        });
      }
      for (const key of ['SMS_PROVIDER_URL', 'SMS_PROVIDER_TOKEN', 'SMS_SENDER'] as const) {
        if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
      }
    }
    if (value.S3_SERVER_SIDE_ENCRYPTION === 'aws:kms' && !value.S3_KMS_KEY_ID) {
      context.addIssue({ code: 'custom', path: ['S3_KMS_KEY_ID'], message: 'is required when using aws:kms' });
    }
  });

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
  s3: {
    endpoint: string;
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    encryption?: { algorithm: 'AES256' | 'aws:kms'; kmsKeyId?: string };
  };
  auth: {
    jwtSecret: string;
    refreshPepper: string;
    verificationPepper: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
    verificationTtlMinutes: number;
    passwordRisk:
      | { mode: 'development'; timeoutMs: number }
      | { mode: 'google'; projectId: string; timeoutMs: number };
  };
  notification: {
    smtpHost: string;
    smtpPort: number;
    smtpFrom: string;
    sms?: { endpoint: string; token: string; sender: string; timeoutMs: number };
  };
  metricsToken: string;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export function parseConfig(environment: Record<string, string | undefined>): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid application configuration: ${detail}`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    corsOrigins: parsed.data.CORS_ORIGINS
      ? parsed.data.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : [
          'http://localhost:1420',
          'http://127.0.0.1:1420',
          'http://localhost:1430',
          'http://127.0.0.1:1430',
          'tauri://localhost',
          'http://tauri.localhost',
        ],
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    s3: {
      endpoint: parsed.data.S3_ENDPOINT,
      publicEndpoint: parsed.data.S3_PUBLIC_ENDPOINT ?? parsed.data.S3_ENDPOINT,
      region: parsed.data.S3_REGION,
      bucket: parsed.data.S3_BUCKET,
      accessKey: parsed.data.S3_ACCESS_KEY,
      secretKey: parsed.data.S3_SECRET_KEY,
      ...(parsed.data.S3_SERVER_SIDE_ENCRYPTION
        ? {
            encryption: {
              algorithm: parsed.data.S3_SERVER_SIDE_ENCRYPTION,
              ...(parsed.data.S3_KMS_KEY_ID ? { kmsKeyId: parsed.data.S3_KMS_KEY_ID } : {}),
            },
          }
        : {}),
    },
    auth: {
      jwtSecret: parsed.data.JWT_SECRET,
      refreshPepper: parsed.data.REFRESH_TOKEN_PEPPER,
      verificationPepper: parsed.data.VERIFICATION_PEPPER,
      accessTtlSeconds: parsed.data.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: parsed.data.REFRESH_TOKEN_TTL_DAYS,
      verificationTtlMinutes: parsed.data.VERIFICATION_TTL_MINUTES,
      passwordRisk:
        (parsed.data.PASSWORD_RISK_MODE ?? (parsed.data.NODE_ENV === 'production' ? 'google' : 'development')) ===
        'google'
          ? {
              mode: 'google',
              projectId: parsed.data.GOOGLE_CLOUD_PROJECT!,
              timeoutMs: parsed.data.PASSWORD_RISK_TIMEOUT_MS,
            }
          : { mode: 'development', timeoutMs: parsed.data.PASSWORD_RISK_TIMEOUT_MS },
    },
    notification: {
      smtpHost: parsed.data.SMTP_HOST,
      smtpPort: parsed.data.SMTP_PORT,
      smtpFrom: parsed.data.SMTP_FROM,
      ...(parsed.data.SMS_PROVIDER_URL && parsed.data.SMS_PROVIDER_TOKEN && parsed.data.SMS_SENDER
        ? {
            sms: {
              endpoint: parsed.data.SMS_PROVIDER_URL,
              token: parsed.data.SMS_PROVIDER_TOKEN,
              sender: parsed.data.SMS_SENDER,
              timeoutMs: parsed.data.SMS_TIMEOUT_MS,
            },
          }
        : {}),
    },
    metricsToken: parsed.data.METRICS_TOKEN ?? 'capaport-development-metrics-token',
  };
}
