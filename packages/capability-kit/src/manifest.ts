import { parse } from 'yaml';
import { type CapabilityManifest, manifestSchema } from './schema.js';

export function parseManifest(yaml: string): CapabilityManifest {
  let input: unknown;
  try {
    input = parse(yaml);
  } catch (error) {
    throw new Error(`Invalid capability manifest YAML: ${error instanceof Error ? error.message : 'parse failed'}`);
  }

  const result = manifestSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid capability manifest: ${details}`);
  }

  const componentPaths = new Set<string>();
  for (const component of result.data.spec.components) {
    if (componentPaths.has(component.path)) {
      throw new Error(`Invalid capability manifest: duplicate component path ${component.path}`);
    }
    componentPaths.add(component.path);
  }

  return result.data;
}
