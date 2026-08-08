import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createCursorAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'cursor',
    displayName: 'Cursor',
    supportedComponents: ['skill', 'prompt', 'context'],
    environment,
    roots: { user: '.cursor', workspace: '.cursor' },
    directories: { skill: 'skills', prompt: 'commands', context: 'rules' },
  });
}
