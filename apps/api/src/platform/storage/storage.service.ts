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
    return getSignedUrl(
      this.uploadClient,
      new PutObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey, ContentType: contentType }),
      { expiresIn },
    );
  }

  async statObject(objectKey: string): Promise<{ sizeBytes: number }> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey }));
    return { sizeBytes: result.ContentLength ?? 0 };
  }

  async readObject(objectKey: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey }));
    if (!result.Body) throw new Error('Stored artifact has no response body.');
    return result.Body.transformToByteArray();
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: objectKey }));
  }
}
