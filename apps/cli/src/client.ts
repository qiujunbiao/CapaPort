import { CapaPortClient, CapaPortSdkError } from '@capaport/sdk';
import type { CredentialStore } from './credentials.js';
import { AuthError, NetworkError } from './parser.js';

export class ApiClient {
  private readonly sdk: CapaPortClient;

  constructor(
    baseUrl: string,
    private readonly credentials: CredentialStore,
  ) {
    this.sdk = new CapaPortClient({
      baseUrl,
      session: () => this.credentials.load(),
      saveSession: (session) => this.credentials.save({ ...session, expiresIn: session.expiresIn ?? 900 }),
    });
  }
  async session(required = true) {
    const value = await this.credentials.load();
    if (!value && required) throw new AuthError('尚未登录，请运行 capaport auth login');
    return value;
  }
  async request<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      organizationId?: string;
      authenticated?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    if (init.authenticated !== false) await this.session();
    try {
      return await this.sdk.request<T>(path, {
        ...init,
        ...(init.headers ? { headers: init.headers } : {}),
      });
    } catch (error) {
      if (error instanceof CapaPortSdkError && error.code === 'NETWORK_ERROR') {
        throw new NetworkError('无法连接 CapaPort 服务');
      }
      if (error instanceof CapaPortSdkError && error.statusCode === 401) throw new AuthError(error.message);
      if (error instanceof CapaPortSdkError) throw new Error(error.message);
      throw error;
    }
  }
  async raw(url: string, init?: RequestInit) {
    try {
      return await fetch(url, init);
    } catch {
      throw new NetworkError('制品传输失败');
    }
  }
  async selectOrganization(organizationId: string) {
    const session = await this.session();
    if (!session) throw new AuthError('尚未登录');
    await this.request(`/organizations/${organizationId}/switch`, { method: 'POST', organizationId });
    await this.credentials.save({ ...session, organizationId });
  }
}
