import { describe, expect, it } from 'vitest';
import {
  addPackageComponent,
  createEditablePackage,
  exportEditablePackage,
  importEditablePackage,
  updatePackageComponent,
  updatePackageMetadata,
  validateEditablePackage,
  compatibleAgentsForComponents,
  unsupportedComponentsForAgent,
} from './editor.js';

describe('editable capability packages', () => {
  it('creates and exports a canonical package containing Skill, Prompt, and project context', async () => {
    let editable = createEditablePackage({
      slug: 'release-helper',
      name: '发布助手',
      description: '统一发布检查',
      tags: ['release'],
      agents: ['claude-code', 'cursor'],
    });
    editable = updatePackageComponent(editable, editable.components[0]?.id ?? '', { content: '# Release skill' });
    editable = addPackageComponent(editable, 'prompt', '# Release prompt');
    editable = addPackageComponent(editable, 'context', '# Project release rules');

    expect(validateEditablePackage(editable)).toEqual([]);
    const exported = await exportEditablePackage(editable);
    expect(exported.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.files.map((file) => file.path)).toEqual([
      'capaport.yaml',
      'context/release-helper.md',
      'prompts/release-helper.md',
      'README.md',
      'skills/release-helper/SKILL.md',
    ]);
    expect(new TextDecoder().decode(exported.files[0]?.content)).toContain('schemaVersion: capaport.io/v1alpha1');

    const restored = importEditablePackage(exported.archive);
    expect(restored).toMatchObject({
      slug: 'release-helper',
      name: '发布助手',
      agents: ['claude-code', 'cursor'],
      components: [
        { type: 'skill', content: '# Release skill' },
        { type: 'prompt', content: '# Release prompt' },
        { type: 'context', content: '# Project release rules' },
      ],
    });
  });

  it('renames all canonical component paths when the package slug changes', () => {
    let editable = createEditablePackage({
      slug: 'first-name',
      name: 'First',
      description: '',
      tags: [],
      agents: ['codex'],
    });
    editable = addPackageComponent(editable, 'prompt', 'prompt');
    editable = updatePackageMetadata(editable, { slug: 'second-name', name: 'Second' });
    expect(editable.components.map((component) => component.path)).toEqual([
      'skills/second-name/SKILL.md',
      'prompts/second-name.md',
    ]);
  });

  it('rejects empty content, duplicate component types, and unsafe metadata before archive creation', async () => {
    const empty = createEditablePackage({
      slug: 'bad--slug',
      name: '',
      description: '',
      tags: [],
      agents: ['codex'],
    });
    expect(validateEditablePackage(empty)).toEqual(
      expect.arrayContaining(['能力标识格式无效', '能力名称不能为空', 'Skill 内容不能为空']),
    );
    const duplicate = addPackageComponent(addPackageComponent(empty, 'prompt', 'one'), 'prompt', 'two');
    expect(validateEditablePackage(duplicate)).toContain('每种组件类型只能出现一次');
    await expect(exportEditablePackage(duplicate)).rejects.toThrow('能力包校验失败');
  });

  it('rejects agents that cannot install every component in the package', () => {
    let editable = createEditablePackage({
      slug: 'portable-review',
      name: 'Portable review',
      description: '',
      tags: [],
      agents: ['codex', 'gemini-cli', 'claude-code'],
    });
    editable = updatePackageComponent(editable, editable.components[0]?.id ?? '', { content: '# Skill' });
    editable = addPackageComponent(editable, 'prompt', '# Prompt');
    editable = addPackageComponent(editable, 'context', '# Context');
    editable = updatePackageMetadata(editable, { agents: ['codex', 'gemini-cli', 'claude-code'] });

    expect(validateEditablePackage(editable)).toEqual(
      expect.arrayContaining([
        'Codex 不支持当前能力包中的Prompt、项目上下文组件',
        'Gemini CLI 不支持当前能力包中的项目上下文组件',
      ]),
    );
  });

  it('treats WorkBuddy and QwenWork as Skill-only clients', () => {
    expect(unsupportedComponentsForAgent('workbuddy', ['skill', 'prompt', 'context'])).toEqual(['prompt', 'context']);
    expect(unsupportedComponentsForAgent('qwenwork', ['skill', 'prompt', 'context'])).toEqual(['prompt', 'context']);
    expect(compatibleAgentsForComponents(['skill'])).toEqual([
      'codex',
      'claude-code',
      'cursor',
      'gemini-cli',
      'workbuddy',
      'qwenwork',
    ]);
  });
});
