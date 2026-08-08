import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type Artifact = { path: string; size: number; sha256: string; kind: 'file' | 'symlink' };

async function artifacts(root: string, directory = root): Promise<Artifact[]> {
  const output: Artifact[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const name = relative(root, path).split(sep).join('/');
    if (['SHA256SUMS', 'release-metadata.json'].includes(name)) continue;
    if (entry.isDirectory()) {
      output.push(...(await artifacts(root, path)));
      continue;
    }
    const stat = await lstat(path);
    const content = stat.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    output.push({
      path: name,
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
      kind: stat.isSymbolicLink() ? 'symlink' : 'file',
    });
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

export async function packageDesktopRelease(input: {
  root: string;
  platform: 'macos' | 'windows';
  arch: 'universal' | 'x86_64';
  version: string;
  commit: string;
  generatedAt?: string;
}): Promise<{ metadataPath: string; checksumsPath: string; artifacts: Artifact[] }> {
  const root = resolve(input.root);
  await mkdir(root, { recursive: true });
  const files = await artifacts(root);
  if (files.length === 0) throw new Error(`No desktop artifacts found in ${root}.`);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const metadataPath = resolve(root, 'release-metadata.json');
  const checksumsPath = resolve(root, 'SHA256SUMS');
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        schemaVersion: 'agentdoor.io/desktop-release/v1',
        product: 'Agentdoor',
        version: input.version,
        platform: input.platform,
        arch: input.arch,
        commit: input.commit,
        generatedAt,
        artifacts: files,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(checksumsPath, `${files.map((file) => `${file.sha256}  ${file.path}`).join('\n')}\n`);
  return { metadataPath, checksumsPath, artifacts: files };
}

function argument(name: string): string {
  const value = process.argv[process.argv.indexOf(name) + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageDesktopRelease({
    root: argument('--root'),
    platform: argument('--platform') as 'macos' | 'windows',
    arch: argument('--arch') as 'universal' | 'x86_64',
    version: argument('--version'),
    commit: argument('--commit'),
  });
}
