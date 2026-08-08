import { resolve } from 'node:path';
import { defineAdapterComplianceSuite } from '@capaport/adapter-sdk/compliance';
import { describe, expect, it } from 'vitest';
import { createGeminiCliAdapter } from './index.js';

defineAdapterComplianceSuite({
  name: 'Gemini CLI',
  adapterId: 'gemini-cli',
  supportedComponents: ['skill', 'prompt'],
  fixtureHomeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/gemini-cli/home'),
  createAdapter: createGeminiCliAdapter,
});

describe('Gemini CLI native command format', () => {
  it('discovers TOML custom commands from the checked-in fixture', async () => {
    const adapter = createGeminiCliAdapter({
      homeDir: resolve(import.meta.dirname, '../../../tests/fixtures/agents/gemini-cli/home'),
      platform: 'darwin',
    });
    const installation = (await adapter.detect())[0];
    expect(installation).toBeDefined();
    if (!installation) throw new Error('Gemini fixture installation missing');

    const inventory = await adapter.inventory(installation);

    expect(inventory).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: 'review', componentType: 'prompt' })]),
    );
    const command = inventory.find((item) => item.slug === 'review' && item.componentType === 'prompt');
    expect(command).toBeDefined();
    if (!command) throw new Error('Gemini command fixture missing');
    expect(new TextDecoder().decode(command.files[0]?.content)).toBe(
      'Review the current change for correctness and security.',
    );
    const plan = await adapter.planInstall(await adapter.import(command), { installation });
    expect(plan.entries[0]?.relativePath).toBe('commands/review.toml');
    expect(new TextDecoder().decode(plan.entries[0]?.content)).toContain('prompt = "Review the current change');
  });
});
