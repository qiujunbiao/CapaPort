import { createHash } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { FilePlan, InstallLock } from '@capaport/adapter-sdk';
import type { AgentId, CapabilitySummary, CapabilityVersionSummary, InstallPlan } from '@capaport/contracts';
import { AtomicFileTransaction, adapters } from '../adapters.js';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';
import { canonicalPackage } from '../package.js';
import { CancelledError, ConflictError, type ParsedCommand, stringFlag, UsageError } from '../parser.js';
import type { Prompter } from '../prompt.js';

const roots: Record<AgentId, string> = {
  codex: '.agents',
  'claude-code': '.claude',
  cursor: '.cursor',
  'gemini-cli': '.gemini',
};
function digest(content: Uint8Array) {
  return createHash('sha256').update(content).digest('hex');
}
async function ensureInstallation(agentId: AgentId, scope: string) {
  const rootPath = resolve(scope === 'user' ? homedir() : process.cwd(), roots[agentId]);
  await mkdir(rootPath, { recursive: true });
  const adapter = adapters()[agentId];
  if (!adapter) throw new UsageError(`不支持 Agent：${agentId}`);
  const installation = (await adapter.detect()).find((item) => item.scope === scope && item.rootPath === rootPath);
  if (!installation) throw new Error(`无法初始化 ${agentId} 的 ${scope} 目录`);
  return { adapter, installation };
}
async function conflicts(plan: FilePlan): Promise<string[]> {
  const lock = await readFile(plan.lock.lockPath, 'utf8').then(
    (value) => JSON.parse(value) as InstallLock,
    () => undefined,
  );
  const result: string[] = [];
  for (const entry of plan.entries) {
    if (
      !(await access(entry.destination).then(
        () => true,
        () => false,
      ))
    )
      continue;
    const current = new Uint8Array(await readFile(entry.destination));
    const expected = lock?.files.find((file) => file.destination === entry.destination)?.digest;
    if (!expected || digest(current) !== expected) result.push(entry.relativePath);
  }
  return result;
}

export async function installCommand(parsed: ParsedCommand, api: ApiClient, output: CliOutput, prompt: Prompter) {
  const slug = stringFlag(parsed, 'slug') ?? parsed.subcommand;
  if (!slug) throw new UsageError('用法：capaport install <slug> --agent codex');
  const agentId = (stringFlag(parsed, 'agent') ?? 'codex') as AgentId;
  const scope = stringFlag(parsed, 'scope') ?? 'workspace';
  if (!['user', 'workspace'].includes(scope)) throw new UsageError('--scope 只能是 user 或 workspace');
  const capabilities = await api.request<CapabilitySummary[]>(
    `/capabilities?query=${encodeURIComponent(slug)}&limit=100`,
  );
  const capability = capabilities.find((item) => item.slug === slug);
  if (!capability) throw new Error(`找不到能力：${slug}`);
  if (!capability.compatibility.includes(agentId)) throw new ConflictError(`能力与 ${agentId} 不兼容`);
  const versions = await api.request<CapabilityVersionSummary[]>(`/capabilities/${capability.id}/versions`);
  const requested = stringFlag(parsed, 'version');
  const version = versions.find((item) => item.status === 'published' && (!requested || item.version === requested));
  if (!version) throw new Error('没有可安装版本');
  const devices = await api.request<Array<{ id: string; supportedAgents: AgentId[] }>>('/devices');
  const device =
    devices.find((item) => item.supportedAgents.includes(agentId)) ??
    (await api.request<{ id: string; supportedAgents: AgentId[] }>('/devices', {
      method: 'POST',
      body: {
        name: 'CapaPort CLI',
        platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
        appVersion: '0.1.0',
        supportedAgents: [agentId],
      },
    }));
  const cloudPlan = await api.request<InstallPlan>('/distribution/install-plans', {
    method: 'POST',
    body: { deviceId: device.id, capabilityId: capability.id, versionId: version.id, agent: agentId },
  });
  const response = await api.raw(cloudPlan.download.url);
  if (!response.ok) throw new Error('能力包下载失败');
  const pkg = await canonicalPackage(new Uint8Array(await response.arrayBuffer()));
  if (pkg.digest !== cloudPlan.digest) throw new Error('能力包摘要验证失败');
  const { adapter, installation } = await ensureInstallation(agentId, scope);
  const filePlan = await adapter.planInstall(pkg, { installation });
  const foundConflicts = await conflicts(filePlan);
  if (foundConflicts.length && !parsed.flags.force)
    throw new ConflictError(`本地文件已修改：${foundConflicts.join(', ')}；确认后使用 --force`);
  output.notice(
    `安装预览：${filePlan.entries.length} 个文件${foundConflicts.length ? `，${foundConflicts.length} 个冲突` : ''}`,
  );
  if (!parsed.flags.yes && !(await prompt.confirm(`写入 ${installation.rootPath}？`)))
    throw new CancelledError('已取消安装');
  const transaction = new AtomicFileTransaction();
  const idempotencyKey = stringFlag(parsed, 'idempotency-key') ?? crypto.randomUUID();
  try {
    const result = await adapter.apply(filePlan, transaction);
    await api.request('/installations', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: {
        deviceId: device.id,
        capabilityId: capability.id,
        versionId: version.id,
        agent: agentId,
        outcome: 'installed',
      },
    });
    output.data({ ...result, version: version.version }, `已安装 ${slug}@${version.version} → ${agentId}/${scope}`);
  } catch (error) {
    await transaction.rollback();
    await api
      .request('/installations', {
        method: 'POST',
        headers: { 'idempotency-key': `${idempotencyKey}-failed` },
        body: {
          deviceId: device.id,
          capabilityId: capability.id,
          versionId: version.id,
          agent: agentId,
          outcome: 'failed',
          failureCode: 'cli_apply_failed',
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
