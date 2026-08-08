import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const project = `capaport-smoke-${process.pid}-${Date.now()}`.toLowerCase();
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

function execute(command: string, args: string[], options: { input?: Buffer; capture?: boolean } = {}): Buffer {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: stackEnvironment,
    input: options.input,
    encoding: options.capture ? undefined : 'utf8',
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr?.toString().slice(-4_000) : '';
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
    );
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
}

function compose(args: string[], options?: { input?: Buffer; capture?: boolean }): Buffer {
  return execute('docker', ['compose', '-p', project, '-f', composeFile, ...args], options);
}

async function composeAsync(args: string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn('docker', ['compose', '-p', project, '-f', composeFile, ...args], {
      cwd: repositoryRoot,
      env: stackEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(`Compose exited with ${code}`))));
  });
}

async function waitForReady(apiBase: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/health/ready`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error('API readiness deadline expired.');
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
const scratch = await mkdtemp(join(tmpdir(), 'capaport-smoke-'));

try {
  execute('pnpm', ['--filter', '@capaport/capability-kit', 'build']);
  compose(['up', '-d', '--build', '--wait']);
  await waitForReady(apiBase);

  const apiContainer = compose(['ps', '-q', 'api'], { capture: true }).toString().trim();
  const image = execute('docker', ['inspect', '--format', '{{.Config.Image}}', apiContainer], { capture: true })
    .toString()
    .trim();
  const user = execute('docker', ['inspect', '--format', '{{.Config.User}}', apiContainer], { capture: true })
    .toString()
    .trim();
  const readOnly = execute('docker', ['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', apiContainer], {
    capture: true,
  })
    .toString()
    .trim();
  if (user !== '10001:10001' || readOnly !== 'true') throw new Error(`Container hardening failed: ${user}/${readOnly}`);
  const imageMetadata = execute('docker', ['image', 'inspect', image], { capture: true }).toString();
  for (const forbidden of [
    'capaport-jwt-development',
    'capaport-refresh-development',
    'capaport-verification-development',
  ]) {
    if (imageMetadata.includes(forbidden))
      throw new Error(`Image metadata contains embedded credential marker ${forbidden}.`);
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const scenarioEnvironment = {
    ...stackEnvironment,
    CAPAPORT_API_URL: apiBase,
    MAILPIT_URL: `http://127.0.0.1:${mailpitPort}`,
    CAPAPORT_E2E_STAMP: stamp,
  };
  const publication = spawnSync('node', ['apps/api/scripts/publication-real-e2e.mjs'], {
    cwd: repositoryRoot,
    env: scenarioEnvironment,
    stdio: 'inherit',
  });
  if (publication.status !== 0) throw new Error('Publication smoke scenario failed.');
  const distribution = spawnSync('node', ['apps/api/scripts/distribution-real-e2e.mjs'], {
    cwd: repositoryRoot,
    env: scenarioEnvironment,
    stdio: 'inherit',
  });
  if (distribution.status !== 0) throw new Error('Distribution smoke scenario failed.');

  const countsBefore = compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'capaport',
      '-d',
      'capaport',
      '-Atc',
      "SELECT (SELECT count(*) FROM audit_logs)||','||(SELECT count(*) FROM capabilities)||','||(SELECT count(*) FROM installations)",
    ],
    { capture: true },
  )
    .toString()
    .trim();
  const [auditCount, capabilityCount, installationCount] = countsBefore.split(',').map(Number);
  if (!auditCount || !capabilityCount || !installationCount)
    throw new Error(`Required records missing: ${countsBefore}`);

  const metrics = await fetch(`${apiBase}/metrics`, {
    headers: { authorization: 'Bearer capaport-development-metrics-token' },
  });
  if (!metrics.ok || !(await metrics.text()).includes('capaport_http_requests_total')) {
    throw new Error('Authenticated metrics endpoint failed.');
  }

  await Promise.all([composeAsync(['run', '--rm', 'migrate']), composeAsync(['run', '--rm', 'migrate'])]);

  const databaseDump = compose(
    ['exec', '-T', 'postgres', 'pg_dump', '-U', 'capaport', '-d', 'capaport', '-Fc', '--no-owner', '--no-acl'],
    { capture: true },
  );
  await writeFile(join(scratch, 'database.dump'), databaseDump, { mode: 0o600 });
  await writeFile(
    join(scratch, 'database.dump.sha256'),
    `${createHash('sha256').update(databaseDump).digest('hex')}\n`,
    {
      mode: 0o600,
    },
  );
  compose(['exec', '-T', 'postgres', 'createdb', '-U', 'capaport', 'capaport_restore']);
  compose(
    ['exec', '-T', 'postgres', 'pg_restore', '-U', 'capaport', '-d', 'capaport_restore', '--no-owner', '--no-acl'],
    { input: databaseDump },
  );
  const restoredCapabilities = Number(
    compose(
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'capaport',
        '-d',
        'capaport_restore',
        '-Atc',
        'SELECT count(*) FROM capabilities',
      ],
      { capture: true },
    )
      .toString()
      .trim(),
  );
  if (restoredCapabilities !== capabilityCount) throw new Error('Database restore count mismatch.');

  compose([
    'exec',
    '-T',
    'minio',
    'sh',
    '-c',
    'mc alias set local http://127.0.0.1:9000 capaport capaport-minio-development >/dev/null && mc mb --ignore-existing local/capaport-restore >/dev/null && mc mirror --overwrite local/capaport local/capaport-restore >/dev/null',
  ]);
  const objectCounts = compose(
    [
      'exec',
      '-T',
      'minio',
      'sh',
      '-c',
      'printf \'%s,%s\' "$(mc ls --recursive local/capaport | wc -l)" "$(mc ls --recursive local/capaport-restore | wc -l)"',
    ],
    { capture: true },
  )
    .toString()
    .trim();
  const [sourceObjects, restoredObjects] = objectCounts.split(',').map(Number);
  if (!sourceObjects || sourceObjects !== restoredObjects)
    throw new Error(`Object restore count mismatch: ${objectCounts}`);

  compose(['stop', '-t', '20', 'api', 'worker']);
  compose(['start', 'api', 'worker']);
  await waitForReady(apiBase);
  const countsAfter = compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'capaport',
      '-d',
      'capaport',
      '-Atc',
      "SELECT (SELECT count(*) FROM audit_logs)||','||(SELECT count(*) FROM capabilities)||','||(SELECT count(*) FROM installations)",
    ],
    { capture: true },
  )
    .toString()
    .trim();
  if (countsAfter !== countsBefore) throw new Error(`Persistence check failed: ${countsBefore} -> ${countsAfter}`);

  process.stdout.write(
    `stack-smoke=passed signup=true publish=true install_plan=true audit=${auditCount} restart=true ` +
      `database_restore=${restoredCapabilities} object_restore=${restoredObjects} migration_serialized=true\n`,
  );
} finally {
  if (!keep) compose(['down', '-v', '--remove-orphans']);
  await rm(scratch, { recursive: true, force: true });
  if (keep) process.stdout.write(`stack-smoke-kept project=${project} api=${apiBase}\n`);
}
