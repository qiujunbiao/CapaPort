import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { createCursorAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'Cursor',
  adapterId: 'cursor',
  supportedComponents: ['skill', 'prompt', 'context'],
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/cursor/home'),
  createAdapter: createCursorAdapter,
});
