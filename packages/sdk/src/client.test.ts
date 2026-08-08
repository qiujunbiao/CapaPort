import { describe, expect, it, vi } from 'vitest';
import { CapaPortClient, type CapaPortSdkError, type SdkSession } from './client.js';

describe('CapaPortClient', () => {
  it('shares auth, tenant, refresh, and one stable idempotency key across retry', async () => {
    let session: SdkSession = {
      accessToken: 'expired-access',
      refreshToken: 'refresh-token',
      organizationId: 'org-1',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/auth/refresh')) {
        return Response.json({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresIn: 900 });
      }
      if (calls.filter((call) => call.url.endsWith('/capabilities')).length === 1) {
        return Response.json({ code: 'AUTH_ACCESS_INVALID', message: 'Expired' }, { status: 401 });
      }
      return Response.json({ id: 'capability-1' }, { status: 201 });
    });
    const client = new CapaPortClient({
      baseUrl: 'https://capaport.example/api/v1',
      fetch: fetcher,
      session: () => session,
      saveSession: (next) => {
        session = next;
      },
      idempotencyKey: () => 'stable-key-123',
    });

    await expect(client.request('/capabilities', { method: 'POST', body: { name: 'Review' } })).resolves.toEqual({
      id: 'capability-1',
    });
    const writes = calls.filter((call) => call.url.endsWith('/capabilities'));
    expect(writes).toHaveLength(2);
    expect(new Headers(writes[0]?.init?.headers).get('idempotency-key')).toBe('stable-key-123');
    expect(new Headers(writes[1]?.init?.headers).get('idempotency-key')).toBe('stable-key-123');
    expect(new Headers(writes[1]?.init?.headers).get('authorization')).toBe('Bearer fresh-access');
    expect(new Headers(writes[1]?.init?.headers).get('x-organization-id')).toBe('org-1');
  });

  it('returns structured API errors without leaking response internals', async () => {
    const client = new CapaPortClient({
      baseUrl: 'https://capaport.example/api/v1',
      fetch: async () =>
        Response.json(
          { code: 'VALIDATION_ERROR', message: 'Invalid input', fieldErrors: { name: ['Required'] } },
          { status: 400 },
        ),
    });
    await expect(client.request('/auth/register', { method: 'POST', authenticated: false, body: {} })).rejects.toEqual(
      expect.objectContaining({
        name: 'CapaPortSdkError',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        fieldErrors: { name: ['Required'] },
      }) as CapaPortSdkError,
    );
  });
});
