import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type CommandResult = { command: string; status: 'passed' | 'failed'; exitCode: number; durationMs: number };

const root = resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2);
const reportArgument = arguments_.indexOf('--report');
const reportPath = resolve(
  root,
  reportArgument >= 0 ? arguments_[reportArgument + 1] || 'reports/security-gate.json' : 'reports/security-gate.json',
);
const vitestReportPath = resolve(root, 'reports/security-gate.vitest.json');

function save(report: unknown): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (arguments_.includes('--probe-vulnerability')) {
  save({
    schemaVersion: 'capaport.io/security-gate/v1',
    generatedAt: new Date().toISOString(),
    status: 'failed',
    summary: { critical: 1, high: 0, medium: 0, low: 0, tests: 1, passed: 0, failed: 1 },
    findings: [
      { id: 'SECURITY_PROBE_VULNERABILITY', severity: 'critical', message: 'Intentional vulnerable fixture detected.' },
    ],
    commands: [],
  });
  process.exitCode = 2;
} else {
  mkdirSync(dirname(vitestReportPath), { recursive: true });
  const commands: CommandResult[] = [];
  const run = (command: string, args: string[]) => {
    const started = Date.now();
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const entry: CommandResult = {
      command: [command, ...args].join(' '),
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status ?? 1,
      durationMs: Date.now() - started,
    };
    commands.push(entry);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return entry;
  };

  const prerequisites = [
    run('pnpm', ['--filter', '@capaport/contracts', 'build']),
    run('pnpm', ['--filter', '@capaport/capability-kit', 'build']),
    run('pnpm', ['--filter', '@capaport/adapter-sdk', 'build']),
  ];
  if (prerequisites.every((command) => command.status === 'passed')) {
    const cargoAvailable = spawnSync('cargo', ['--version'], { cwd: root, stdio: 'ignore' }).status === 0;
    prerequisites.push(
      cargoAvailable
        ? run('cargo', ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'])
        : run('docker', [
            'run',
            '--rm',
            '-v',
            `${root}/apps/desktop/src-tauri:/app`,
            '-v',
            'capaport-cargo-registry:/usr/local/cargo/registry',
            '-w',
            '/app',
            'rust:1.89-slim-bookworm',
            'cargo',
            'test',
          ]),
    );
  }
  let vitest: CommandResult | undefined;
  if (prerequisites.every((command) => command.status === 'passed')) {
    vitest = run('pnpm', [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.security.config.ts',
      '--reporter=json',
      `--outputFile=${vitestReportPath}`,
    ]);
  }

  let testSummary = { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 };
  let failedTests: Array<{ name: string; message: string }> = [];
  try {
    const raw = JSON.parse(readFileSync(vitestReportPath, 'utf8'));
    testSummary = {
      numTotalTests: raw.numTotalTests ?? 0,
      numPassedTests: raw.numPassedTests ?? 0,
      numFailedTests: raw.numFailedTests ?? 0,
    };
    failedTests = (raw.testResults ?? [])
      .flatMap(
        (suite: { assertionResults?: Array<{ status?: string; fullName?: string; failureMessages?: string[] }> }) =>
          suite.assertionResults ?? [],
      )
      .filter((test: { status?: string }) => test.status === 'failed')
      .map((test: { fullName?: string; failureMessages?: string[] }) => ({
        name: test.fullName ?? 'unknown security test',
        message: (test.failureMessages?.[0] ?? 'Security assertion failed.').slice(0, 2_000),
      }));
  } catch {
    if (vitest)
      failedTests = [{ name: 'security test runner', message: 'Vitest did not produce a readable JSON report.' }];
  }

  const commandFailures = commands.filter((command) => command.status === 'failed');
  const high = failedTests.length + commandFailures.length;
  const report = {
    schemaVersion: 'capaport.io/security-gate/v1',
    generatedAt: new Date().toISOString(),
    status: high === 0 && vitest?.status === 'passed' ? 'passed' : 'failed',
    summary: {
      critical: 0,
      high,
      medium: 0,
      low: 0,
      tests: testSummary.numTotalTests,
      passed: testSummary.numPassedTests,
      failed: testSummary.numFailedTests,
    },
    coverage: [
      'tenant-resource-matrix',
      'archive-bombs-and-manifests',
      'path-traversal-and-symlinks',
      'auth-and-invitation-replay',
      'login-rate-limits',
      'upload-digest-races',
      'desktop-command-allowlist',
      'credential-redaction',
      'signed-https-updates',
      'file-transaction-rollback-faults',
    ],
    findings: [
      ...failedTests.map((finding) => ({ id: 'SECURITY_TEST_FAILED', severity: 'high', ...finding })),
      ...commandFailures.map((command) => ({
        id: 'SECURITY_COMMAND_FAILED',
        severity: 'high',
        message: `${command.command} exited with ${command.exitCode}.`,
      })),
    ],
    commands,
  };
  save(report);
  process.stdout.write(
    `Security gate: ${report.status}; ${report.summary.passed}/${report.summary.tests} tests passed; report=${reportPath}\n`,
  );
  if (report.status !== 'passed') process.exitCode = 1;
}
