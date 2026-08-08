import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import type { DependencyProbe } from '../health/health.service.js';

export function encryptionRequest(config: AppConfig): {
  command: { ServerSideEncryption?: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string };
  headers: Record<string, string>;
} {
  const encryption = config.s3.encryption;
  if (!encryption) return { command: {}, headers: {} };
  return {
    command: {
      ServerSideEncryption: encryption.algorithm,
      ...(encryption.kmsKeyId ? { SSEKMSKeyId: encryption.kmsKeyId } : {}),
    },
    headers: {
      'x-amz-server-side-encryption': encryption.algorithm,
      ...(encryption.kmsKeyId ? { 'x-amz-server-side-encryption-aws-kms-key-id': encryption.kmsKeyId } : {}),
    },
  };
}

@Injectable()
export class StorageService implements DependencyProbe {
  readonly name = 'storage';
  readonly client: S3Client;
  private readonly uploadClient: S3Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
    });
    this.uploadClient = new S3Client({
      endpoint: config.s3.publicEndpoint,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
    });
  }

  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.s3.bucket }));
  }

  createUploadUrl(objectKey: string, contentType: 'application/zip', expiresIn = 300): Promise<string> {
    const encryption = encryptionRequest(this.config);
    return getSignedUrl(
      this.uploadClient,
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: objectKey,
        ContentType: contentType,
        ...encryption.command,
      }),
      { expiresIn },
    );
  }

  uploadHeaders(): Record<string, string> {
    return encryptionRequest(this.config).headers;
  }

  createDownloadUrl(objectKey: string, expiresIn = 120): Promise<string> {
    return getSignedUrl(
      this.uploadClient,
      new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey, ResponseContentType: 'application/zip' }),
      { expiresIn },
    );
  }

  async statObject(objectKey: string): Promise<{ sizeBytes: number }> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey }));
    const expected = this.config.s3.encryption?.algorithm;
    if (expected && result.ServerSideEncryption !== expected) {
      throw new Error(`Stored artifact does not use the required ${expected} server-side encryption.`);
    }
    return { sizeBytes: result.ContentLength ?? 0 };
  }

  async readObject(objectKey: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey }));
    if (!result.Body) throw new Error('Stored artifact has no response body.');
    return result.Body.transformToByteArray();
  }

  async writeVerifiedObject(objectKey: string, bytes: Uint8Array, contentType: 'application/zip'): Promise<void> {
    const encryption = encryptionRequest(this.config);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: contentType,
        ...encryption.command,
      }),
    );
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey }));
  }
}
