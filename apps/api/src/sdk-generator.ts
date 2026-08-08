import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './openapi.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const openApiPath = resolve(repositoryRoot, 'apps/api/openapi.json');
const generatedPath = resolve(repositoryRoot, 'packages/sdk/src/generated.ts');
const check = process.argv.includes('--check');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://agentdoor:agentdoor@127.0.0.1:5432/agentdoor',
  REDIS_URL: 'redis://127.0.0.1:6379',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'agentdoor-artifacts',
  S3_ACCESS_KEY: 'agentdoor',
  S3_SECRET_KEY: 'agentdoor-development-secret',
  JWT_SECRET: 'agentdoor-development-jwt-secret-32-characters',
  REFRESH_TOKEN_PEPPER: 'agentdoor-development-refresh-pepper-32-characters',
  VERIFICATION_PEPPER: 'agentdoor-development-verification-pepper-32-characters',
  SMTP_HOST: '127.0.0.1',
  SMTP_FROM: 'Agentdoor <no-reply@agentdoor.local>',
});

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sorted(child)]),
    );
  }
  return value;
}

function generateTypes(document: OpenAPIObject): string {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  const operations = Object.entries(document.paths)
    .flatMap(([path, pathItem]) =>
      Object.entries(pathItem ?? {})
        .filter(([method]) => methods.has(method))
        .map(([method, operation]) => ({
          method: method.toUpperCase(),
          path: path.replace(/^\/api\/v1/, '') || '/',
          operationId: (operation as { operationId?: string }).operationId ?? `${method}_${path}`,
        })),
    )
    .sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`));
  const renderedOperations = operations
    .map(
      (operation) => `  {
    method: '${operation.method}',
    path: '${operation.path.replaceAll("'", "\\'")}',
    operationId: '${operation.operationId.replaceAll("'", "\\'")}',
  },`,
    )
    .join('\n');
  return `/** Generated from apps/api/openapi.json by scripts/generate-sdk.ts. Do not edit. */
export const apiOperations = [
${renderedOperations}
] as const;

export type ApiOperation = (typeof apiOperations)[number];
export type ApiMethod = ApiOperation['method'];
export type ApiPath = ApiOperation['path'];
export type ApiOperationId = ApiOperation['operationId'];

export type GeneratedRequest<Operation extends ApiOperationId> = {
  operationId: Operation;
  path: ApiPath;
  method: ApiMethod;
  body?: unknown;
};

export type GeneratedResponse<Operation extends ApiOperationId> = {
  operationId: Operation;
  statusCode: number;
  body: unknown;
};
`;
}

async function assertCurrent(path: string, expected: string): Promise<void> {
  const current = await readFile(path, 'utf8').catch(() => '');
  if (current !== expected) throw new Error(`${path} is stale. Run pnpm sdk:generate.`);
}

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
try {
  app.setGlobalPrefix('api/v1');
  const document = createOpenApiDocument(app);
  const openApi = `${JSON.stringify(sorted(document), null, 2)}\n`;
  const generated = generateTypes(document);
  if (check) {
    await assertCurrent(openApiPath, openApi);
    await assertCurrent(generatedPath, generated);
  } else {
    await writeFile(openApiPath, openApi);
    await writeFile(generatedPath, generated);
  }
} finally {
  await app.close();
}
