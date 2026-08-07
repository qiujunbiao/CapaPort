import type { CapabilitySummary } from '@agentdoor/contracts';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';
import { type ParsedCommand, stringFlag } from '../parser.js';

export async function searchCommand(parsed: ParsedCommand, api: ApiClient, output: CliOutput) {
  const query = stringFlag(parsed, 'query') ?? parsed.subcommand ?? '';
  const agent = stringFlag(parsed, 'agent');
  const params = new URLSearchParams({ query, limit: '100' });
  if (agent) params.set('agent', agent);
  const capabilities = await api.request<CapabilitySummary[]>(`/capabilities?${params}`);
  output.table(
    capabilities.map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      agents: item.compatibility.join(','),
      space: item.spaceId,
    })),
    ['id', 'slug', 'name', 'agents', 'space'],
  );
}
