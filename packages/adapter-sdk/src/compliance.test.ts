import { defineAdapterComplianceSuite } from './compliance.js';
import { createFilesystemAdapter } from './filesystem-adapter.js';

defineAdapterComplianceSuite({
  name: 'fake adapter',
  adapterId: 'fake',
  supportedComponents: ['skill', 'prompt'],
  createAdapter: (environment) =>
    createFilesystemAdapter({
      id: 'fake',
      displayName: 'Fake Agent',
      supportedComponents: ['skill', 'prompt'],
      environment,
      roots: { user: '.fake', workspace: '.fake' },
      directories: { skill: 'skills', prompt: 'commands' },
    }),
});

defineAdapterComplianceSuite({
  name: 'user-only fake adapter',
  adapterId: 'user-only-fake',
  supportedComponents: ['skill'],
  supportedScopes: ['user'],
  roots: { user: '.user-only-fake' },
  createAdapter: (environment) =>
    createFilesystemAdapter({
      id: 'user-only-fake',
      displayName: 'User-only Fake Agent',
      supportedComponents: ['skill'],
      environment,
      roots: { user: '.user-only-fake' },
      directories: { skill: 'skills' },
    }),
});
