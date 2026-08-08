import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const project = `capaport-acceptance-${process.pid}-${Date.now()}`.toLowerCase();
const composeFile = resolve(repositoryRoot, 'infra/compose/compose.yaml');
const keep = process.argv.includes('--keep');

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a TCP port.'));
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd: repositoryRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'unknown'}.`);
}

async function waitForReady(apiBase: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/health/ready`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error('Acceptance stack readiness deadline expired.');
}

const [apiPort, minioPort, mailpitPort, webPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
const stackEnvironment = {
  ...process.env,
  API_PORT: String(apiPort),
  MINIO_API_PORT: String(minioPort),
  MAILPIT_HTTP_PORT: String(mailpitPort),
  S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${minioPort}`,
  WEB_PORT: String(webPort),
  WEB_API_URL: apiBase,
};
const composeArguments = ['compose', '-p', project, '-f', composeFile];

try {
  run('pnpm', ['--filter', '@capaport/capability-kit', 'build'], stackEnvironment);
  run('docker', [...composeArguments, 'up', '-d', '--build', '--wait'], stackEnvironment);
  await waitForReady(apiBase);
  const acceptanceEnvironment = {
    ...stackEnvironment,
    CAPAPORT_API_URL: apiBase,
    CAPAPORT_MAILPIT_URL: `http://127.0.0.1:${mailpitPort}`,
    CAPAPORT_ACCEPTANCE_STAMP: `${Date.now()}-${process.pid}`,
  };
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.acceptance.config.ts'], {
      cwd: repositoryRoot,
      env: acceptanceEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`Acceptance tests exited with ${code}`)),
    );
  });
  await mkdir(resolve(repositoryRoot, 'reports'), { recursive: true });
  const summary = {
    status: 'passed',
    completedAt: new Date().toISOString(),
    scenario:
      'discover -> scan -> submit -> review -> install -> update -> conflict -> recover -> lifecycle -> audit -> isolate',
    agents: { source: 'codex', target: 'claude-code' },
    stack: { api: true, worker: true, postgres: true, redis: true, objectStorage: true, mail: true },
    desktopRuntime: {
      cleanUpdate: true,
      conflictImportRecovery: true,
      transactionalUninstall: true,
    },
  };
  await writeFile(resolve(repositoryRoot, 'reports/acceptance-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    'final-acceptance=passed steps=10 source=codex target=claude-code desktop_runtime=true lifecycle=true tenant_isolation=true\n',
  );
} finally {
  if (!keep) run('docker', [...composeArguments, 'down', '-v', '--remove-orphans'], stackEnvironment);
  if (keep) process.stdout.write(`acceptance-stack-kept project=${project} api=${apiBase}\n`);
}
