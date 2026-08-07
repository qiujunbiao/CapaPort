import { describe, expect, it } from 'vitest';
import { CancelledError } from './parser.js';
import type { Prompter } from './prompt.js';

describe('destructive confirmation', () => {
  it('uses a cancellation error when confirmation is declined', async () => {
    const prompt: Prompter = { ask: async () => '', confirm: async () => false };
    if (!(await prompt.confirm('write')))
      await expect(Promise.reject(new CancelledError('cancelled'))).rejects.toMatchObject({ exitCode: 6 });
  });
});
