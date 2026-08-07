import type { CapabilitySummary, SpaceSummary, UpdateCheck } from '@agentdoor/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Box, CloudOff, FolderGit2, Home, Menu, PanelLeftClose, Send, Settings, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DoorMark } from '../components/brand';
import { Status } from '../components/ui';
import { DiscoveryModal } from '../features/agents/discovery-modal';
import { HomePage } from '../features/agents/home-page';
import { AuthScreen } from '../features/auth/auth-screen';
import { OrganizationOnboarding } from '../features/auth/organization-onboarding';
import { InstallModal } from '../features/library/install-modal';
import { LibraryPage } from '../features/library/library-page';
import { ProjectsPage } from '../features/projects/projects-page';
import { PublishingPage } from '../features/publishing/publishing-page';
import { SettingsPage } from '../features/settings/settings-page';
import type { CloudClient, InstallationSummary, LocalClient, SessionStore } from './types';

type Page = 'home' | 'library' | 'projects' | 'publishing' | 'settings';
const nav: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'library', label: '能力库', icon: Box },
  { id: 'projects', label: '项目', icon: FolderGit2 },
  { id: 'publishing', label: '发布', icon: Send },
  { id: 'settings', label: '设置', icon: Settings },
];

function cacheKey(organizationId: string, kind: string) {
  return `agentdoor:cache:${organizationId}:${kind}`;
}
function readCache<T>(organizationId: string, kind: string): T | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(organizationId, kind));
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeCache(organizationId: string, kind: string, value: unknown) {
  try {
    localStorage.setItem(cacheKey(organizationId, kind), JSON.stringify(value));
  } catch {
    /* cache is best effort */
  }
}

function AppContent({
  cloud,
  local,
  sessionStore,
}: {
  cloud: CloudClient;
  local: LocalClient;
  sessionStore: SessionStore;
}) {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const queryClient = useQueryClient();
  const [page, setPage] = useState<Page>('home');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [online, setOnline] = useState(cloud.isOnline());
  const [discovering, setDiscovering] = useState(false);
  const [installing, setInstalling] = useState<CapabilitySummary>();

  useEffect(() => {
    const update = () => setOnline(cloud.isOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [cloud]);

  const organizationsQuery = useQuery({
    queryKey: ['organizations', session?.accessToken],
    queryFn: () => {
      if (!session) throw new Error('Authentication is required');
      return cloud.organizations(session);
    },
    enabled: Boolean(session),
    retry: false,
  });
  const organizations = organizationsQuery.data ?? [];
  const organizationId = session?.organizationId ?? organizations[0]?.id;
  const organization = organizations.find((item) => item.id === organizationId);

  useEffect(() => {
    if (session && !session.organizationId && organizations[0])
      sessionStore.set({ ...session, organizationId: organizations[0].id });
  }, [organizations, session, sessionStore]);

  const userQuery = useQuery({
    queryKey: ['me', session?.accessToken],
    queryFn: () => {
      if (!session) throw new Error('Authentication is required');
      return cloud.me(session);
    },
    enabled: Boolean(session),
    retry: false,
  });
  const agentsQuery = useQuery({
    queryKey: ['local-agents'],
    queryFn: () => local.detectAgents(),
    enabled: Boolean(session),
    retry: false,
  });
  const spacesQuery = useQuery({
    queryKey: ['spaces', organizationId],
    queryFn: async () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      const value = await cloud.spaces(session, organizationId);
      writeCache(organizationId, 'spaces', value);
      return value;
    },
    initialData: organizationId ? readCache<SpaceSummary[]>(organizationId, 'spaces') : undefined,
    enabled: Boolean(session && organizationId && online),
    retry: false,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['capabilities', organizationId],
    queryFn: async () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      const value = await cloud.capabilities(session, organizationId);
      writeCache(organizationId, 'capabilities', value);
      return value;
    },
    initialData: organizationId ? readCache<CapabilitySummary[]>(organizationId, 'capabilities') : undefined,
    enabled: Boolean(session && organizationId && online),
    retry: false,
  });
  const publicationsQuery = useQuery({
    queryKey: ['publications', organizationId],
    queryFn: () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      return cloud.publications(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online),
    retry: false,
  });
  const installationsQuery = useQuery({
    queryKey: ['installations', organizationId],
    queryFn: async () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      const value = await cloud.installations(session, organizationId);
      writeCache(organizationId, 'installations', value);
      return value;
    },
    initialData: organizationId ? readCache<InstallationSummary[]>(organizationId, 'installations') : undefined,
    enabled: Boolean(session && organizationId && online),
    retry: false,
  });
  const updateChecksQuery = useQuery({
    queryKey: ['update-checks', organizationId, installationsQuery.data],
    queryFn: async () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      const checks = await Promise.all(
        (installationsQuery.data ?? [])
          .filter((installation) => installation.status === 'installed')
          .map(
            async (installation) =>
              [installation.capabilityId, await cloud.updateCheck(session, organizationId, installation.id)] as const,
          ),
      );
      return Object.fromEntries(checks) as Record<string, UpdateCheck>;
    },
    enabled: Boolean(session && organizationId && online && installationsQuery.data?.length),
    retry: false,
  });
  const queueQuery = useQuery({
    queryKey: ['sync-queue'],
    queryFn: () => local.syncQueueStatus(),
    enabled: Boolean(session),
    retry: false,
  });

  async function switchOrganization(nextId: string) {
    if (!session || nextId === organizationId) return;
    await cloud.switchOrganization(session, nextId);
    sessionStore.set({ ...session, organizationId: nextId });
    setPage('home');
  }

  if (!session) return <AuthScreen cloud={cloud} sessionStore={sessionStore} />;
  if (!organizationsQuery.isLoading && organizations.length === 0)
    return (
      <OrganizationOnboarding
        cloud={cloud}
        session={session}
        onReady={(id) => {
          sessionStore.set({ ...session, organizationId: id });
          void organizationsQuery.refetch();
        }}
      />
    );
  if (!organizationId)
    return (
      <div className="app-loading">
        <DoorMark />
        <span>正在加载组织空间…</span>
      </div>
    );

  const pageContent = (() => {
    if (page === 'home')
      return (
        <HomePage
          agents={agentsQuery.data ?? []}
          capabilities={capabilitiesQuery.data ?? []}
          online={online}
          loading={agentsQuery.isLoading}
          onDiscover={() => setDiscovering(true)}
          onNavigate={(next) => setPage(next as Page)}
        />
      );
    if (page === 'library')
      return (
        <LibraryPage
          capabilities={capabilitiesQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          installations={installationsQuery.data ?? []}
          updateChecks={updateChecksQuery.data ?? {}}
          online={online}
          onInstall={setInstalling}
        />
      );
    if (page === 'projects')
      return (
        <ProjectsPage
          spaces={spacesQuery.data ?? []}
          onBind={async (spaceId, path) => {
            await local.bindProjectDirectory({ spaceId, path });
          }}
        />
      );
    if (page === 'publishing') return <PublishingPage publications={publicationsQuery.data ?? []} />;
    return (
      <SettingsPage
        user={userQuery.data}
        organization={organization}
        queue={queueQuery.data}
        online={online}
        onLogout={() => {
          sessionStore.clear();
          queryClient.clear();
        }}
        onRefreshQueue={() => void queueQuery.refetch()}
      />
    );
  })();

  return (
    <div className={`desktop-shell ${railCollapsed ? 'desktop-shell--collapsed' : ''}`}>
      <aside className="side-rail">
        <div className="side-rail__brand">
          <DoorMark compact={railCollapsed} />
          <button
            type="button"
            aria-label={railCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setRailCollapsed((value) => !value)}
          >
            {railCollapsed ? <Menu /> : <PanelLeftClose />}
          </button>
        </div>
        <nav aria-label="主导航">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="side-rail__security">
          <ShieldCheck aria-hidden />
          <span>
            <strong>本地安全</strong>
            <small>凭据库已连接</small>
          </span>
        </div>
        <p className="rail-registry">
          REGISTRY
          <br />
          AD-REG-0001
        </p>
      </aside>
      <div className="workspace">
        <header className="top-bar">
          <label>
            组织
            <select
              aria-label="当前组织"
              value={organizationId}
              onChange={(event) => void switchOrganization(event.target.value)}
            >
              {organizations.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="top-bar__right">
            {online ? (
              <Status tone="good">在线</Status>
            ) : (
              <Status tone="warn">
                <CloudOff size={12} />
                离线
              </Status>
            )}
            <button type="button" aria-label="通知">
              <Bell />
            </button>
            <span className="avatar">{userQuery.data?.displayName.slice(0, 1) ?? 'A'}</span>
          </div>
        </header>
        <main className="workspace-main">{pageContent}</main>
        <footer className="status-bar">
          <span>
            同步状态 <b>{queueQuery.data?.pending ? `${queueQuery.data.pending} 项待重试` : '已同步'}</b>
          </span>
          <span>客户端 v0.1.0</span>
          <span className={online ? 'online-dot' : 'offline-dot'}>{online ? '云端在线' : '离线模式'}</span>
        </footer>
      </div>
      {discovering ? (
        <DiscoveryModal
          cloud={cloud}
          local={local}
          session={session}
          organizationId={organizationId}
          spaces={spacesQuery.data ?? []}
          onClose={() => setDiscovering(false)}
          onPublished={() => {
            setDiscovering(false);
            setPage('publishing');
            void publicationsQuery.refetch();
            void capabilitiesQuery.refetch();
          }}
        />
      ) : null}
      {installing ? (
        <InstallModal
          capability={installing}
          cloud={cloud}
          local={local}
          session={session}
          organizationId={organizationId}
          agents={agentsQuery.data ?? []}
          online={online}
          onClose={() => setInstalling(undefined)}
          onInstalled={() => {
            setInstalling(undefined);
            void queryClient.invalidateQueries({ queryKey: ['installations', organizationId] });
          }}
        />
      ) : null}
    </div>
  );
}

export function DesktopApp({
  cloud,
  local,
  sessionStore,
}: {
  cloud: CloudClient;
  local: LocalClient;
  sessionStore: SessionStore;
}) {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false } } }),
    [],
  );
  return (
    <QueryClientProvider client={client}>
      <AppContent cloud={cloud} local={local} sessionStore={sessionStore} />
    </QueryClientProvider>
  );
}
