import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClaudeCodeAdapter } from '@capaport/adapter-claude-code';
import { createCodexAdapter } from '@capaport/adapter-codex';
import { createCursorAdapter } from '@capaport/adapter-cursor';
import { createGeminiCliAdapter } from '@capaport/adapter-gemini-cli';
import type { AgentAdapter, FileTransaction } from '@capaport/adapter-sdk';

export function adapters(): Record<string, AgentAdapter> {
  return {
    codex: createCodexAdapter(),
    'claude-code': createClaudeCodeAdapter(),
    cursor: createCursorAdapter(),
    'gemini-cli': createGeminiCliAdapter(),
  };
}

export class AtomicFileTransaction implements FileTransaction {
  private readonly backups = new Map<string, Uint8Array | undefined>();
  async writeFile(path: string, content: Uint8Array) {
    if (!this.backups.has(path))
      this.backups.set(
        path,
        await readFile(path).then(
          (value) => new Uint8Array(value),
          () => undefined,
        ),
      );
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.capaport-${process.pid}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, path);
  }
  async removeFile(path: string) {
    if (!this.backups.has(path))
      this.backups.set(
        path,
        await readFile(path).then(
          (value) => new Uint8Array(value),
          () => undefined,
        ),
      );
    await rm(path, { force: true });
  }
  async rollback() {
    for (const [path, content] of [...this.backups.entries()].reverse()) {
      if (content) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      } else await rm(path, { force: true });
    }
  }
}
