import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@agentdoor/adapter-sdk/compliance';
import { createCodexAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'Codex',
  adapterId: 'codex',
  supportedComponents: ['skill'],
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/codex/home'),
  createAdapter: createCodexAdapter,
});
