import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { createWorkBuddyAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'WorkBuddy',
  adapterId: 'workbuddy',
  supportedComponents: ['skill'],
  supportedScopes: ['user', 'workspace'],
  roots: { user: '.workbuddy', workspace: '.codebuddy' },
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/workbuddy/home'),
  fixtureExpectedFiles: ['SKILL.md', 'assets/template.md', 'references/release.md', 'scripts/check.sh'],
  createAdapter: createWorkBuddyAdapter,
});
