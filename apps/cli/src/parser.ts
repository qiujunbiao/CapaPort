export type ParsedCommand = {
  command?: string;
  subcommand?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgv(argv: string[]): ParsedCommand {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (argument === '-y') {
      flags.yes = true;
      continue;
    }
    if (argument === '-j') {
      flags.json = true;
      continue;
    }
    if (argument.startsWith('--')) {
      const separator = argument.indexOf('=');
      if (separator > 2) {
        flags[argument.slice(2, separator)] = argument.slice(separator + 1);
        continue;
      }
      const name = argument.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        flags[name] = next;
        index += 1;
      } else flags[name] = true;
      continue;
    }
    positionals.push(argument);
  }
  return {
    ...(positionals[0] ? { command: positionals[0] } : {}),
    ...(positionals[1] ? { subcommand: positionals[1] } : {}),
    positionals: positionals.slice(2),
    flags,
  };
}

export function stringFlag(parsed: ParsedCommand, name: string, required = false): string | undefined {
  const value = parsed.flags[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) throw new UsageError(`缺少必填参数 --${name}`);
  return undefined;
}

export class UsageError extends Error {
  readonly exitCode = 2;
}
export class AuthError extends Error {
  readonly exitCode = 3;
}
export class NetworkError extends Error {
  readonly exitCode = 4;
}
export class ConflictError extends Error {
  readonly exitCode = 5;
}
export class CancelledError extends Error {
  readonly exitCode = 6;
}
