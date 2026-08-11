import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createQwenWorkAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'qwenwork',
    displayName: '千问 Work（QwenWork）',
    supportedComponents: ['skill'],
    environment,
    roots: { user: '.qwenworkcn' },
    directories: { skill: 'skills' },
  });
}
