import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function cursorRuleBody(content: Uint8Array): Uint8Array {
  const text = decoder.decode(content);
  return encoder.encode(text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''));
}

function cursorRule(content: Uint8Array, slug: string): Uint8Array {
  return encoder.encode(
    `---\ndescription: CapaPort capability ${slug}\nalwaysApply: true\n---\n\n${decoder.decode(content)}`,
  );
}

export function createCursorAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'cursor',
    displayName: 'Cursor',
    supportedComponents: ['skill', 'prompt', 'context'],
    environment,
    roots: { user: '.cursor', workspace: '.cursor' },
    directories: { skill: 'skills', prompt: 'commands', context: 'rules' },
    nativeFormats: { context: { extension: '.mdc', decode: cursorRuleBody, encode: cursorRule } },
  });
}
