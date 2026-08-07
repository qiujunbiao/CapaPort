import { spawnSync } from 'node:child_process';
import type { TokenPair } from '@agentdoor/contracts';

export type StoredSession = TokenPair & { organizationId?: string };
export interface CredentialStore {
  load(): Promise<StoredSession | undefined>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
  backend(): string;
}

export class MemoryCredentialStore implements CredentialStore {
  constructor(private value?: StoredSession) {}
  async load() {
    return this.value;
  }
  async save(session: StoredSession) {
    this.value = session;
  }
  async clear() {
    this.value = undefined;
  }
  backend() {
    return 'memory';
  }
}

function run(command: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    env: options.env,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}
type CommandResult = ReturnType<typeof run>;

export class SystemCredentialStore implements CredentialStore {
  private readonly service = 'io.agentdoor.cli';
  backend() {
    return process.platform === 'darwin'
      ? 'macOS Keychain'
      : process.platform === 'win32'
        ? 'Windows Credential Locker'
        : 'Secret Service';
  }
  async load(): Promise<StoredSession | undefined> {
    let result: CommandResult;
    if (process.platform === 'darwin')
      result = run('security', ['find-generic-password', '-s', this.service, '-a', 'default', '-w']);
    else if (process.platform === 'win32')
      result = run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$v=New-Object Windows.Security.Credentials.PasswordVault;$c=$v.Retrieve('io.agentdoor.cli','default');$c.RetrievePassword();$c.Password",
      ]);
    else result = run('secret-tool', ['lookup', 'service', this.service, 'account', 'default']);
    if (result.status !== 0 || !result.stdout.trim()) return undefined;
    try {
      return JSON.parse(result.stdout.trim()) as StoredSession;
    } catch {
      return undefined;
    }
  }
  async save(session: StoredSession): Promise<void> {
    const payload = JSON.stringify(session);
    let result: CommandResult;
    if (process.platform === 'darwin')
      result = run('security', ['add-generic-password', '-U', '-s', this.service, '-a', 'default', '-w', payload]);
    else if (process.platform === 'win32')
      result = run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$v=New-Object Windows.Security.Credentials.PasswordVault;$c=New-Object Windows.Security.Credentials.PasswordCredential('io.agentdoor.cli','default',$env:AGENTDOOR_CREDENTIAL);$v.Add($c)",
        ],
        { env: { ...process.env, AGENTDOOR_CREDENTIAL: payload } },
      );
    else
      result = run('secret-tool', ['store', '--label=Agentdoor CLI', 'service', this.service, 'account', 'default'], {
        input: payload,
      });
    if (result.status !== 0) throw new Error(`无法写入${this.backend()}，请确认系统凭据服务可用`);
  }
  async clear(): Promise<void> {
    if (process.platform === 'darwin')
      run('security', ['delete-generic-password', '-s', this.service, '-a', 'default']);
    else if (process.platform === 'win32')
      run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$v=New-Object Windows.Security.Credentials.PasswordVault;try{$c=$v.Retrieve('io.agentdoor.cli','default');$v.Remove($c)}catch{}",
      ]);
    else run('secret-tool', ['clear', 'service', this.service, 'account', 'default']);
  }
}
