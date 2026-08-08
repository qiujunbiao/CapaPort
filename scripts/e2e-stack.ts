import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const composeFile = resolve(repositoryRoot, 'infra/compose/compose.yaml');
const project = `capaport-e2e-${process.pid}-${Date.now()}`.toLowerCase();

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a TCP port.'));
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
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
      if ((await fetch(`${apiBase}/health/ready`)).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error('End-to-end stack readiness deadline expired.');
}

const [apiPort, minioPort, mailpitPort, webPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
const environment = {
  ...process.env,
  API_PORT: String(apiPort),
  MINIO_API_PORT: String(minioPort),
  MAILPIT_HTTP_PORT: String(mailpitPort),
  S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${minioPort}`,
  WEB_PORT: String(webPort),
  WEB_API_URL: apiBase,
  CAPAPORT_API_URL: apiBase,
  CAPAPORT_MAILPIT_URL: `http://127.0.0.1:${mailpitPort}`,
};
const compose = ['compose', '-p', project, '-f', composeFile];

try {
  run('pnpm', ['--filter', '@capaport/cli...', 'build'], environment);
  run('docker', [...compose, 'up', '-d', '--build', '--wait'], environment);
  await waitForReady(apiBase);
  run('pnpm', ['--filter', '@capaport/cli', 'test:e2e'], environment);
  run('pnpm', ['--filter', '@capaport/web', 'test:e2e'], environment);
  run('pnpm', ['--filter', '@capaport/desktop', 'test:e2e'], environment);
  process.stdout.write('e2e-stack=passed cli=true web=true desktop=true\n');
} finally {
  run('docker', [...compose, 'down', '-v', '--remove-orphans'], environment);
}
