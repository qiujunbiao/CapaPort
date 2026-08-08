import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { createClaudeCodeAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'Claude Code',
  adapterId: 'claude-code',
  supportedComponents: ['skill', 'prompt', 'context'],
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/claude-code/home'),
  createAdapter: createClaudeCodeAdapter,
});
