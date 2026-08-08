import { createHash } from 'node:crypto';
import { buildArchive, extractArchive } from '@capaport/capability-kit';
import { describe, expect, it } from 'vitest';

const apiUrl = process.env.CAPAPORT_API_URL ?? 'http://127.0.0.1:3210/api/v1';
const mailpitUrl = process.env.CAPAPORT_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const password = 'CapaPort!2026-Project';

async function json<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
  return payload;
}
function writeHeaders(headers: Record<string, string>) {
  return { ...headers, 'idempotency-key': crypto.randomUUID() };
}
async function verificationCode(email: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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

describe.skipIf(process.env.CAPAPORT_COMPOSE_E2E !== '1')('project context against Compose', () => {
  it('uploads only selected context and never sends the device absolute path', async () => {
    const stamp = Date.now();
    const email = `project-e2e-${stamp}@example.com`;
    const registration = await json<{ challengeId: string }>(
      await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'email', target: email, password, displayName: 'Project E2E' }),
      }),
    );
    await json(
      await fetch(`${apiUrl}/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: registration.challengeId, code: await verificationCode(email) }),
      }),
    );
    const session = await json<{ accessToken: string }>(
      await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'email', target: email, password, deviceName: 'Project E2E' }),
      }),
    );
    const authorization = { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };
    const organization = await json<{ id: string }>(
      await fetch(`${apiUrl}/organizations`, {
        method: 'POST',
        headers: writeHeaders(authorization),
        body: JSON.stringify({ name: `Project Team ${stamp}`, slug: `project-team-${stamp}` }),
      }),
    );
    const headers = { ...authorization, 'x-organization-id': organization.id };
    const readHeaders = { authorization: authorization.authorization, 'x-organization-id': organization.id };
    const project = await json<{ id: string }>(
      await fetch(`${apiUrl}/spaces`, {
        method: 'POST',
        headers: writeHeaders(headers),
        body: JSON.stringify({
          type: 'project',
          name: 'Payments',
          slug: `payments-${stamp}`,
          reviewPolicy: 'required',
        }),
      }),
    );
    const device = await json<{ id: string }>(
      await fetch(`${apiUrl}/devices`, {
        method: 'POST',
        headers: writeHeaders(headers),
        body: JSON.stringify({
          name: 'Project Mac',
          platform: 'macos',
          appVersion: '0.1.0',
          supportedAgents: ['codex', 'claude-code'],
        }),
      }),
    );
    const localBindingId = crypto.randomUUID();
    const bindingBody = JSON.stringify({
      deviceId: device.id,
      localBindingId,
      agents: ['codex', 'claude-code'],
    });
    expect(bindingBody).not.toContain('/private/customer/payments');
    const binding = await json<{ id: string }>(
      await fetch(`${apiUrl}/projects/${project.id}/bindings`, {
        method: 'POST',
        headers: writeHeaders(headers),
        body: bindingBody,
      }),
    );

    const selected = new TextEncoder().encode('# Project rules\nNever expose credentials.');
    const selectionDigest = 'b'.repeat(64);
    const archive = buildArchive([
      {
        path: 'context.json',
        content: new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: 'capaport.io/project-context/v1',
            localBindingId,
            selectionDigest,
            fileCount: 1,
            totalBytes: selected.byteLength,
            agents: ['codex', 'claude-code'],
            scan: { status: 'passed', engineVersion: 'project-context-1.0.0' },
          }),
        ),
      },
      { path: 'context/README.md', content: selected },
    ]);
    const digest = createHash('sha256').update(archive).digest('hex');
    const upload = await json<{
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    }>(
      await fetch(`${apiUrl}/artifacts/uploads`, {
        method: 'POST',
        headers: writeHeaders(headers),
        body: JSON.stringify({
          spaceId: project.id,
          fileName: 'project-context.zip',
          contentType: 'application/zip',
          sizeBytes: archive.byteLength,
          sha256: digest,
        }),
      }),
    );
    const uploaded = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: archive });
    expect(uploaded.ok).toBe(true);
    const artifact = await json<{ artifactId: string }>(
      await fetch(`${apiUrl}/artifacts/uploads/${upload.uploadId}/confirm`, {
        method: 'POST',
        headers: writeHeaders(readHeaders),
      }),
    );
    const contextBody = JSON.stringify({
      bindingId: binding.id,
      artifactId: artifact.artifactId,
      digest,
      selectionDigest,
      fileCount: 1,
      totalBytes: selected.byteLength,
      agents: ['codex', 'claude-code'],
      scan: { status: 'passed', engineVersion: 'project-context-1.0.0', scannedAt: new Date().toISOString() },
    });
    expect(contextBody).not.toContain('/private/customer/payments');
    expect(contextBody).not.toContain('src/unselected.ts');
    const context = await json<{ id: string }>(
      await fetch(`${apiUrl}/projects/${project.id}/contexts`, {
        method: 'POST',
        headers: writeHeaders(headers),
        body: contextBody,
      }),
    );
    const download = await json<{ url: string; digest: string }>(
      await fetch(`${apiUrl}/projects/${project.id}/contexts/${context.id}/download`, { headers: readHeaders }),
    );
    expect(download.digest).toBe(digest);
    const downloaded = new Uint8Array(await (await fetch(download.url)).arrayBuffer());
    const files = extractArchive(downloaded).map((file) => file.path);
    expect(files).toContain('context/README.md');
    expect(files).not.toContain('context/src/unselected.ts');
  });
});
