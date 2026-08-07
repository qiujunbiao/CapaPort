import type { OrganizationSummary } from '@agentdoor/contracts';
import type { ApiClient } from '../client.js';
import type { CliOutput } from '../output.js';
import { type ParsedCommand, stringFlag, UsageError } from '../parser.js';

export async function orgCommand(parsed: ParsedCommand, api: ApiClient, output: CliOutput) {
  if (parsed.subcommand === 'list' || !parsed.subcommand) {
    const organizations = await api.request<OrganizationSummary[]>('/organizations');
    const session = await api.session();
    output.table(
      organizations.map((item) => ({
        id: item.id,
        name: item.name,
        role: item.role,
        current: item.id === session?.organizationId ? '*' : '',
      })),
      ['current', 'id', 'name', 'role'],
    );
    return;
  }
  if (parsed.subcommand === 'use') {
    const id = stringFlag(parsed, 'id') ?? parsed.positionals[0];
    if (!id) throw new UsageError('用法：agentdoor org use --id <organization-id>');
    await api.selectOrganization(id);
    output.data({ organizationId: id }, `已切换组织：${id}`);
    return;
  }
  throw new UsageError('用法：agentdoor org list|use');
}
