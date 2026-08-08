import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Options = {
  registry: string;
  version: string;
  revision: string;
  source: string;
  platforms: string;
  mode: '--push' | '--load';
  scan: boolean;
};

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
  return result.stdout.trim();
}

function options(): Options {
  const registry = valueAfter('--registry') ?? process.env.CAPAPORT_REGISTRY ?? '';
  const version = valueAfter('--version') ?? process.env.npm_package_version ?? '';
  const revision = valueAfter('--revision') ?? capture('git', ['rev-parse', 'HEAD']);
  const source = valueAfter('--source') ?? 'https://github.com/capaport/capaport';
  const platforms = valueAfter('--platform') ?? 'linux/amd64,linux/arm64';
  const load = process.argv.includes('--load');
  if (!registry || registry.includes('://') || registry.endsWith('/')) throw new Error('Provide a valid --registry.');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || version === 'latest') {
    throw new Error('Image version must be an immutable semantic version and cannot be latest.');
  }
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Revision must be a full 40-character Git SHA.');
  if (load && platforms.includes(',')) throw new Error('--load supports exactly one platform.');
  return {
    registry,
    version,
    revision,
    source,
    platforms,
    mode: load ? '--load' : '--push',
    scan: !process.argv.includes('--skip-scan'),
  };
}

function scanImage(image: string): void {
  if (spawnSync('trivy', ['--version'], { stdio: 'ignore' }).status === 0) {
    run('trivy', ['image', '--exit-code', '1', '--severity', 'HIGH,CRITICAL', '--ignore-unfixed', image]);
    return;
  }
  if (spawnSync('docker', ['scout', 'version'], { stdio: 'ignore' }).status === 0) {
    run('docker', ['scout', 'cves', '--exit-code', '--only-severity', 'critical,high', image]);
    return;
  }
  throw new Error('No vulnerability scanner found. Install Trivy or Docker Scout, or explicitly use --skip-scan.');
}

const configuration = options();
const tag = `${configuration.version}-${configuration.revision.slice(0, 12)}`;
const images: Record<string, string> = {};

for (const target of ['api', 'worker', 'migrate'] as const) {
  const image = `${configuration.registry}/capaport-${target}:${tag}`;
  run('docker', [
    'buildx',
    'build',
    '--file',
    'infra/docker/backend.Dockerfile',
    '--target',
    target,
    '--platform',
    configuration.platforms,
    '--build-arg',
    `VERSION=${configuration.version}`,
    '--build-arg',
    `REVISION=${configuration.revision}`,
    '--build-arg',
    `SOURCE=${configuration.source}`,
    ...(configuration.mode === '--push' ? ['--sbom=true', '--provenance=mode=max'] : []),
    '--tag',
    image,
    configuration.mode,
    '.',
  ]);
  if (configuration.scan) scanImage(image);
  images[target] = image;
}

await mkdir(resolve('reports'), { recursive: true });
await writeFile(
  resolve('reports/images.json'),
  `${JSON.stringify({ tag, revision: configuration.revision, platforms: configuration.platforms, images }, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({ tag, images })}\n`);
