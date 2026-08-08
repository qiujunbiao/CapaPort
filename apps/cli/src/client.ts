import { randomUUID } from 'node:crypto';
import type { TokenPair } from '@agentdoor/contracts';
import type { CredentialStore } from './credentials.js';
import { AuthError, NetworkError } from './parser.js';

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: CredentialStore,
  ) {}
  async session(required = true) {
    const value = await this.credentials.load();
    if (!value && required) throw new AuthError('尚未登录，请运行 agentdoor auth login');
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
    retry = true,
  ): Promise<T> {
    const session = await this.session(init.authenticated !== false);
    const headers = new Headers({ accept: 'application/json', ...init.headers });
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    if (init.authenticated !== false && session) headers.set('authorization', `Bearer ${session.accessToken}`);
    const method = (init.method ?? 'GET').toUpperCase();
    if (init.authenticated !== false && session && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (!headers.has('idempotency-key')) headers.set('idempotency-key', randomUUID());
    }
    const organizationId = init.organizationId ?? session?.organizationId;
    if (organizationId) headers.set('x-organization-id', organizationId);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new NetworkError('无法连接 Agentdoor 服务');
    }
    if (response.status === 401 && retry && session?.refreshToken && path !== '/auth/refresh') {
      const refreshed = await this.request<TokenPair>(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: session.refreshToken }, authenticated: false },
        false,
      );
      await this.credentials.save({
        ...refreshed,
        ...(session.organizationId ? { organizationId: session.organizationId } : {}),
      });
      return this.request(path, init, false);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as
        | { message?: string; error?: { message?: string } }
        | undefined;
      if (response.status === 401) throw new AuthError(payload?.message ?? payload?.error?.message ?? '登录已失效');
      throw new Error(payload?.message ?? payload?.error?.message ?? `请求失败 (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
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
