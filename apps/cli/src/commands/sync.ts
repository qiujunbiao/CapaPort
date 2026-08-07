import type { UpdateCheck } from '@agentdoor/contracts';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';

export async function syncCommand(api: ApiClient, output: CliOutput) {
  const installations =
    await api.request<Array<{ id: string; capabilityId: string; agent: string; status: string }>>('/installations');
  const checks = await Promise.all(
    installations
      .filter((item) => item.status === 'installed')
      .map(async (item) => ({
        ...item,
        check: await api.request<UpdateCheck>(`/installations/${item.id}/update-check`),
      })),
  );
  output.table(
    checks.map((item) => ({
      capabilityId: item.capabilityId,
      agent: item.agent,
      action: item.check.action,
      version: item.check.action === 'update' ? item.check.availableVersion : '',
    })),
    ['capabilityId', 'agent', 'action', 'version'],
  );
}
