import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudClient } from './cloud-client';
import { createMemorySessionStore } from './session-store';

describe('desktop cloud client session lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rotates and persists refresh tokens after an authenticated 401', async () => {
    const sessionStore = createMemorySessionStore({ accessToken: 'expired', refreshToken: 'refresh-old' });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(
        Response.json({ accessToken: 'access-new', refreshToken: 'refresh-new', expiresIn: 900 }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'user-a', displayName: 'User A' }));
    vi.stubGlobal('fetch', fetcher);
    const client = createCloudClient('https://api.example.test/api/v1', sessionStore);

    await client.me(sessionStore.get()!);

    expect(sessionStore.get()).toMatchObject({ accessToken: 'access-new', refreshToken: 'refresh-new' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
