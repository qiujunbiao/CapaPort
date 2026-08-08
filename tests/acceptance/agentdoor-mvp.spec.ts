import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '../../adapters/claude-code/src/index.js';
import { createCodexAdapter } from '../../adapters/codex/src/index.js';
import type { CanonicalPackage, FilePlan, FileTransaction } from '../../packages/adapter-sdk/src/types.js';
import {
  buildArchive,
  diffPackages,
  extractArchive,
  hashPackage,
  type PackageFile,
  parseManifest,
} from '../../packages/capability-kit/src/index.js';
import { scanPackage } from '../../packages/security-scan/src/index.js';

const apiUrl = process.env.AGENTDOOR_API_URL ?? 'http://127.0.0.1:3210/api/v1';
const mailpitUrl = process.env.AGENTDOOR_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const stamp = process.env.AGENTDOOR_ACCEPTANCE_STAMP ?? `${Date.now()}`;
const password = `Agentdoor!${stamp}Aa9#`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Actor = { email: string; token: string; userId: string };
type Space = { id: string; type: string; name: string };
type Capability = { id: string; slug: string; name: string; compatibility: string[] };
type Publication = { id: string; status: string; publishedVersionId?: string };
type InstallPlan = {
  versionId: string;
  version: string;
  digest: string;
  adapter: string;
  download: { url: string; expiresIn: number };
};
type AuditEntry = { action: string; resourceId: string; metadata: Record<string, unknown> };

class LocalTransaction implements FileTransaction {
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { mode: 0o600 });
  }

  async removeFile(path: string): Promise<void> {
    await rm(path, { force: true });
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; expected?: number[] } = {},
): Promise<{ status: number; body: T; text: string }> {
  const { token, expected = [200, 201, 202, 204], ...requestOptions } = options;
  const method = (requestOptions.method ?? 'GET').toUpperCase();
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (token && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('idempotency-key')) {
    headers.set('idempotency-key', randomUUID());
  }
  const response = await fetch(`${apiUrl}${path}`, {
    ...requestOptions,
    method,
    headers,
  });
  const text = await response.text();
  if (!expected.includes(response.status))
    throw new Error(`${requestOptions.method ?? 'GET'} ${path}: ${response.status} ${text}`);
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T, text };
}

async function mailboxMessage(target: string, subjectPrefix: string): Promise<{ Subject: string; Snippet: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    const mailbox = (await response.json()) as {
      messages: Array<{ To: Array<{ Address: string }>; Subject: string; Snippet: string }>;
    };
    const message = mailbox.messages.find(
      (candidate) =>
        candidate.To.some((recipient) => recipient.Address === target) && candidate.Subject.startsWith(subjectPrefix),
    );
    if (message) return message;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Mail was not delivered to ${target}.`);
}

async function register(name: string): Promise<Actor> {
  const email = `${name}.${stamp}@example.com`;
  const registration = await request<{ challengeId: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ kind: 'email', target: email, password, displayName: name }),
  });
  const mail = await mailboxMessage(email, 'Agentdoor security code:');
  const code = /\b(\d{6})\b/.exec(mail.Subject)?.[1];
  if (!code) throw new Error('Verification code is missing.');
  await request('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId: registration.body.challengeId, code }),
  });
  const login = await request<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ kind: 'email', target: email, password, deviceName: 'MVP acceptance' }),
  });
  const me = await request<{ id: string }>('/auth/me', { token: login.body.accessToken });
  return { email, token: login.body.accessToken, userId: me.body.id };
}

async function invite(owner: Actor, organizationId: string, target: Actor): Promise<void> {
  await request(`/organizations/${organizationId}/invitations`, {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({ kind: 'email', target: target.email, role: 'member' }),
  });
  const mail = await mailboxMessage(target.email, 'Join ');
  const invitationToken = /token=([^\s]+)/.exec(mail.Snippet)?.[1];
  if (!invitationToken) throw new Error('Invitation token is missing.');
  await request('/organizations/invitations/accept', {
    token: target.token,
    method: 'POST',
    body: JSON.stringify({ token: invitationToken }),
  });
}

function manifestFile(pkg: CanonicalPackage): PackageFile {
  return { path: 'agentdoor.yaml', content: encoder.encode(JSON.stringify(pkg.manifest, null, 2)) };
}

async function completePackage(imported: CanonicalPackage, version: 1 | 2 | 3): Promise<CanonicalPackage> {
  const slug = imported.manifest.metadata.slug;
  const skillPath = `skills/${slug}/SKILL.md`;
  const files = imported.files
    .filter((file) => file.path !== 'agentdoor.yaml')
    .map((file) =>
      file.path === skillPath
        ? {
            ...file,
            content: encoder.encode(`---\nname: Release Guardian\n---\n\n# Version ${version}\nRun governed checks.\n`),
          }
        : file,
    );
  files.push(
    { path: `prompts/${slug}.md`, content: encoder.encode(`Review release risk for version ${version}.`) },
    { path: `context/${slug}.md`, content: encoder.encode('Architecture rules only. Business source is excluded.') },
  );
  const pkg: CanonicalPackage = {
    manifest: {
      ...imported.manifest,
      metadata: {
        ...imported.manifest.metadata,
        name: 'Release Guardian',
        description: 'Skill, prompt, and safe project context.',
        tags: ['release', 'governed'],
      },
      spec: {
        ...imported.manifest.spec,
        components: [
          { type: 'skill', path: `skills/${slug}` },
          { type: 'prompt', path: `prompts/${slug}.md` },
          { type: 'context', path: `context/${slug}.md` },
        ],
        compatibility: { agents: ['codex', 'claude-code'] },
        entrypoints: {
          default: skillPath,
          prompt: `prompts/${slug}.md`,
          context: `context/${slug}.md`,
        },
      },
    },
    files: [],
    digest: '',
  };
  pkg.files = [manifestFile(pkg), ...files];
  pkg.digest = await hashPackage(pkg.files);
  return pkg;
}

async function uploadPackage(actor: Actor, spaceId: string, pkg: CanonicalPackage): Promise<string> {
  const archive = buildArchive(pkg.files);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const plan = await request<{ uploadId: string; url: string; headers: Record<string, string> }>('/artifacts/uploads', {
    token: actor.token,
    method: 'POST',
    body: JSON.stringify({
      spaceId,
      fileName: `${pkg.manifest.metadata.slug}.zip`,
      contentType: 'application/zip',
      sizeBytes: archive.byteLength,
      sha256,
    }),
  });
  const uploaded = await fetch(plan.body.url, { method: 'PUT', headers: plan.body.headers, body: archive });
  if (!uploaded.ok) throw new Error(`Artifact upload failed: ${uploaded.status}`);
  return (
    await request<{ artifactId: string }>(`/artifacts/uploads/${plan.body.uploadId}/confirm`, {
      token: actor.token,
      method: 'POST',
    })
  ).body.artifactId;
}

async function submitVersion(
  actor: Actor,
  reviewer: Actor,
  capabilityId: string,
  draftId: string,
  organizationSpaceId: string,
  version: string,
): Promise<Publication> {
  const publication = await request<Publication>(`/capabilities/${capabilityId}/publications`, {
    token: actor.token,
    method: 'POST',
    headers: { 'idempotency-key': `acceptance-${version}-${stamp}` },
    body: JSON.stringify({ draftId, targetSpaceId: organizationSpaceId, version }),
  });
  expect(publication.body.status).toBe('in_review');
  const report = await request<{ blocked: boolean; findings: unknown[] }>(
    `/publications/${publication.body.id}/scan-report`,
    { token: reviewer.token },
  );
  expect(report.body).toMatchObject({ blocked: false, findings: [] });
  const approved = await request<Publication>(`/publications/${publication.body.id}/approve`, {
    token: reviewer.token,
    method: 'POST',
    body: JSON.stringify({ reason: `Reviewed ${version} package diff and clean scan.` }),
  });
  expect(approved.body.status).toBe('published');
  return approved.body;
}

async function downloadPackage(
  actor: Actor,
  deviceId: string,
  capabilityId: string,
  versionId: string,
): Promise<{
  pkg: CanonicalPackage;
  cloud: InstallPlan;
}> {
  const plan = await request<InstallPlan>('/distribution/install-plans', {
    token: actor.token,
    method: 'POST',
    body: JSON.stringify({ deviceId, capabilityId, versionId, agent: 'claude-code' }),
  });
  expect(plan.body).toMatchObject({ adapter: 'claude-code', download: { expiresIn: 120 } });
  const downloaded = await fetch(plan.body.download.url);
  expect(downloaded.ok).toBe(true);
  const files = extractArchive(new Uint8Array(await downloaded.arrayBuffer()));
  const manifestFile = files.find((file) => file.path === 'agentdoor.yaml');
  if (!manifestFile) throw new Error('Downloaded package is missing agentdoor.yaml.');
  const manifest = parseManifest(decoder.decode(manifestFile.content));
  const pkg = { manifest, files, digest: await hashPackage(files) };
  expect(pkg.digest).toBe(plan.body.digest);
  return { pkg, cloud: plan.body };
}

function localConflicts(plan: FilePlan, installed: FilePlan): Promise<string[]> {
  return Promise.all(
    plan.entries.map(async (entry) => {
      const current = await readFile(entry.destination).catch(() => undefined);
      const expected = installed.lock.files.find((file) => file.destination === entry.destination)?.digest;
      if (!current || !expected) return entry.relativePath;
      return createHash('sha256').update(current).digest('hex') === expected ? undefined : entry.relativePath;
    }),
  ).then((entries) => entries.filter((entry): entry is string => Boolean(entry)));
}

describe('Agentdoor MVP final acceptance', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'agentdoor-acceptance-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('completes the ten-step governed cross-Agent workflow without cross-tenant disclosure', async () => {
    const memberA = await register('member-a');
    const memberB = await register('member-b');
    const reviewer = await register('reviewer');
    const outsider = await register('outsider');

    // 1. Member A creates the organization and invites member B plus a separate reviewer.
    const organization = (
      await request<{ id: string }>('/organizations', {
        token: memberA.token,
        method: 'POST',
        body: JSON.stringify({ name: `Acceptance Org ${stamp}`, slug: `acceptance-${stamp}` }),
      })
    ).body;
    await invite(memberA, organization.id, memberB);
    await invite(memberA, organization.id, reviewer);
    const memberASpaces = (await request<Space[]>('/spaces', { token: memberA.token })).body;
    const personalSpace = memberASpaces.find((space) => space.type === 'personal');
    const organizationSpace = memberASpaces.find((space) => space.type === 'organization');
    if (!personalSpace || !organizationSpace) throw new Error('System spaces are unavailable.');
    await request(`/spaces/${organizationSpace.id}/members`, {
      token: memberA.token,
      method: 'POST',
      body: JSON.stringify({ userId: memberA.userId, role: 'contributor' }),
    });
    await request(`/spaces/${organizationSpace.id}/members`, {
      token: memberA.token,
      method: 'POST',
      body: JSON.stringify({ userId: reviewer.userId, role: 'reviewer' }),
    });

    // 2. The Codex adapter discovers a real local Skill and imports it into the canonical package model.
    const sourceProject = join(root, 'member-a-project');
    const codexRoot = join(sourceProject, '.agents');
    const slug = 'release-guardian';
    await mkdir(join(codexRoot, 'skills', slug), { recursive: true });
    await writeFile(
      join(codexRoot, 'skills', slug, 'SKILL.md'),
      '---\nname: Release Guardian\n---\n\n# Version 1\nRun governed checks.\n',
    );
    const codex = createCodexAdapter({
      homeDir: join(root, 'member-a-home'),
      projectRoot: sourceProject,
      platform: 'linux',
    });
    const codexInstallation = (await codex.detect()).find((candidate) => candidate.scope === 'workspace');
    if (!codexInstallation) throw new Error('Codex fixture was not detected.');
    const localSkill = (await codex.inventory(codexInstallation)).find((candidate) => candidate.slug === slug);
    if (!localSkill) throw new Error('Codex skill was not inventoried.');
    const imported = await codex.import(localSkill);
    const packageV1 = await completePackage(imported, 1);

    // 3. A client-side secret finding blocks upload; removing it produces a clean scan.
    const unsafeFiles = [
      ...packageV1.files,
      { path: 'context/secret.md', content: encoder.encode('key = AKIAIOSFODNN7EXAMPLE') },
    ];
    const blockedScan = await scanPackage(unsafeFiles);
    expect(blockedScan).toMatchObject({ blocked: true });
    expect(blockedScan.findings.some((finding) => finding.ruleId === 'SEC_AWS_ACCESS_KEY')).toBe(true);
    expect(JSON.stringify(blockedScan)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(await scanPackage(packageV1.files)).toMatchObject({ blocked: false, findings: [] });

    // 4. Skill, Prompt, and project context are uploaded to a personal draft and submitted to the organization.
    const artifactV1 = await uploadPackage(memberA, personalSpace.id, packageV1);
    const created = (
      await request<{ capability: Capability; draft: { id: string } }>('/capabilities', {
        token: memberA.token,
        method: 'POST',
        body: JSON.stringify({
          spaceId: personalSpace.id,
          slug,
          name: packageV1.manifest.metadata.name,
          description: packageV1.manifest.metadata.description,
          tags: packageV1.manifest.metadata.tags,
          compatibility: packageV1.manifest.spec.compatibility.agents,
        }),
      })
    ).body;
    await request(`/capabilities/${created.capability.id}/drafts/${created.draft.id}/revisions`, {
      token: memberA.token,
      method: 'POST',
      body: JSON.stringify({ artifactId: artifactV1 }),
    });

    // 5. The reviewer sees a clean server report and approves the immutable organization version.
    const publishedV1 = await submitVersion(
      memberA,
      reviewer,
      created.capability.id,
      created.draft.id,
      organizationSpace.id,
      '1.0.0',
    );
    if (!publishedV1.publishedVersionId) throw new Error('Version 1 was not published.');

    // 6. Member B searches the organization catalog and installs the canonical package into Claude Code.
    const visible = (
      await request<Capability[]>(`/capabilities?query=${encodeURIComponent(slug)}&agent=claude-code`, {
        token: memberB.token,
      })
    ).body;
    expect(visible.map((capability) => capability.id)).toContain(created.capability.id);
    const device = (
      await request<{ id: string }>('/devices', {
        token: memberB.token,
        method: 'POST',
        body: JSON.stringify({
          name: 'Member B workstation',
          platform: 'linux',
          appVersion: '0.1.0',
          supportedAgents: ['claude-code'],
        }),
      })
    ).body;
    const targetProject = join(root, 'member-b-project');
    await mkdir(join(targetProject, '.claude'), { recursive: true });
    const claude = createClaudeCodeAdapter({
      homeDir: join(root, 'member-b-home'),
      projectRoot: targetProject,
      platform: 'linux',
    });
    const claudeInstallation = (await claude.detect()).find((candidate) => candidate.scope === 'workspace');
    if (!claudeInstallation) throw new Error('Claude Code target was not detected.');
    const downloadedV1 = await downloadPackage(
      memberB,
      device.id,
      created.capability.id,
      publishedV1.publishedVersionId,
    );
    const planV1 = await claude.planInstall(downloadedV1.pkg, { installation: claudeInstallation });
    expect(await claude.validatePlan(planV1)).toEqual({ valid: true });
    await claude.apply(planV1, new LocalTransaction());
    const installationV1 = (
      await request<{ id: string }>('/installations', {
        token: memberB.token,
        method: 'POST',
        headers: { 'idempotency-key': `acceptance-install-v1-${stamp}` },
        body: JSON.stringify({
          deviceId: device.id,
          capabilityId: created.capability.id,
          versionId: publishedV1.publishedVersionId,
          agent: 'claude-code',
          outcome: 'installed',
        }),
      })
    ).body;
    expect(await readFile(join(targetProject, '.claude', 'skills', slug, 'SKILL.md'), 'utf8')).toContain('Version 1');

    // 7. A reviewed second version updates clean local files without conflict.
    const packageV2 = await completePackage(imported, 2);
    const artifactV2 = await uploadPackage(memberA, personalSpace.id, packageV2);
    const draftV2 = (
      await request<{ id: string }>(`/capabilities/${created.capability.id}/drafts`, {
        token: memberA.token,
        method: 'POST',
      })
    ).body;
    await request(`/capabilities/${created.capability.id}/drafts/${draftV2.id}/revisions`, {
      token: memberA.token,
      method: 'POST',
      body: JSON.stringify({ artifactId: artifactV2 }),
    });
    const publishedV2 = await submitVersion(
      memberA,
      reviewer,
      created.capability.id,
      draftV2.id,
      organizationSpace.id,
      '1.1.0',
    );
    if (!publishedV2.publishedVersionId) throw new Error('Version 2 was not published.');
    const cloudUpdate = await request<{ action: string; availableVersionId: string }>(
      `/installations/${installationV1.id}/update-check`,
      { token: memberB.token },
    );
    expect(cloudUpdate.body).toMatchObject({ action: 'update', availableVersionId: publishedV2.publishedVersionId });
    const downloadedV2 = await downloadPackage(
      memberB,
      device.id,
      created.capability.id,
      publishedV2.publishedVersionId,
    );
    const planV2 = await claude.planInstall(downloadedV2.pkg, { installation: claudeInstallation });
    expect(await localConflicts(planV2, planV1)).toEqual([]);
    await claude.apply(planV2, new LocalTransaction());
    await request('/installations', {
      token: memberB.token,
      method: 'POST',
      headers: { 'idempotency-key': `acceptance-update-v2-${stamp}` },
      body: JSON.stringify({
        deviceId: device.id,
        capabilityId: created.capability.id,
        versionId: publishedV2.publishedVersionId,
        agent: 'claude-code',
        outcome: 'installed',
      }),
    });
    const installedSkillPath = join(targetProject, '.claude', 'skills', slug, 'SKILL.md');
    expect(await readFile(installedSkillPath, 'utf8')).toContain('Version 2');

    // 8. A third update detects a local edit, refuses overwrite, exposes a diff/import option, and can restore v2.
    const installedV2Bytes = await readFile(installedSkillPath);
    await writeFile(installedSkillPath, `${installedV2Bytes.toString()}\nLocal member customization.\n`);
    const packageV3 = await completePackage(imported, 3);
    const artifactV3 = await uploadPackage(memberA, personalSpace.id, packageV3);
    const draftV3 = (
      await request<{ id: string }>(`/capabilities/${created.capability.id}/drafts`, {
        token: memberA.token,
        method: 'POST',
      })
    ).body;
    await request(`/capabilities/${created.capability.id}/drafts/${draftV3.id}/revisions`, {
      token: memberA.token,
      method: 'POST',
      body: JSON.stringify({ artifactId: artifactV3 }),
    });
    const publishedV3 = await submitVersion(
      memberA,
      reviewer,
      created.capability.id,
      draftV3.id,
      organizationSpace.id,
      '1.2.0',
    );
    if (!publishedV3.publishedVersionId) throw new Error('Version 3 was not published.');
    const downloadedV3 = await downloadPackage(
      memberB,
      device.id,
      created.capability.id,
      publishedV3.publishedVersionId,
    );
    const planV3 = await claude.planInstall(downloadedV3.pkg, { installation: claudeInstallation });
    const conflicts = await localConflicts(planV3, planV2);
    expect(conflicts).toContain(`skills/${slug}/SKILL.md`);
    expect(await readFile(installedSkillPath, 'utf8')).toContain('Local member customization');
    expect(diffPackages(packageV2.files, packageV3.files).modified).toContain(`skills/${slug}/SKILL.md`);
    const localClaudeSkill = (await claude.inventory(claudeInstallation)).find(
      (candidate) => candidate.componentType === 'skill' && candidate.slug === slug,
    );
    if (!localClaudeSkill) throw new Error('Modified local skill cannot be imported as a draft option.');
    const importedLocalDraft = await claude.import(localClaudeSkill);
    expect(importedLocalDraft.manifest.metadata.slug).toBe(slug);
    await writeFile(installedSkillPath, installedV2Bytes);
    expect(await localConflicts(planV3, planV2)).toEqual([]);

    // 9. Administrators can trace invite, submit, review/publish, download, install, and update-version records.
    const audit = (await request<{ entries: AuditEntry[] }>('/audit?limit=100', { token: memberA.token })).body.entries;
    const actions = audit.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'organization.invitation_created',
        'organization.invitation_accepted',
        'publication.submitted',
        'publication.approve',
        'capability.download_authorized',
        'installation.installed',
      ]),
    );
    const installedVersions = audit
      .filter((entry) => entry.action === 'installation.installed')
      .map((entry) => entry.metadata.versionId);
    expect(installedVersions).toEqual(
      expect.arrayContaining([publishedV1.publishedVersionId, publishedV2.publishedVersionId]),
    );

    // 10. A second organization cannot search, fetch, publish, download, or infer the first organization's resources.
    const secondOrganization = (
      await request<{ id: string }>('/organizations', {
        token: outsider.token,
        method: 'POST',
        body: JSON.stringify({ name: `Isolated Org ${stamp}`, slug: `isolated-${stamp}` }),
      })
    ).body;
    expect(secondOrganization.id).not.toBe(organization.id);
    const hiddenSearch = (
      await request<Capability[]>(`/capabilities?query=${encodeURIComponent(slug)}`, { token: outsider.token })
    ).body;
    expect(hiddenSearch).toEqual([]);
    for (const target of [
      `/capabilities/${created.capability.id}`,
      `/publications/${publishedV1.id}`,
      `/capabilities/${created.capability.id}/versions/${publishedV3.publishedVersionId}`,
    ]) {
      const denied = await request<{ code: string; message: string }>(target, {
        token: outsider.token,
        expected: [403, 404],
      });
      expect(['ACCESS_DENIED', 'TENANT_ACCESS_DENIED']).toContain(denied.body.code);
      expect(denied.text).not.toContain(slug);
      expect(denied.text).not.toContain('Release Guardian');
    }
    const foreignPlan = await request<{ code: string; message: string }>('/distribution/install-plans', {
      token: outsider.token,
      method: 'POST',
      expected: [403, 404],
      body: JSON.stringify({
        deviceId: randomUUID(),
        capabilityId: created.capability.id,
        versionId: publishedV3.publishedVersionId,
        agent: 'claude-code',
      }),
    });
    expect(['ACCESS_DENIED', 'TENANT_ACCESS_DENIED']).toContain(foreignPlan.body.code);
    expect(foreignPlan.text).not.toContain(slug);

    process.stdout.write(
      `acceptance=passed organization=${organization.id} capability=${created.capability.id} ` +
        `codex_discovery=true cloud_scan=true review=true claude_install=true update=true conflict=true audit=true tenant_isolation=true\n`,
    );
  });
});
