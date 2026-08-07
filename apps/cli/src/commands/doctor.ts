import { adapters } from '../adapters.js';
import type { ApiClient } from '../client.js';
import type { CredentialStore } from '../credentials.js';
import type { CliOutput } from '../output.js';

export async function doctorCommand(api: ApiClient, credentials: CredentialStore, output: CliOutput) {
  const health = await api.request<{ status: string; dependencies?: Record<string, string> }>('/health/ready', {
    authenticated: false,
  });
  const detected = (
    await Promise.all(
      Object.values(adapters()).map(async (adapter) =>
        (await adapter.detect()).map((item) => ({ agent: adapter.id, scope: item.scope })),
      ),
    )
  ).flat();
  const session = await credentials.load();
  const report = {
    api: health.status,
    dependencies: health.dependencies ?? {},
    credentialBackend: credentials.backend(),
    authenticated: Boolean(session),
    organizationSelected: Boolean(session?.organizationId),
    detectedAgents: detected,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  };
  output.data(
    report,
    [
      `API: ${report.api}`,
      `凭据库: ${report.credentialBackend}`,
      `登录: ${report.authenticated ? '是' : '否'}`,
      `组织: ${report.organizationSelected ? '已选择' : '未选择'}`,
      `Agent: ${detected.map((item) => `${item.agent}/${item.scope}`).join(', ') || '未检测到'}`,
    ].join('\n'),
  );
}
