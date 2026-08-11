import { spawnSync } from 'node:child_process';

type CommandResult = {
  ok: boolean;
  output: string;
};

function command(commandName: string, args: string[]): CommandResult {
  const result = spawnSync(commandName, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    output: (result.stdout || result.stderr || '').trim(),
  };
}

function hasSupportedNodeVersion(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

const errors: string[] = [];
const nodeVersion = process.versions.node;
if (!hasSupportedNodeVersion(nodeVersion)) {
  errors.push(`Node.js ${nodeVersion} is unsupported; install Node.js 22.12 or newer.`);
}

const pnpm = command('pnpm', ['--version']);
if (!pnpm.ok) {
  errors.push('pnpm is unavailable; run `corepack enable` and ensure the pnpm executable is in PATH.');
}

const cargo = command('cargo', ['--version']);
if (!cargo.ok) {
  errors.push(
    'Cargo is unavailable; install Rust from https://rustup.rs, then run `source "$HOME/.cargo/env"` or add `$HOME/.cargo/bin` to PATH.',
  );
}

const rustc = command('rustc', ['--version']);
if (!rustc.ok) {
  errors.push('rustc is unavailable; install the Rust stable toolchain with rustup.');
}

let xcode = { ok: true, output: 'not-required' };
if (process.platform === 'darwin') {
  xcode = command('xcode-select', ['-p']);
  if (!xcode.ok) {
    errors.push('Xcode Command Line Tools are unavailable; run `xcode-select --install`.');
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.map((error) => `desktop-doctor: ${error}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `desktop-doctor=passed node=${nodeVersion} pnpm=${pnpm.output} cargo=${cargo.output} rustc=${rustc.output} xcode=${xcode.output}\n`,
  );
}
