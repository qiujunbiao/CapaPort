import { access, writeFile } from 'node:fs/promises';
import type { CapabilitySummary, CapabilityVersionSummary } from '@agentdoor/contracts';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';
import { CancelledError, type ParsedCommand, stringFlag, UsageError } from '../parser.js';
import type { Prompter } from '../prompt.js';

export async function pullCommand(parsed: ParsedCommand, api: ApiClient, output: CliOutput, prompt: Prompter) {
  const slug = stringFlag(parsed, 'slug') ?? parsed.subcommand;
  if (!slug) throw new UsageError('用法：agentdoor pull <slug> [--output file.zip]');
  const capabilities = await api.request<CapabilitySummary[]>(
    `/capabilities?query=${encodeURIComponent(slug)}&limit=100`,
  );
  const capability = capabilities.find((item) => item.slug === slug);
  if (!capability) throw new Error(`找不到能力：${slug}`);
  const versions = await api.request<CapabilityVersionSummary[]>(`/capabilities/${capability.id}/versions`);
  const version = versions.find((item) => item.status === 'published') ?? versions[0];
  if (!version) throw new Error('该能力没有可拉取版本');
  const agent = stringFlag(parsed, 'agent') ?? capability.compatibility[0];
  if (!agent) throw new Error('该能力没有兼容的 Agent');
  const devices = await api.request<Array<{ id: string; supportedAgents: string[] }>>('/devices');
  const device =
    devices.find((item) => item.supportedAgents.includes(agent)) ??
    (await api.request<{ id: string; supportedAgents: string[] }>('/devices', {
      method: 'POST',
      body: {
        name: 'Agentdoor CLI',
        platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
        appVersion: '0.1.0',
        supportedAgents: [agent],
      },
    }));
  const plan = await api.request<{ download: { url: string }; digest: string }>('/distribution/install-plans', {
    method: 'POST',
    body: {
      deviceId: device.id,
      capabilityId: capability.id,
      versionId: version.id,
      agent,
    },
  });
  const response = await api.raw(plan.download.url);
  if (!response.ok) throw new Error('制品下载失败');
  const outputPath = stringFlag(parsed, 'output') ?? `${slug}-${version.version}.zip`;
  const exists = await access(outputPath).then(
    () => true,
    () => false,
  );
  if (exists && !parsed.flags.yes && !(await prompt.confirm(`覆盖 ${outputPath}？`)))
    throw new CancelledError('已取消覆盖');
  await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  output.data(
    { path: outputPath, version: version.version, digest: plan.digest },
    `已拉取 ${slug}@${version.version} → ${outputPath}`,
  );
}
