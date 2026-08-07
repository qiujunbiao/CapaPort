import { describe, expect, it } from 'vitest';
import { parseArgv, stringFlag, UsageError } from './parser.js';

describe('CLI argument parser', () => {
  it('parses commands, values, booleans and short confirmation flags', () => {
    expect(parseArgv(['install', 'release-helper', '--agent=codex', '--scope', 'workspace', '-y', '--json'])).toEqual({
      command: 'install',
      subcommand: 'release-helper',
      positionals: [],
      flags: { agent: 'codex', scope: 'workspace', yes: true, json: true },
    });
  });
  it('uses a stable usage error for missing required values', () => {
    expect(() => stringFlag(parseArgv(['publish']), 'slug', true)).toThrowError(UsageError);
  });
});
