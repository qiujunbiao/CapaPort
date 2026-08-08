import type { ErrorEnvelope, TokenPair } from '@capaport/contracts';

export type SdkSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  organizationId?: string;
};

export type CapaPortClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  session?: () => SdkSession | undefined | Promise<SdkSession | undefined>;
  saveSession?: (session: SdkSession) => void | Promise<void>;
  idempotencyKey?: () => string;
};

export type CapaPortRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  authenticated?: boolean;
  organizationId?: string;
  session?: SdkSession;
  idempotencyKey?: string;
};

export class CapaPortSdkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly fieldErrors?: Record<string, string[]>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'CapaPortSdkError';
  }
}

export class CapaPortClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly createIdempotencyKey: () => string;

  constructor(private readonly options: CapaPortClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetcher = options.fetch ?? fetch;
    this.createIdempotencyKey = options.idempotencyKey ?? (() => crypto.randomUUID());
  }

  async request<T>(path: string, options: CapaPortRequestOptions = {}): Promise<T> {
    return this.dispatch<T>(path, options, true);
  }

  private async dispatch<T>(path: string, options: CapaPortRequestOptions, retry: boolean): Promise<T> {
    const authenticated = options.authenticated !== false;
    const session = options.session ?? (authenticated ? await this.options.session?.() : undefined);
    const method = (options.method ?? 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    if (authenticated && session) headers.set('authorization', `Bearer ${session.accessToken}`);
    const organizationId = options.organizationId ?? session?.organizationId;
    if (organizationId) headers.set('x-organization-id', organizationId);
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const idempotencyKey =
      authenticated && session && isWrite ? (options.idempotencyKey ?? this.createIdempotencyKey()) : undefined;
    if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
    const body = this.serializeBody(options.body, headers);

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      throw new CapaPortSdkError('NETWORK_ERROR', 'Unable to connect to CapaPort.', 0);
    }

    if (
      response.status === 401 &&
      retry &&
      authenticated &&
      session?.refreshToken &&
      this.options.saveSession &&
      path !== '/auth/refresh'
    ) {
      const refreshed = await this.dispatch<TokenPair>(
        '/auth/refresh',
        { method: 'POST', authenticated: false, body: { refreshToken: session.refreshToken } },
        false,
      );
      const nextSession: SdkSession = {
        ...refreshed,
        ...(organizationId ? { organizationId } : {}),
      };
      await this.options.saveSession(nextSession);
      return this.dispatch<T>(
        path,
        {
          ...options,
          session: nextSession,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        false,
      );
    }

    if (!response.ok) throw await this.responseError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private serializeBody(body: unknown, headers: Headers): BodyInit | undefined {
    if (body === undefined) return undefined;
    if (
      typeof body === 'string' ||
      body instanceof Blob ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body)
    ) {
      return body as BodyInit;
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return JSON.stringify(body);
  }

  private async responseError(response: Response): Promise<CapaPortSdkError> {
    const payload = (await response.json().catch(() => undefined)) as ErrorEnvelope | undefined;
    return new CapaPortSdkError(
      payload?.code ?? `HTTP_${response.status}`,
      payload?.message ?? `CapaPort request failed (${response.status}).`,
      response.status,
      payload?.fieldErrors,
      payload?.requestId,
    );
  }
}
