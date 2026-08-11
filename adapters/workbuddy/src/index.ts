import { type AdapterEnvironment, createFilesystemAdapter, defaultAdapterEnvironment } from '@capaport/adapter-sdk';

export function createWorkBuddyAdapter(environment: AdapterEnvironment = defaultAdapterEnvironment()) {
  return createFilesystemAdapter({
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    supportedComponents: ['skill'],
    environment,
    roots: { user: '.workbuddy', workspace: '.codebuddy' },
    directories: { skill: 'skills' },
  });
}
