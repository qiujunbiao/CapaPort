import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { createGeminiCliAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'Gemini CLI',
  adapterId: 'gemini-cli',
  supportedComponents: ['skill', 'prompt'],
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/gemini-cli/home'),
  createAdapter: createGeminiCliAdapter,
});
