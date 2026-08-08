import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

async function files(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else output.push(path);
  }
  return output;
}

function select(paths: string[], platform: 'macos' | 'windows'): string {
  const candidates = paths.filter(
    (path) =>
      !path.endsWith('.sig') &&
      (platform === 'macos' ? path.endsWith('.app.tar.gz') : /\.(nsis|msi)\.zip$/.test(path)) &&
      paths.includes(`${path}.sig`),
  );
  const candidate = candidates[0];
  if (candidates.length !== 1 || !candidate)
    throw new Error(`Expected one signed ${platform} updater, found ${candidates.length}.`);
  return candidate;
}

export async function createUpdaterManifest(input: {
  root: string;
  version: string;
  repository: string;
  tag: string;
  output: string;
  notes?: string;
  publishedAt?: string;
}): Promise<void> {
  const all = await files(resolve(input.root));
  const mac = select(all, 'macos');
  const windows = select(all, 'windows');
  const releaseUrl = `https://github.com/${input.repository}/releases/download/${input.tag}`;
  const entry = async (path: string) => ({
    signature: (await readFile(`${path}.sig`, 'utf8')).trim(),
    url: `${releaseUrl}/${encodeURIComponent(basename(path))}`,
  });
  const macEntry = await entry(mac);
  await writeFile(
    resolve(input.output),
    `${JSON.stringify(
      {
        version: input.version,
        notes: input.notes ?? `Agentdoor ${input.version}`,
        pub_date: input.publishedAt ?? new Date().toISOString(),
        platforms: {
          'darwin-aarch64': macEntry,
          'darwin-x86_64': macEntry,
          'windows-x86_64': await entry(windows),
        },
      },
      null,
      2,
    )}\n`,
  );
}
