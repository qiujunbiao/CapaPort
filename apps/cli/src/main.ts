import { pathToFileURL } from 'node:url';
import { ApiClient } from './client.js';
import { authCommand } from './commands/auth.js';
import { doctorCommand } from './commands/doctor.js';
import { installCommand } from './commands/install.js';
import { orgCommand } from './commands/org.js';
import { publishCommand } from './commands/publish.js';
import { pullCommand } from './commands/pull.js';
import { searchCommand } from './commands/search.js';
import { syncCommand } from './commands/sync.js';
import { uninstallCommand } from './commands/uninstall.js';
import { type CredentialStore, SystemCredentialStore } from './credentials.js';
import { CliOutput, type OutputWriter } from './output.js';
import { parseArgv, UsageError } from './parser.js';
import { type Prompter, terminalPrompter } from './prompt.js';

const help = `Agentdoor CLI 0.1.0

用法：agentdoor <command> [options]

  auth login|logout|status     登录与系统凭据
  org list|use                查看或切换组织
  search [query]              搜索能力市场
  pull <slug>                 下载能力包制品
  publish --slug ...          扫描并发布本地能力（风险包需 --accept-risk --risk-reason）
  install <slug>              安装或更新到本地 Agent
  uninstall <slug>            安全卸载并检测本地改动
  sync                        检查全部已安装能力更新
  doctor                      输出脱敏运行诊断

全局参数：--json, --api <url>, --yes, --help`;

export async function runCli(
  argv: string[],
  dependencies: { credentials?: CredentialStore; prompt?: Prompter; writer?: OutputWriter } = {},
): Promise<number> {
  const parsed = parseArgv(argv);
  const credentials = dependencies.credentials ?? new SystemCredentialStore();
  const output = new CliOutput(Boolean(parsed.flags.json), dependencies.writer);
  const prompt = dependencies.prompt ?? terminalPrompter;
  const baseUrl =
    typeof parsed.flags.api === 'string'
      ? parsed.flags.api.replace(/\/$/, '')
      : (process.env.AGENTDOOR_API_URL ?? 'http://127.0.0.1:3210/api/v1');
  const api = new ApiClient(baseUrl, credentials);
  try {
    if (!parsed.command || parsed.flags.help || parsed.command === 'help') {
      output.data({ help }, help);
      return 0;
    }
    if (parsed.command === 'auth') await authCommand(parsed, api, credentials, output, prompt);
    else if (parsed.command === 'org') await orgCommand(parsed, api, output);
    else if (parsed.command === 'search') await searchCommand(parsed, api, output);
    else if (parsed.command === 'pull') await pullCommand(parsed, api, output, prompt);
    else if (parsed.command === 'publish') await publishCommand(parsed, api, output, prompt);
    else if (parsed.command === 'install') await installCommand(parsed, api, output, prompt);
    else if (parsed.command === 'uninstall') await uninstallCommand(parsed, api, output, prompt);
    else if (parsed.command === 'sync') await syncCommand(api, output);
    else if (parsed.command === 'doctor') await doctorCommand(api, credentials, output);
    else throw new UsageError(`未知命令：${parsed.command}`);
    return 0;
  } catch (error) {
    const exitCode =
      typeof error === 'object' && error !== null && 'exitCode' in error && typeof error.exitCode === 'number'
        ? error.exitCode
        : 1;
    output.error(error, exitCode);
    return exitCode;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) process.exitCode = await runCli(process.argv.slice(2));
