import { stringify } from 'yaml';
import { buildArchive, extractArchive } from './archive.js';
import { hashPackage, normalizePackageFiles, type PackageFile } from './hash.js';
import { parseManifest } from './manifest.js';
import type { CapabilityManifest } from './schema.js';

export type EditableComponentType = 'skill' | 'prompt' | 'context';
export type EditableAgent = 'codex' | 'claude-code' | 'cursor' | 'gemini-cli';

export type EditablePackageComponent = {
  id: string;
  type: EditableComponentType;
  path: string;
  content: string;
};

export type EditableCapabilityPackage = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  agents: EditableAgent[];
  permissions: { filesystem: 'none' | 'read-project' | 'write-project'; network: 'none' | 'restricted' | 'full' };
  components: EditablePackageComponent[];
};

export type EditablePackageExport = { files: PackageFile[]; archive: Uint8Array; digest: string };

export function importEditablePackage(archive: Uint8Array): EditableCapabilityPackage {
  const files = extractArchive(archive);
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const manifestBytes = byPath.get('capaport.yaml');
  if (!manifestBytes) throw new Error('能力包缺少 capaport.yaml');
  const manifest = parseManifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const components = manifest.spec.components.map((component): EditablePackageComponent => {
    const path =
      component.type === 'skill' && !byPath.has(component.path) ? `${component.path}/SKILL.md` : component.path;
    const content = byPath.get(path);
    if (!content) throw new Error(`能力包组件缺失：${path}`);
    return { id: crypto.randomUUID(), type: component.type, path, content: decoder.decode(content) };
  });
  return {
    slug: manifest.metadata.slug,
    name: manifest.metadata.name,
    description: manifest.metadata.description,
    tags: [...manifest.metadata.tags],
    agents: [...manifest.spec.compatibility.agents],
    permissions: { ...manifest.spec.permissions },
    components,
  };
}

function componentPath(slug: string, type: EditableComponentType): string {
  if (type === 'skill') return `skills/${slug}/SKILL.md`;
  if (type === 'prompt') return `prompts/${slug}.md`;
  return `context/${slug}.md`;
}

export function createEditablePackage(input: {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  agents: EditableAgent[];
}): EditableCapabilityPackage {
  return {
    ...input,
    tags: [...new Set(input.tags)],
    agents: [...new Set(input.agents)],
    permissions: { filesystem: 'read-project', network: 'none' },
    components: [
      {
        id: crypto.randomUUID(),
        type: 'skill',
        path: componentPath(input.slug, 'skill'),
        content: '',
      },
    ],
  };
}

export function addPackageComponent(
  editable: EditableCapabilityPackage,
  type: EditableComponentType,
  content = '',
): EditableCapabilityPackage {
  return {
    ...editable,
    components: [
      ...editable.components,
      { id: crypto.randomUUID(), type, path: componentPath(editable.slug, type), content },
    ],
  };
}

export function updatePackageMetadata(
  editable: EditableCapabilityPackage,
  patch: Partial<Pick<EditableCapabilityPackage, 'slug' | 'name' | 'description' | 'tags' | 'agents' | 'permissions'>>,
): EditableCapabilityPackage {
  const slug = patch.slug ?? editable.slug;
  return {
    ...editable,
    ...patch,
    slug,
    ...(patch.tags ? { tags: [...new Set(patch.tags)] } : {}),
    ...(patch.agents ? { agents: [...new Set(patch.agents)] } : {}),
    components: editable.components.map((component) => ({
      ...component,
      path: componentPath(slug, component.type),
    })),
  };
}

export function updatePackageComponent(
  editable: EditableCapabilityPackage,
  componentId: string,
  patch: Partial<Pick<EditablePackageComponent, 'content' | 'path'>>,
): EditableCapabilityPackage {
  return {
    ...editable,
    components: editable.components.map((component) =>
      component.id === componentId ? { ...component, ...patch } : component,
    ),
  };
}

export function removePackageComponent(
  editable: EditableCapabilityPackage,
  componentId: string,
): EditableCapabilityPackage {
  return { ...editable, components: editable.components.filter((component) => component.id !== componentId) };
}

export function validateEditablePackage(editable: EditableCapabilityPackage): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editable.slug) || editable.slug.length > 80) errors.push('能力标识格式无效');
  if (!editable.name.trim()) errors.push('能力名称不能为空');
  if (editable.name.trim().length > 120) errors.push('能力名称不能超过 120 个字符');
  if (editable.description.length > 2_000) errors.push('能力描述不能超过 2000 个字符');
  if (editable.agents.length === 0) errors.push('至少选择一个兼容 Agent');
  if (editable.components.length === 0) errors.push('至少添加一个能力组件');
  if (new Set(editable.components.map((component) => component.type)).size !== editable.components.length)
    errors.push('每种组件类型只能出现一次');
  if (new Set(editable.components.map((component) => component.path)).size !== editable.components.length)
    errors.push('组件路径不能重复');
  for (const component of editable.components) {
    if (!component.content.trim()) {
      const label = component.type === 'skill' ? 'Skill' : component.type === 'prompt' ? 'Prompt' : '项目上下文';
      errors.push(`${label} 内容不能为空`);
    }
    const expected = componentPath(editable.slug, component.type);
    if (component.path !== expected) errors.push(`${component.type} 组件路径必须为 ${expected}`);
  }
  return [...new Set(errors)];
}

function manifestPath(component: EditablePackageComponent): string {
  return component.type === 'skill' ? component.path.replace(/\/SKILL\.md$/, '') : component.path;
}

export async function exportEditablePackage(editable: EditableCapabilityPackage): Promise<EditablePackageExport> {
  const errors = validateEditablePackage(editable);
  if (errors.length) throw new Error(`能力包校验失败：${errors.join('；')}`);
  const manifest: CapabilityManifest = {
    schemaVersion: 'capaport.io/v1alpha1',
    kind: 'CapabilityPackage',
    metadata: {
      slug: editable.slug,
      name: editable.name.trim(),
      description: editable.description,
      tags: [...new Set(editable.tags)],
    },
    spec: {
      components: editable.components.map((component) => ({ type: component.type, path: manifestPath(component) })),
      compatibility: { agents: [...new Set(editable.agents)] },
      permissions: { ...editable.permissions },
      entrypoints: { default: editable.components[0]?.path ?? '' },
      dependencies: [],
    },
  };
  const encoder = new TextEncoder();
  const files = normalizePackageFiles([
    {
      path: 'README.md',
      content: encoder.encode(`# ${editable.name.trim()}\n\n${editable.description || 'CapaPort 能力包'}\n`),
    },
    { path: 'capaport.yaml', content: encoder.encode(stringify(manifest, { lineWidth: 0 })) },
    ...editable.components.map((component) => ({ path: component.path, content: encoder.encode(component.content) })),
  ]);
  return { files, archive: buildArchive(files), digest: await hashPackage(files) };
}
