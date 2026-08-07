import type { TokenPair } from '@agentdoor/contracts';
import type { ApiClient } from '../client.js';
import type { CredentialStore } from '../credentials.js';
import type { CliOutput } from '../output.js';
import { type ParsedCommand, stringFlag, UsageError } from '../parser.js';
import type { Prompter } from '../prompt.js';

export async function authCommand(
  parsed: ParsedCommand,
  api: ApiClient,
  credentials: CredentialStore,
  output: CliOutput,
  prompt: Prompter,
) {
  if (parsed.subcommand === 'logout') {
    await api.request('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await credentials.clear();
    output.data({ authenticated: false }, '已退出登录并清除系统凭据。');
    return;
  }
  if (parsed.subcommand === 'status') {
    const session = await credentials.load();
    output.data(
      {
        authenticated: Boolean(session),
        organizationId: session?.organizationId,
        credentialBackend: credentials.backend(),
      },
      session ? `已登录 · 凭据存储：${credentials.backend()}` : '尚未登录',
    );
    return;
  }
  if (parsed.subcommand !== 'login') throw new UsageError('用法：agentdoor auth login|logout|status');
  const target = stringFlag(parsed, 'target') ?? (await prompt.ask('邮箱或手机号'));
  const password = stringFlag(parsed, 'password') ?? process.env.AGENTDOOR_PASSWORD ?? (await prompt.ask('密码'));
  const kind = target.includes('@') ? 'email' : 'phone';
  const tokens = await api.request<TokenPair>('/auth/login', {
    method: 'POST',
    body: { kind, target, password, deviceName: 'Agentdoor CLI' },
    authenticated: false,
  });
  await credentials.save(tokens);
  output.data({ authenticated: true }, `登录成功，凭据已保存到 ${credentials.backend()}。`);
}
