import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudClient } from './cloud-client';
import { createMemorySessionStore } from './session-store';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('desktop cloud client session lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invoke.mockReset();
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('uses the native Tauri HTTP bridge instead of WebView fetch', async () => {
    (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const webviewFetch = vi.fn();
    vi.stubGlobal('fetch', webviewFetch);
    invoke.mockResolvedValue({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: 'challenge-a' }),
    });
    const client = createCloudClient('http://127.0.0.1:3210/api/v1');
    if (!client.register) throw new Error('Registration client is unavailable.');

    await client.register({
      kind: 'phone',
      target: '15000836993',
      password: 'Strong-password-1',
      displayName: 'Rocky',
    });

    expect(invoke).toHaveBeenCalledWith('api_request', {
      request: {
        url: 'http://127.0.0.1:3210/api/v1/auth/register',
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'phone',
          target: '15000836993',
          password: 'Strong-password-1',
          displayName: 'Rocky',
        }),
      },
    });
    expect(webviewFetch).not.toHaveBeenCalled();
  });

  it('rotates and persists refresh tokens after an authenticated 401', async () => {
    const session = { accessToken: 'expired', refreshToken: 'refresh-old' };
    const sessionStore = createMemorySessionStore(session);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(Response.json({ accessToken: 'access-new', refreshToken: 'refresh-new', expiresIn: 900 }))
      .mockResolvedValueOnce(Response.json({ id: 'user-a', displayName: 'User A' }));
    vi.stubGlobal('fetch', fetcher);
    const client = createCloudClient('https://api.example.test/api/v1', sessionStore);

    await client.me(session);

    expect(sessionStore.get()).toMatchObject({ accessToken: 'access-new', refreshToken: 'refresh-new' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('sends minimized product events to the organization analytics endpoint', async () => {
    const session = { accessToken: 'token', refreshToken: 'refresh' };
    const sessionStore = createMemorySessionStore(session);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    vi.stubGlobal('fetch', fetcher);
    const client = createCloudClient('https://api.example.test/api/v1', sessionStore);

    await client.recordAnalyticsEvent(session, 'org-a', {
      eventName: 'capability.imported',
      agent: 'codex',
      outcome: 'success',
      source: 'desktop',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/analytics/events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          eventName: 'capability.imported',
          agent: 'codex',
          outcome: 'success',
          source: 'desktop',
        }),
      }),
    );
  });

  it('updates the selected organization name through the tenant-scoped endpoint', async () => {
    const session = { accessToken: 'token', refreshToken: 'refresh' };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'org-a', name: '海岸香蕉团队' }));
    vi.stubGlobal('fetch', fetcher);
    const client = createCloudClient('https://api.example.test/api/v1');
    if (!client.updateOrganization) throw new Error('Organization update client is unavailable.');

    await client.updateOrganization(session, 'org-a', { name: '海岸香蕉团队' });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/organizations/org-a',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: '海岸香蕉团队' }) }),
    );
  });

  it('exposes the organization governance endpoints required by the Web console', async () => {
    const session = { accessToken: 'token', refreshToken: 'refresh' };
    const fetcher = vi.fn().mockImplementation(async () => Response.json({}));
    vi.stubGlobal('fetch', fetcher);
    const client = createCloudClient('https://api.example.test/api/v1') as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    await client.scanReport?.(session, 'org-a', 'publication-a');
    await client.updateCapability?.(session, 'org-a', 'capability-a', { name: 'Release helper' });
    await client.invite?.(session, 'org-a', { kind: 'email', target: 'owner@example.com', role: 'admin' });
    await client.createSpace?.(session, 'org-a', {
      type: 'team',
      name: 'Platform',
      slug: 'platform',
      reviewPolicy: 'required',
    });
    await client.updateSecurityPolicy?.(session, 'org-a', { blockedSeverities: ['critical'] });
    await client.audit?.(session, 'org-a', { action: 'publication.approved' });
    await client.closeOrganization?.(session, 'org-a', 'Platform');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/publications/publication-a/scan-report',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/capabilities/capability-a',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Release helper' }) }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/organizations/org-a/invitations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/spaces',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/organizations/org-a/security-policy',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/audit?limit=50&action=publication.approved',
      expect.any(Object),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/organizations/org-a/closure',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirmation: 'Platform' }) }),
    );
  });

  it('resumes the existing empty draft when a repeated local import uses the same slug', async () => {
    const session = { accessToken: 'token', refreshToken: 'refresh' };
    const archive = {
      fileName: 'find-skills.zip',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
      archiveBase64: 'emlw',
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ code: 'CAPABILITY_SLUG_EXISTS', message: 'Capability slug already exists.' }, { status: 409 }),
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 'capability-existing',
            organizationId: 'org-a',
            spaceId: 'space-personal',
            slug: 'find-skills',
            name: 'find-skills',
            description: '',
            tags: [],
            compatibility: ['codex'],
            ownerUserId: 'user-a',
            status: 'active',
          },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json([{ id: 'draft-existing', capabilityId: 'capability-existing', status: 'draft' }]),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadId: 'upload-a',
          url: 'https://uploads.example.test/archive',
          headers: { 'content-type': 'application/zip' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ artifactId: 'artifact-a' }))
      .mockResolvedValueOnce(
        Response.json({
          id: 'revision-a',
          sequence: 1,
          scanStatus: 'passed',
          scanReport: { findings: [] },
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    const result = await createCloudClient('https://api.example.test/api/v1').createCapabilityDraft({
      session,
      organizationId: 'org-a',
      spaceId: 'space-personal',
      slug: 'find-skills',
      agent: 'codex',
      archive,
    });

    expect(result).toMatchObject({
      capabilityId: 'capability-existing',
      draftId: 'draft-existing',
      revisionId: 'revision-a',
    });
    expect(fetcher).not.toHaveBeenCalledWith(
      'https://api.example.test/api/v1/capabilities/capability-existing/drafts',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
