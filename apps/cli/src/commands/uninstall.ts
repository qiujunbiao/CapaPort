import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { InstallLock } from '@capaport/adapter-sdk';
import type { AgentId, CapabilitySummary } from '@capaport/contracts';
import { AtomicFileTransaction, adapters } from '../adapters.js';
import { resolveAgentRoot } from '../installations.js';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';
import { CancelledError, type ParsedCommand, stringFlag, UsageError } from '../parser.js';
import type { Prompter } from '../prompt.js';

export async function uninstallCommand(parsed: ParsedCommand, api: ApiClient, output: CliOutput, prompt: Prompter) {
  const slug = stringFlag(parsed, 'slug') ?? parsed.subcommand;
  if (!slug) throw new UsageError('用法：capaport uninstall <slug> --agent codex');
  const agentId = (stringFlag(parsed, 'agent') ?? 'codex') as AgentId;
  const scope = stringFlag(parsed, 'scope') ?? 'workspace';
  if (!['user', 'workspace'].includes(scope)) throw new UsageError('--scope 只能是 user 或 workspace');
  const rootPath = resolveAgentRoot(agentId, scope as 'user' | 'workspace');
  const lockPath = resolve(rootPath, '.capaport', 'locks', agentId, `${slug}.json`);
  const lock = await readFile(lockPath, 'utf8').then(
    (value) => JSON.parse(value) as InstallLock,
    () => undefined,
  );
  if (!lock) throw new Error(`未找到 ${slug} 的安装锁，无法安全卸载`);
  const adapter = adapters()[agentId];
  if (!adapter) throw new UsageError(`不支持 Agent：${agentId}`);
  output.notice(`卸载预览：${lock.files.length} 个受管文件`);
  if (!parsed.flags.yes && !(await prompt.confirm(`从 ${rootPath} 卸载 ${slug}？`)))
    throw new CancelledError('已取消卸载');
  const transaction = new AtomicFileTransaction();
  try {
    const result = await adapter.uninstall(lock, transaction);
    const capabilities = await api
      .request<CapabilitySummary[]>(`/capabilities?query=${encodeURIComponent(slug)}&limit=100`)
      .catch(() => []);
    const capability = capabilities.find((item) => item.slug === slug);
    if (capability) {
      const installations = await api
        .request<Array<{ deviceId: string; capabilityId: string; versionId: string; agent: AgentId; status: string }>>(
          '/installations',
        )
        .catch(() => []);
      const installation = installations.find(
        (item) => item.capabilityId === capability.id && item.agent === agentId && item.status === 'installed',
      );
      if (installation)
        await api.request('/installations', {
          method: 'POST',
          headers: { 'idempotency-key': stringFlag(parsed, 'idempotency-key') ?? crypto.randomUUID() },
          body: {
            deviceId: installation.deviceId,
            capabilityId: installation.capabilityId,
            versionId: installation.versionId,
            agent: agentId,
            outcome: 'uninstalled',
          },
        });
    }
    output.data(result, `已卸载 ${slug} ← ${agentId}/${scope}`);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
