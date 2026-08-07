import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OrganizationSummary, SpaceSummary } from '@agentdoor/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '../../../src/client.js';
import { MemoryCredentialStore } from '../../../src/credentials.js';
import { runCli } from '../../../src/main.js';

const apiUrl = process.env.AGENTDOOR_API_URL ?? 'http://127.0.0.1:3210/api/v1';
const mailpitUrl = process.env.AGENTDOOR_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const password = 'Agentdoor!2026-Test';

async function json<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
  return payload;
}

async function verificationCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const mailbox = await json<{ messages: Array<{ To: Array<{ Address: string }>; Subject: string }> }>(
      await fetch(`${mailpitUrl}/api/v1/messages`),
    );
    const message = mailbox.messages.find((item) => item.To.some((target) => target.Address === email));
    const code = message ? /\b(\d{6})\b/.exec(message.Subject)?.[1] : undefined;
    if (code) return code;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('Verification email was not delivered.');
}

describe('CLI against the containerized Agentdoor API', () => {
  let workspace = '';
  let previousCwd = '';
  const credentials = new MemoryCredentialStore();
  const outputLines: string[] = [];
  const writer = {
    stdout: (value: string) => outputLines.push(value),
    stderr: (value: string) => outputLines.push(value),
  };
  const prompt = { ask: async () => '', confirm: async () => true };
  const stamp = `${Date.now()}`;
  const email = `cli-e2e-${stamp}@example.com`;
  const slug = 'cli-release-test';

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agentdoor-cli-e2e-'));
    previousCwd = process.cwd();
    process.chdir(workspace);
    const registration = await json<{ challengeId: string }>(
      await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'email', target: email, password, displayName: 'CLI E2E' }),
      }),
    );
    await json(
      await fetch(`${apiUrl}/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: registration.challengeId, code: await verificationCode(email) }),
      }),
    );
  });

  afterAll(async () => {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  });

  it('logs in, publishes, installs, checks and applies an update', async () => {
    expect(
      await runCli(['auth', 'login', '--target', email, '--password', password, '--json', '--api', apiUrl], {
        credentials,
        writer,
        prompt,
      }),
    ).toBe(0);
    const api = new ApiClient(apiUrl, credentials);
    const organization = await api.request<OrganizationSummary>('/organizations', {
      method: 'POST',
      body: { name: `CLI Team ${stamp}`, slug: `cli-team-${stamp}` },
    });
    expect(
      await runCli(['org', 'use', '--id', organization.id, '--json', '--api', apiUrl], {
        credentials,
        writer,
        prompt,
      }),
    ).toBe(0);
    const spaces = await api.request<SpaceSummary[]>('/spaces');
    const personal = spaces.find((space) => space.type === 'personal');
    if (!personal) throw new Error('Personal space was not provisioned.');
    const skillRoot = join(workspace, '.agents', 'skills', slug);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), `---\nname: CLI Release\n---\n\n# Version 1\n`);

    const publishV1 = await runCli(
      [
        'publish',
        '--slug',
        slug,
        '--agent',
        'codex',
        '--scope',
        'workspace',
        '--space',
        personal.id,
        '--target-space',
        personal.id,
        '--version',
        '1.0.0',
        '--yes',
        '--json',
        '--api',
        apiUrl,
      ],
      { credentials, writer, prompt },
    );
    expect(publishV1, outputLines.at(-1)).toBe(0);
    expect(await runCli(['search', slug, '--json', '--api', apiUrl], { credentials, writer, prompt })).toBe(0);
    const pulledArchive = join(workspace, `${slug}.zip`);
    expect(
      await runCli(['pull', slug, '--output', pulledArchive, '--yes', '--json', '--api', apiUrl], {
        credentials,
        writer,
        prompt,
      }),
    ).toBe(0);
    expect((await readFile(pulledArchive)).byteLength).toBeGreaterThan(100);
    await rm(skillRoot, { recursive: true, force: true });
    expect(
      await runCli(['install', slug, '--agent', 'codex', '--scope', 'workspace', '--yes', '--json', '--api', apiUrl], {
        credentials,
        writer,
        prompt,
      }),
    ).toBe(0);
    expect(await readFile(join(skillRoot, 'SKILL.md'), 'utf8')).toContain('Version 1');

    await writeFile(join(skillRoot, 'SKILL.md'), `---\nname: CLI Release\n---\n\n# Version 2\n`);
    expect(
      await runCli(
        [
          'publish',
          '--slug',
          slug,
          '--agent',
          'codex',
          '--scope',
          'workspace',
          '--space',
          personal.id,
          '--target-space',
          personal.id,
          '--version',
          '1.1.0',
          '--yes',
          '--json',
          '--api',
          apiUrl,
        ],
        { credentials, writer, prompt },
      ),
    ).toBe(0);
    expect(await runCli(['sync', '--json', '--api', apiUrl], { credentials, writer, prompt })).toBe(0);
    expect(outputLines.some((line) => line.includes('"action":"update"'))).toBe(true);
    expect(
      await runCli(
        [
          'install',
          slug,
          '--agent',
          'codex',
          '--scope',
          'workspace',
          '--version',
          '1.1.0',
          '--force',
          '--yes',
          '--json',
          '--api',
          apiUrl,
        ],
        { credentials, writer, prompt },
      ),
    ).toBe(0);
    expect(await readFile(join(skillRoot, 'SKILL.md'), 'utf8')).toContain('Version 2');
  });
});
