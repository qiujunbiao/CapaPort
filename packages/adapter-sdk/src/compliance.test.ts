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
