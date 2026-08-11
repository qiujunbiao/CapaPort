import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { createQwenWorkAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'QwenWork',
  adapterId: 'qwenwork',
  supportedComponents: ['skill'],
  supportedScopes: ['user'],
  roots: { user: '.qwenworkcn' },
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/qwenwork/home'),
  fixtureExpectedFiles: ['SKILL.md', 'assets/template.md', 'references/release.md', 'scripts/check.sh'],
  createAdapter: createQwenWorkAdapter,
});
