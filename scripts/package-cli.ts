import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const source = resolve(repositoryRoot, 'apps/cli/dist/capaport.mjs');
const outputDirectory = resolve(repositoryRoot, 'artifacts');
const output = resolve(outputDirectory, 'capaport-cli.mjs');

await mkdir(outputDirectory, { recursive: true });
await copyFile(source, output);
await chmod(output, 0o755);
const digest = createHash('sha256')
  .update(await readFile(output))
  .digest('hex');
await writeFile(resolve(outputDirectory, 'capaport-cli.mjs.sha256'), `${digest}  capaport-cli.mjs\n`, {
  mode: 0o644,
});
process.stdout.write(`cli-artifact=${output} sha256=${digest}\n`);
