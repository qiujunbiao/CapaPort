import { describe, expect, it } from 'vitest';
import { MemoryCredentialStore } from './credentials.js';

describe('credential abstraction', () => {
  it('stores and clears sessions without exposing a filesystem path', async () => {
    const store = new MemoryCredentialStore();
    await store.save({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900, organizationId: 'org-a' });
    expect(await store.load()).toMatchObject({ organizationId: 'org-a' });
    expect(store.backend()).toBe('memory');
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });
});
