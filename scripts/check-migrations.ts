import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

interface MigrationJournal {
  entries: Array<{ idx: number; tag: string; when: number }>;
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const migrationsDirectory = resolve(repositoryRoot, 'apps/api/migrations');
const journalPath = resolve(migrationsDirectory, 'meta/_journal.json');
const sqlTags = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => basename(file, '.sql'))
  .sort();
const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal;
const journalTags = journal.entries.map((entry) => entry.tag);
const missingFromJournal = sqlTags.filter((tag) => !journalTags.includes(tag));
const missingSql = journalTags.filter((tag) => !sqlTags.includes(tag));
const invalidIndexes = journal.entries
  .filter((entry, index) => entry.idx !== index)
  .map((entry) => `${entry.tag}:${entry.idx}`);
const nonIncreasingTimestamps = journal.entries
  .filter((entry, index, entries) => {
    const previous = entries[index - 1];
    return previous !== undefined && entry.when <= previous.when;
  })
  .map((entry) => entry.tag);

if (missingFromJournal.length || missingSql.length || invalidIndexes.length || nonIncreasingTimestamps.length) {
  process.stderr.write(
    [
      'migration-check=failed',
      `missing-from-journal=${missingFromJournal.join(',') || 'none'}`,
      `missing-sql=${missingSql.join(',') || 'none'}`,
      `invalid-indexes=${invalidIndexes.join(',') || 'none'}`,
      `non-increasing-timestamps=${nonIncreasingTimestamps.join(',') || 'none'}`,
    ].join(' '),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`migration-check=passed count=${sqlTags.length}\n`);
}
