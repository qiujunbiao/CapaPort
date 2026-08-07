import type { AgentId, ArtifactUploadPlan, CapabilitySummary } from '@agentdoor/contracts';
import { scanPackage } from '@agentdoor/security-scan';
import { adapters } from '../adapters.js';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';
import { archivePackage, archiveSha256 } from '../package.js';
import { CancelledError, type ParsedCommand, stringFlag, UsageError } from '../parser.js';
import type { Prompter } from '../prompt.js';

export async function publishCommand(parsed: ParsedCommand, api: ApiClient, output: CliOutput, prompt: Prompter) {
  const agentId = (stringFlag(parsed, 'agent') ?? 'codex') as AgentId;
  const slug = stringFlag(parsed, 'slug', true);
  const spaceId = stringFlag(parsed, 'space', true);
  if (!slug || !spaceId) throw new UsageError('缺少发布参数');
  const targetSpaceId = stringFlag(parsed, 'target-space') ?? spaceId;
  const version = stringFlag(parsed, 'version', true);
  if (!version) throw new UsageError('缺少发布版本');
  const adapter = adapters()[agentId];
  if (!adapter) throw new UsageError(`不支持 Agent：${agentId}`);
  const detected = await adapter.detect();
  const scope = stringFlag(parsed, 'scope') ?? 'workspace';
  const installation = detected.find((item) => item.scope === scope);
  if (!installation) throw new Error(`没有检测到 ${agentId} 的 ${scope} 目录`);
  const inventory = await adapter.inventory(installation);
  const local = inventory.find((item) => item.slug === slug);
  if (!local) throw new Error(`本地未发现 ${slug}`);
  const pkg = await adapter.import(local);
  const scan = await scanPackage(pkg.files);
  if (scan.blocked)
    throw new Error(`敏感信息扫描阻止发布：${scan.findings.map((item) => `${item.ruleId}:${item.path}`).join(', ')}`);
  if (!parsed.flags.yes && !(await prompt.confirm(`发布 ${slug}@${version} 到目标空间？`)))
    throw new CancelledError('已取消发布');
  const archive = archivePackage(pkg);
  const sha256 = archiveSha256(archive);
  const plan = await api.request<ArtifactUploadPlan>('/artifacts/uploads', {
    method: 'POST',
    body: { spaceId, fileName: `${slug}.zip`, contentType: 'application/zip', sizeBytes: archive.byteLength, sha256 },
  });
  const uploadBody = new Uint8Array(archive.byteLength);
  uploadBody.set(archive);
  const uploaded = await api.raw(plan.url, { method: 'PUT', headers: plan.headers, body: uploadBody.buffer });
  if (!uploaded.ok) throw new Error('制品上传失败');
  const artifact = await api.request<{ artifactId: string }>(`/artifacts/uploads/${plan.uploadId}/confirm`, {
    method: 'POST',
  });
  const existing = await api.request<CapabilitySummary[]>(`/capabilities?query=${encodeURIComponent(slug)}&limit=100`);
  const found = existing.find((item) => item.slug === slug);
  let capability: CapabilitySummary;
  let draft: { id: string };
  if (found) {
    capability = found;
    draft = await api.request<{ id: string }>(`/capabilities/${capability.id}/drafts`, { method: 'POST' });
  } else {
    const created = await api.request<{ capability: CapabilitySummary; draft: { id: string } }>('/capabilities', {
      method: 'POST',
      body: {
        spaceId,
        slug,
        name: pkg.manifest.metadata.name,
        description: pkg.manifest.metadata.description ?? '',
        tags: pkg.manifest.metadata.tags ?? [],
        compatibility: pkg.manifest.spec.compatibility.agents,
      },
    });
    capability = created.capability;
    draft = created.draft;
  }
  await api.request(`/capabilities/${capability.id}/drafts/${draft.id}/revisions`, {
    method: 'POST',
    body: { artifactId: artifact.artifactId },
  });
  const publication = await api.request<{ id: string; status: string }>(`/capabilities/${capability.id}/publications`, {
    method: 'POST',
    headers: { 'idempotency-key': stringFlag(parsed, 'idempotency-key') ?? crypto.randomUUID() },
    body: { draftId: draft.id, targetSpaceId, version },
  });
  output.data(
    { capabilityId: capability.id, publicationId: publication.id, status: publication.status, scan },
    `已提交 ${slug}@${version} · ${publication.status}`,
  );
}
