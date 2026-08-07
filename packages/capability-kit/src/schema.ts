import { z } from 'zod';

const MAX_PATH_LENGTH = 512;

export function normalizePackagePath(input: string): string {
  if (input.length === 0 || input.length > MAX_PATH_LENGTH || input.includes('\0')) {
    throw new Error('Unsafe package path: invalid length or null byte');
  }

  const normalized = input.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('Unsafe package path: absolute paths are not allowed');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Unsafe package path: traversal and empty segments are not allowed');
  }

  return segments.join('/');
}

const packagePathSchema = z.string().transform((value, context) => {
  try {
    return normalizePackagePath(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Unsafe package path',
    });
    return z.NEVER;
  }
});

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain lowercase letters, numbers, and single hyphens');

const componentSchema = z
  .object({
    type: z.enum(['skill', 'prompt', 'context']),
    path: packagePathSchema,
  })
  .strict();

const compatibilitySchema = z
  .object({
    agents: z
      .array(z.enum(['codex', 'claude-code', 'cursor', 'gemini-cli']))
      .min(1)
      .max(20),
  })
  .strict();

const permissionsSchema = z
  .object({
    filesystem: z.enum(['none', 'read-project', 'write-project']),
    network: z.enum(['none', 'restricted', 'full']),
  })
  .strict();

const dependencySchema = z
  .object({
    slug: slugSchema,
    version: z.string().min(1).max(80),
  })
  .strict();

export const manifestSchema = z
  .object({
    schemaVersion: z.literal('agentdoor.io/v1alpha1'),
    kind: z.literal('CapabilityPackage'),
    metadata: z
      .object({
        slug: slugSchema,
        name: z.string().min(1).max(120),
        description: z.string().max(2_000),
        tags: z.array(slugSchema).max(20).default([]),
      })
      .strict(),
    spec: z
      .object({
        components: z.array(componentSchema).min(1).max(100),
        compatibility: compatibilitySchema,
        permissions: permissionsSchema,
        entrypoints: z.record(z.string().min(1).max(80), packagePathSchema),
        dependencies: z.array(dependencySchema).max(100).default([]),
      })
      .strict(),
  })
  .strict();

export type CapabilityManifest = z.infer<typeof manifestSchema>;
