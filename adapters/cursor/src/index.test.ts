import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { describe, expect, it } from 'vitest';
import { createCursorAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'Cursor',
  adapterId: 'cursor',
  supportedComponents: ['skill', 'prompt', 'context'],
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/cursor/home'),
  createAdapter: createCursorAdapter,
});

describe('Cursor native rule format', () => {
  it('discovers MDC rules from the checked-in fixture', async () => {
    const adapter = createCursorAdapter({
      homeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/cursor/home'),
      platform: 'darwin',
    });
    const installation = (await adapter.detect())[0];
    expect(installation).toBeDefined();
    if (!installation) throw new Error('Cursor fixture installation missing');

    const inventory = await adapter.inventory(installation);

    expect(inventory).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'security', componentType: 'context' })]),
    );
    const context = inventory.find((item) => item.slug === 'security' && item.componentType === 'context');
    expect(context).toBeDefined();
    if (!context) throw new Error('Cursor rule fixture missing');
    const plan = await adapter.planInstall(await adapter.import(context), { installation });
    expect(plan.entries[0]?.relativePath).toBe('rules/security.mdc');
    expect(new TextDecoder().decode(plan.entries[0]?.content)).toContain('alwaysApply: true');
  });
});
