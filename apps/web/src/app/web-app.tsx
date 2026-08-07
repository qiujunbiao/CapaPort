import type { OrganizationRole } from '@agentdoor/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardCheck,
  DoorOpen,
  FileClock,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ErrorNotice, LoadingBlock, Status } from '../components/ui';
import { AnalyticsPage } from '../features/analytics/analytics-page';
import { AuditPage } from '../features/audit/audit-page';
import { AuthPage } from '../features/auth/auth-page';
import { MarketplacePage } from '../features/marketplace/marketplace-page';
import { DashboardPage } from '../features/organizations/dashboard-page';
import { MembersPage } from '../features/organizations/members-page';
import { OrganizationSettingsPage } from '../features/organizations/settings-page';
import { ReviewsPage } from '../features/reviews/reviews-page';
import { SecurityPage } from '../features/security/security-page';
import { SpacesPage } from '../features/spaces/spaces-page';
import type { WebClient, WebSessionStore } from './types';

type Page =
  | 'dashboard'
  | 'marketplace'
  | 'reviews'
  | 'members'
  | 'spaces'
  | 'security'
  | 'audit'
  | 'analytics'
  | 'settings';
const navigation: Array<{ id: Page; label: string; icon: typeof LayoutDashboard; roles?: OrganizationRole[] }> = [
  { id: 'dashboard', label: '组织概览', icon: LayoutDashboard },
  { id: 'marketplace', label: '能力市场', icon: Boxes },
  { id: 'reviews', label: '审核中心', icon: ClipboardCheck, roles: ['owner', 'admin'] },
  { id: 'members', label: '成员与邀请', icon: Users, roles: ['owner', 'admin'] },
  { id: 'spaces', label: '空间与策略', icon: Building2, roles: ['owner', 'admin'] },
  { id: 'security', label: '安全中心', icon: ShieldCheck, roles: ['owner', 'admin', 'auditor'] },
  { id: 'audit', label: '审计日志', icon: FileClock, roles: ['owner', 'admin', 'auditor'] },
  { id: 'analytics', label: '采用分析', icon: Activity, roles: ['owner', 'admin', 'auditor'] },
  { id: 'settings', label: '组织设置', icon: Settings },
];

function OrganizationSetup({ client, onReady }: { client: WebClient; onReady: (organizationId: string) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  async function submit() {
    setError('');
    try {
      if (mode === 'create') {
        const organization = await client.createOrganization({ name, slug });
        onReady(organization.id);
      } else {
        const result = await client.acceptInvitation(token);
        if (!result.organizationId) throw new Error('邀请不可用或已失效');
        onReady(result.organizationId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织设置失败');
    }
  }
  return (
    <main className="setup-layout">
      <div className="brand-lockup">
        <span>
          <DoorOpen />
        </span>
        <strong>AGENTDOOR</strong>
      </div>
      <section className="setup-card">
        <p className="eyebrow">ORGANIZATION ONBOARDING</p>
        <h1>建立共享边界</h1>
        <p>创建一个组织，或使用管理员发送的邀请令牌加入。</p>
        <div className="filter-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
            创建组织
          </button>
          <button type="button" role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
            接受邀请
          </button>
        </div>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
        {mode === 'create' ? (
          <>
            <label>
              组织名称
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              组织标识
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              />
            </label>
          </>
        ) : (
          <label>
            邀请令牌
            <textarea value={token} onChange={(event) => setToken(event.target.value)} rows={4} />
          </label>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={mode === 'create' ? name.length < 2 || slug.length < 2 : token.length < 32}
          onClick={() => void submit()}
        >
          {mode === 'create' ? '创建并进入' : '接受并进入'}
        </button>
      </section>
    </main>
  );
}

function Console({ client, sessionStore }: { client: WebClient; sessionStore: WebSessionStore }) {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const queryClient = useQueryClient();
  const [page, setPage] = useState<Page>('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const organizationsQuery = useQuery({
    queryKey: ['web-organizations'],
    queryFn: () => client.organizations(),
    enabled: Boolean(session),
    retry: false,
  });
  const organizations = organizationsQuery.data ?? [];
  const organizationId = session?.organizationId ?? organizations[0]?.id;
  const organization = organizations.find((item) => item.id === organizationId);
  const role = organization?.role;
  const canGovern = role === 'owner' || role === 'admin';
  const canObserve = canGovern || role === 'auditor';

  useEffect(() => {
    if (session && !session.organizationId && organizations[0])
      sessionStore.set({ ...session, organizationId: organizations[0].id });
  }, [organizations, session, sessionStore]);
  useEffect(() => {
    const item = navigation.find((entry) => entry.id === page);
    if (role && item?.roles && !item.roles.includes(role)) setPage('dashboard');
  }, [page, role]);

  const userQuery = useQuery({
    queryKey: ['web-me'],
    queryFn: () => client.me(),
    enabled: Boolean(session),
    retry: false,
  });
  const spacesQuery = useQuery({
    queryKey: ['web-spaces', organizationId],
    queryFn: () => client.spaces(),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['web-capabilities', organizationId],
    queryFn: () => client.capabilities(),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const publicationsQuery = useQuery({
    queryKey: ['web-publications', organizationId],
    queryFn: () => client.publications(),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const membersQuery = useQuery({
    queryKey: ['web-members', organizationId],
    queryFn: () => client.members(organizationId ?? ''),
    enabled: Boolean(organizationId && canObserve),
    retry: false,
  });
  const invitationsQuery = useQuery({
    queryKey: ['web-invitations', organizationId],
    queryFn: () => client.invitations(organizationId ?? ''),
    enabled: Boolean(organizationId && canGovern),
    retry: false,
  });
  const metricsQuery = useQuery({
    queryKey: ['web-metrics', organizationId],
    queryFn: () => client.metrics(),
    enabled: Boolean(organizationId && canObserve),
    retry: false,
  });

  if (!session) return <AuthPage client={client} sessionStore={sessionStore} />;
  if (organizationsQuery.isLoading)
    return (
      <div className="app-loading">
        <DoorOpen />
        <LoadingBlock label="加载组织上下文" />
      </div>
    );
  if (organizationsQuery.error)
    return (
      <main className="fatal-state">
        <ErrorNotice onRetry={() => void organizationsQuery.refetch()}>{organizationsQuery.error.message}</ErrorNotice>
      </main>
    );
  if (!organizations.length)
    return (
      <OrganizationSetup
        client={client}
        onReady={(id) => {
          sessionStore.set({ ...session, organizationId: id });
          void organizationsQuery.refetch();
        }}
      />
    );
  if (!organization || !organizationId) return <LoadingBlock />;

  const refreshCore = async () => {
    await Promise.all([
      spacesQuery.refetch(),
      capabilitiesQuery.refetch(),
      publicationsQuery.refetch(),
      metricsQuery.refetch(),
    ]);
  };
  const pageContent = (() => {
    if (page === 'dashboard')
      return (
        <DashboardPage
          capabilities={capabilitiesQuery.data ?? []}
          publications={publicationsQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          members={membersQuery.data ?? []}
          metrics={metricsQuery.data}
          onNavigate={(next) => setPage(next as Page)}
        />
      );
    if (page === 'marketplace')
      return (
        <MarketplacePage
          client={client}
          capabilities={capabilitiesQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          canGovern={canGovern}
          onRefresh={() => void refreshCore()}
        />
      );
    if (page === 'reviews')
      return (
        <ReviewsPage
          client={client}
          publications={publicationsQuery.data ?? []}
          capabilities={capabilitiesQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          onRefresh={refreshCore}
        />
      );
    if (page === 'members')
      return (
        <MembersPage
          client={client}
          organizationId={organizationId}
          members={membersQuery.data ?? []}
          invitations={invitationsQuery.data ?? []}
          onRefresh={async () => {
            await Promise.all([membersQuery.refetch(), invitationsQuery.refetch()]);
          }}
        />
      );
    if (page === 'spaces')
      return (
        <SpacesPage
          client={client}
          spaces={spacesQuery.data ?? []}
          onRefresh={async () => {
            await spacesQuery.refetch();
          }}
        />
      );
    if (page === 'security') return <SecurityPage client={client} />;
    if (page === 'audit') return <AuditPage client={client} />;
    if (page === 'analytics') return <AnalyticsPage metrics={metricsQuery.data} />;
    return (
      <OrganizationSettingsPage
        client={client}
        organization={organization}
        user={userQuery.data}
        canManage={canGovern}
        onSaved={async () => {
          await organizationsQuery.refetch();
        }}
        onLogout={() => {
          void client.logout().catch(() => undefined);
          sessionStore.clear();
          queryClient.clear();
        }}
      />
    );
  })();
  const allowedNavigation = navigation.filter((item) => !item.roles || (role && item.roles.includes(role)));

  async function switchOrganization(next: string) {
    if (next === organizationId) return;
    if (!session) return;
    await client.switchOrganization(next);
    sessionStore.set({ ...session, organizationId: next });
    queryClient.removeQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith('web-') && query.queryKey[0] !== 'web-organizations',
    });
    setPage('dashboard');
  }

  return (
    <div className="web-shell">
      <aside className={mobileNav ? 'admin-sidebar open' : 'admin-sidebar'}>
        <div className="sidebar-brand">
          <span>
            <DoorOpen />
          </span>
          <div>
            <strong>AGENTDOOR</strong>
            <small>CONTROL PLANE</small>
          </div>
          <button type="button" aria-label="关闭导航" onClick={() => setMobileNav(false)}>
            <X />
          </button>
        </div>
        <nav aria-label="管理后台导航">
          {allowedNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => {
                  setPage(item.id);
                  setMobileNav(false);
                }}
              >
                <Icon />
                <span>{item.label}</span>
                {item.id === 'reviews' &&
                (publicationsQuery.data ?? []).some((publication) => publication.status === 'in_review') ? (
                  <i />
                ) : null}
              </button>
            );
          })}
        </nav>
        <footer>
          <span className="registry-mark">
            AD
            <br />
            REG
          </span>
          <div>
            <strong>组织治理已启用</strong>
            <small>租户隔离 · 不可变审计</small>
          </div>
        </footer>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <button type="button" className="mobile-menu" aria-label="打开导航" onClick={() => setMobileNav(true)}>
            <Menu />
          </button>
          <label className="organization-picker">
            <span>当前组织</span>
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
            <ChevronDown />
          </label>
          <div className="topbar-actions">
            <Status tone="good">服务正常</Status>
            <button type="button" aria-label="通知">
              <Bell />
            </button>
            <span className="user-avatar">{userQuery.data?.displayName.slice(0, 1) ?? 'A'}</span>
            <div>
              <strong>{userQuery.data?.displayName ?? '—'}</strong>
              <small>{organization.role}</small>
            </div>
          </div>
        </header>
        <main className="admin-main">{pageContent}</main>
        <footer className="admin-footer">
          <span>Agentdoor Control Plane · v0.1.0</span>
          <span>区域：本地部署</span>
          <span>
            <i /> API 可用
          </span>
        </footer>
      </div>
      {mobileNav ? (
        <button type="button" className="nav-scrim" aria-label="关闭导航遮罩" onClick={() => setMobileNav(false)} />
      ) : null}
    </div>
  );
}

export function WebApp({ client, sessionStore }: { client: WebClient; sessionStore: WebSessionStore }) {
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } }),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Console client={client} sessionStore={sessionStore} />
    </QueryClientProvider>
  );
}
