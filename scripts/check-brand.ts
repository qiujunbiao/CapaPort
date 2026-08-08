import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const forbidden = [
  ['agent', 'door'].join(''),
  ['agent', ' door'].join(''),
  ['agent', '-door'].join(''),
  ['agent', '_door'].join(''),
];
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot }).toString().split('\0').filter(Boolean);
const violations: string[] = [];

for (const file of tracked) {
  const contents = await readFile(resolve(repositoryRoot, file));
  if (contents.includes(0)) continue;
  const lower = contents.toString('utf8').toLowerCase();
  if (forbidden.some((value) => lower.includes(value))) violations.push(file);
}

if (violations.length) {
  process.stderr.write(`brand-check=failed files=${violations.join(',')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('brand-check=passed product=CapaPort\n');
}
