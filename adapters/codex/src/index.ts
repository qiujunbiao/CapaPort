import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createCodexAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'codex',
    displayName: 'Codex',
    supportedComponents: ['skill'],
    environment,
    roots: { user: '.agents', workspace: '.agents' },
    directories: { skill: 'skills' },
  });
}
