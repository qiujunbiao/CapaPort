import { describe, expect, it } from 'vitest';
import { CliOutput } from './output.js';

describe('machine readable output', () => {
  it('emits one JSON envelope without ANSI or human preview text', () => {
    const lines: string[] = [];
    const output = new CliOutput(true, { stdout: (value) => lines.push(value), stderr: (value) => lines.push(value) });
    output.notice('preview');
    output.data({ installed: true }, 'done');
    expect(lines).toEqual(['{"ok":true,"data":{"installed":true}}']);
  });
});
