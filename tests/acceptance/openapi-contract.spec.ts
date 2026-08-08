import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('OpenAPI and generated SDK contract', () => {
  it('documents every Nest controller operation and keeps generated SDK output current', async () => {
    const document = JSON.parse(await readFile(resolve(repositoryRoot, 'apps/api/openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const controllers = await Promise.all(
      [
        'identity/auth.controller.ts',
        'organizations/organization.controller.ts',
        'access/space.controller.ts',
        'capabilities/capability.controller.ts',
        'capabilities/artifact.controller.ts',
        'publishing/publication.controller.ts',
        'projects/project.controller.ts',
        'distribution/distribution.controller.ts',
        'notifications/notification.controller.ts',
        'analytics/analytics.controller.ts',
      ].map((path) => readFile(resolve(repositoryRoot, 'apps/api/src/modules', path), 'utf8')),
    );
    const declaredOperations = controllers.reduce(
      (total, source) => total + [...source.matchAll(/@(Get|Post|Patch|Put|Delete)\(/g)].length,
      0,
    );
    const documentedOperations = Object.values(document.paths).reduce(
      (total, methods) =>
        total +
        Object.keys(methods).filter((method) => ['get', 'post', 'patch', 'put', 'delete'].includes(method)).length,
      0,
    );
    expect(documentedOperations).toBeGreaterThanOrEqual(declaredOperations);
    expect(await readFile(resolve(repositoryRoot, 'packages/sdk/src/generated.ts'), 'utf8')).toContain(
      'Generated from apps/api/openapi.json',
    );
  });
});
