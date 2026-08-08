import type {
  AgentId,
  CapabilitySummary,
  OrganizationSecurityPolicy,
  OrganizationSummary,
  SpaceSummary,
  UpdateCheck,
} from '@capaport/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Box,
  Boxes,
  Building2,
  ClipboardCheck,
  CloudOff,
  FileClock,
  FilePenLine,
  FolderGit2,
  Home,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BrandLockup } from '../components/brand';
import { ErrorNotice, Status } from '../components/ui';
import { DiscoveryModal } from '../features/agents/discovery-modal';
import { HomePage } from '../features/agents/home-page';
import { AuthScreen } from '../features/auth/auth-screen';
import { OrganizationOnboarding } from '../features/auth/organization-onboarding';
import { AuthoringPage } from '../features/authoring/authoring-page';
import { AnalyticsPage } from '../features/governance/analytics-page';
import { AuditPage } from '../features/governance/audit-page';
import { CapabilityAssetsPage } from '../features/governance/capability-assets-page';
import { MembersPage } from '../features/governance/members-page';
import { OrganizationOverviewPage } from '../features/governance/organization-overview-page';
import { OrganizationSettingsPage } from '../features/governance/organization-settings-page';
import { SecurityCenterPage } from '../features/governance/security-center-page';
import { SpacesGovernancePage } from '../features/governance/spaces-page';
import { InstallModal } from '../features/library/install-modal';
import { LibraryPage } from '../features/library/library-page';
import { ProjectsPage } from '../features/projects/projects-page';
import { PublishingPage } from '../features/publishing/publishing-page';
import { SettingsPage } from '../features/settings/settings-page';
import { CloudError } from './cloud-client';
import { createQueuedCloudClient, OfflineWriteQueue, queuedCloudHandlers } from './offline-queue';
import type { AuditPage as AuditPageData, CloudClient, InstallationSummary, LocalClient, SessionStore } from './types';

type Page =
  | 'home'
  | 'library'
  | 'authoring'
  | 'projects'
  | 'publishing'
  | 'settings'
  | 'overview'
  | 'assets'
  | 'reviews'
  | 'members'
  | 'spaces-admin'
  | 'security'
  | 'audit'
  | 'analytics'
  | 'org-settings';
type NavItem = { id: Page; label: string; icon: typeof Home; observe?: boolean; manage?: boolean };
const workspaceNav: NavItem[] = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'library', label: '能力库', icon: Box },
  { id: 'authoring', label: '创作', icon: FilePenLine },
  { id: 'projects', label: '项目', icon: FolderGit2 },
  { id: 'publishing', label: '发布', icon: Send },
  { id: 'settings', label: '设置', icon: Settings },
];
const governanceNav: NavItem[] = [
  { id: 'overview', label: '组织概览', icon: LayoutDashboard },
  { id: 'assets', label: '能力资产', icon: Boxes },
  { id: 'reviews', label: '审核中心', icon: ClipboardCheck, manage: true },
  { id: 'members', label: '成员与邀请', icon: Users, manage: true },
  { id: 'spaces-admin', label: '空间与策略', icon: Building2, manage: true },
  { id: 'security', label: '安全中心', icon: ShieldAlert, observe: true },
  { id: 'audit', label: '审计日志', icon: FileClock, observe: true },
  { id: 'analytics', label: '采用分析', icon: Activity, observe: true },
  { id: 'org-settings', label: '组织设置', icon: Settings },
];

function downloadJson(fileName: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cacheKey(organizationId: string, kind: string) {
  return `capaport:cache:${organizationId}:${kind}`;
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
  cloud: baseCloud,
  local,
  sessionStore,
}: {
  cloud: CloudClient;
  local: LocalClient;
  sessionStore: SessionStore;
}) {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
  const queryClient = useQueryClient();
  const offlineQueue = useMemo(
    () => new OfflineWriteQueue(local, { online: () => baseCloud.isOnline() }),
    [baseCloud, local],
  );
  const cloud = useMemo(() => createQueuedCloudClient(baseCloud, offlineQueue), [baseCloud, offlineQueue]);
  const [page, setPage] = useState<Page>('home');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [online, setOnline] = useState(baseCloud.isOnline());
  const [discovering, setDiscovering] = useState(false);
  const [installing, setInstalling] = useState<CapabilitySummary>();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const update = () => setOnline(baseCloud.isOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [baseCloud]);

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
  const canManage = organization?.role === 'owner' || organization?.role === 'admin';
  const canObserve = canManage || organization?.role === 'auditor';
  const organizationAuthenticationFailed =
    organizationsQuery.error instanceof CloudError && organizationsQuery.error.code.startsWith('AUTH_');

  useEffect(() => {
    if (!organizationAuthenticationFailed) return;
    sessionStore.clear();
    queryClient.clear();
  }, [organizationAuthenticationFailed, queryClient, sessionStore]);

  useEffect(() => {
    if (session && !session.organizationId && organizations[0])
      sessionStore.set({ ...session, organizationId: organizations[0].id });
  }, [organizations, session, sessionStore]);

  useEffect(() => {
    const item = governanceNav.find((entry) => entry.id === page);
    if (item && ((item.manage && !canManage) || (item.observe && !canObserve))) setPage('home');
  }, [canManage, canObserve, page]);

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
    queryFn: async () => {
      const detected = await local.detectAgents();
      if (session && organizationId && online) {
        void Promise.all(
          detected.map((agent) =>
            cloud.recordAnalyticsEvent(session, organizationId, {
              eventName: 'agent.discovered',
              agent: agent.adapterId as AgentId,
              source: 'desktop',
              outcome: 'success',
            }),
          ),
        ).catch(() => undefined);
      }
      return detected;
    },
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
  const securityPolicyQuery = useQuery({
    queryKey: ['security-policy', organizationId],
    queryFn: async () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      const value = await cloud.securityPolicy(session, organizationId);
      writeCache(organizationId, 'security-policy', value);
      return value;
    },
    initialData: organizationId ? readCache<OrganizationSecurityPolicy>(organizationId, 'security-policy') : undefined,
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
  const membersQuery = useQuery({
    queryKey: ['members', organizationId],
    queryFn: () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      return cloud.members(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online && canObserve),
    retry: false,
  });
  const invitationsQuery = useQuery({
    queryKey: ['invitations', organizationId],
    queryFn: () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      return cloud.invitations(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online && canManage),
    retry: false,
  });
  const metricsQuery = useQuery({
    queryKey: ['metrics', organizationId],
    queryFn: () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      return cloud.metrics(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online && canObserve),
    retry: false,
  });
  const sessionsQuery = useQuery({
    queryKey: ['sessions', session?.accessToken],
    queryFn: () => {
      if (!session) throw new Error('Authentication is required');
      return cloud.sessions(session);
    },
    enabled: Boolean(session && online && canObserve),
    retry: false,
  });
  const deadLettersQuery = useQuery({
    queryKey: ['dead-letters', organizationId],
    queryFn: () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      return cloud.deadLetters(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online && canObserve),
    retry: false,
  });
  const auditQuery = useQuery({
    queryKey: ['audit', organizationId],
    queryFn: () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      return cloud.audit(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online && canObserve),
    retry: false,
  });
  const publicationRisksQuery = useQuery({
    queryKey: ['publication-risks', organizationId],
    queryFn: async () => {
      if (!session || !organizationId) throw new Error('Select an organization');
      const publications = publicationsQuery.data ?? (await cloud.publications(session, organizationId));
      const risks = await Promise.all(
        publications.map(async (publication) => {
          const report = await cloud.scanReport(session, organizationId, publication.id);
          return {
            publicationId: publication.id,
            version: publication.version,
            findings: Array.isArray(report.findings)
              ? (report.findings as Array<{
                  ruleId?: string;
                  path?: string;
                  message?: string;
                  severity?: string;
                  blocking?: boolean;
                }>)
              : [],
          };
        }),
      );
      return risks.filter((risk) => risk.findings.length > 0);
    },
    enabled: Boolean(session && organizationId && online && canObserve && page === 'security'),
    retry: false,
  });
  const accountDeletionQuery = useQuery({
    queryKey: ['account-deletion', session?.accessToken],
    queryFn: () => {
      if (!session) throw new Error('Authentication is required');
      return cloud.accountDeletionStatus(session);
    },
    enabled: Boolean(session && online),
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
  useEffect(() => {
    if (!online || !session) return;
    void offlineQueue.syncNow(queuedCloudHandlers(baseCloud, session)).then(() => queueQuery.refetch());
  }, [baseCloud, offlineQueue, online, queueQuery.refetch, session]);
  const notificationsQuery = useQuery({
    queryKey: ['notifications', organizationId],
    queryFn: () => {
      if (!session || !organizationId || !cloud.notifications) throw new Error('当前服务不支持通知');
      return cloud.notifications(session, organizationId);
    },
    enabled: Boolean(session && organizationId && online && notificationsOpen && cloud.notifications),
    retry: false,
  });

  async function switchOrganization(nextId: string) {
    if (!session || nextId === organizationId) return;
    await cloud.switchOrganization(session, nextId);
    sessionStore.set({ ...session, organizationId: nextId });
    setPage('home');
  }

  if (!session) return <AuthScreen cloud={cloud} sessionStore={sessionStore} />;
  if (organizationsQuery.isError)
    return (
      <div className="app-loading">
        <BrandLockup tone="light" />
        <ErrorNotice onRetry={() => void organizationsQuery.refetch()}>
          {organizationAuthenticationFailed ? '登录状态已失效，正在返回登录页' : '无法加载组织，请检查连接后重试'}
        </ErrorNotice>
      </div>
    );
  if (organizationsQuery.isSuccess && organizations.length === 0)
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
        <BrandLockup tone="light" />
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
          onUninstall={async (capability, installation) => {
            if (!session || !organizationId) return;
            const agent = (agentsQuery.data ?? []).find((item) => item.adapterId === installation.agent);
            if (!agent) throw new Error('未找到对应 Agent 目录');
            await local.uninstall({
              adapterId: installation.agent,
              capabilitySlug: capability.slug,
              rootPath: agent.rootPath,
            });
            await cloud.reportInstallation({
              session,
              organizationId,
              deviceId: installation.deviceId,
              capabilityId: installation.capabilityId,
              versionId: installation.versionId,
              agent: installation.agent,
              outcome: 'uninstalled',
            });
            void cloud
              .recordAnalyticsEvent(session, organizationId, {
                eventName: 'capability.uninstalled',
                capabilityId: installation.capabilityId,
                agent: installation.agent,
                source: 'desktop',
                outcome: 'success',
              })
              .catch(() => undefined);
            await queryClient.invalidateQueries({ queryKey: ['installations', organizationId] });
          }}
        />
      );
    if (page === 'authoring')
      return (
        <AuthoringPage
          cloud={cloud}
          session={session}
          organizationId={organizationId}
          spaces={spacesQuery.data ?? []}
          capabilities={capabilitiesQuery.data ?? []}
          publications={publicationsQuery.data ?? []}
          online={online}
          {...(securityPolicyQuery.data ? { securityPolicy: securityPolicyQuery.data } : {})}
          onSubmitted={() => {
            void publicationsQuery.refetch();
            void capabilitiesQuery.refetch();
          }}
        />
      );
    if (page === 'projects')
      return (
        <ProjectsPage
          spaces={spacesQuery.data ?? []}
          loadBindings={(spaceId) => local.listProjectBindings(spaceId)}
          onBind={async (spaceId, path, agents) => {
            if (!session || !organizationId || !cloud.devices || !cloud.registerDevice)
              throw new Error('当前客户端不支持项目同步');
            const localBinding = await local.bindProjectDirectory({ spaceId, path, agents });
            try {
              const devices = await cloud.devices(session, organizationId);
              const device =
                devices.find(
                  (item) => agents.every((agent) => item.supportedAgents.includes(agent)) && item.status === 'active',
                ) ?? (await cloud.registerDevice(session, organizationId, agents));
              await cloud.createProjectBinding({
                session,
                organizationId,
                spaceId,
                deviceId: device.id,
                localBindingId: localBinding.localBindingId,
                agents,
              });
            } catch (error) {
              await local.removeProjectBinding(localBinding.localBindingId).catch(() => undefined);
              throw error;
            }
          }}
          onRemove={async (spaceId, binding) => {
            if (!session || !organizationId) throw new Error('请选择组织');
            const cloudBinding = (await cloud.projectBindings(session, organizationId, spaceId)).find(
              (item) => item.localBindingId === binding.localBindingId,
            );
            if (cloudBinding && cloud.removeProjectBinding) {
              await cloud.removeProjectBinding(session, organizationId, spaceId, cloudBinding.id);
            }
            await local.removeProjectBinding(binding.localBindingId);
          }}
          onInventory={(binding) => local.inventoryProjectContext(binding.localBindingId)}
          onSync={async (spaceId, binding, selectedPaths, agents) => {
            if (!session || !organizationId) throw new Error('请选择组织');
            const cloudBinding = (await cloud.projectBindings(session, organizationId, spaceId)).find(
              (item) => item.localBindingId === binding.localBindingId && item.status === 'active',
            );
            if (!cloudBinding) throw new Error('云端绑定不存在，请重新绑定目录');
            const context = await local.exportProjectContext({
              localBindingId: binding.localBindingId,
              selectedPaths,
              agents: agents as AgentId[],
            });
            const appliedTransactions: string[] = [];
            try {
              for (const adapterId of agents) {
                const plan = await local.projectContextPlan({
                  localBindingId: binding.localBindingId,
                  selectedPaths,
                  adapterId,
                  rootPath: binding.localPath,
                });
                const applied = await local.applyInstall(plan);
                appliedTransactions.push(applied.transactionId);
              }
              await cloud.syncProjectContext({
                session,
                organizationId,
                spaceId,
                bindingId: cloudBinding.id,
                context,
              });
            } catch (error) {
              for (const transactionId of appliedTransactions.reverse()) {
                await local.rollbackInstall(transactionId).catch(() => undefined);
              }
              throw error;
            }
          }}
        />
      );
    if (page === 'overview')
      return (
        <OrganizationOverviewPage
          capabilities={capabilitiesQuery.data ?? []}
          publications={publicationsQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          members={membersQuery.data ?? []}
          {...(metricsQuery.data ? { metrics: metricsQuery.data } : {})}
          canManage={Boolean(canManage)}
          onNavigate={(next) => setPage(next as Page)}
        />
      );
    if (page === 'assets')
      return (
        <CapabilityAssetsPage
          capabilities={capabilitiesQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          online={online}
          canManage={Boolean(canManage)}
          {...(userQuery.data?.id ? { currentUserId: userQuery.data.id } : {})}
          loadVersions={async (capabilityId) => {
            if (!session || !organizationId || !cloud.versions) throw new Error('当前服务不支持版本管理');
            return cloud.versions(session, organizationId, capabilityId);
          }}
          loadDiff={(capabilityId, versionId, againstVersionId) =>
            cloud.versionDiff(session, organizationId, capabilityId, versionId, againstVersionId)
          }
          onUpdate={async (capabilityId, input) => {
            await cloud.updateCapability(session, organizationId, capabilityId, input);
            await queryClient.invalidateQueries({ queryKey: ['capabilities', organizationId] });
          }}
          onTransition={async (capabilityId, versionId, action) => {
            await cloud.transitionVersion(session, organizationId, capabilityId, versionId, action);
            await queryClient.invalidateQueries({ queryKey: ['capabilities', organizationId] });
          }}
        />
      );
    if (page === 'publishing' || page === 'reviews')
      return (
        <PublishingPage
          publications={publicationsQuery.data ?? []}
          capabilities={capabilitiesQuery.data ?? []}
          spaces={spacesQuery.data ?? []}
          canReview={Boolean(canManage)}
          online={online}
          loadReviewContext={async (publicationId) => {
            if (!session || !organizationId) throw new Error('请选择组织');
            const [details, scan, diff] = await Promise.all([
              cloud.publicationDetails(session, organizationId, publicationId),
              cloud.scanReport(session, organizationId, publicationId),
              cloud.publicationDiff(session, organizationId, publicationId),
            ]);
            return { details, scan, diff };
          }}
          onReview={async (publicationId, decision, reason) => {
            if (!session || !organizationId) throw new Error('请选择组织');
            await cloud.reviewPublication(session, organizationId, publicationId, decision, reason);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['publications', organizationId] }),
              queryClient.invalidateQueries({ queryKey: ['capabilities', organizationId] }),
            ]);
          }}
        />
      );
    if (page === 'members')
      return (
        <MembersPage
          online={online}
          members={membersQuery.data ?? []}
          invitations={invitationsQuery.data ?? []}
          onInvite={async (input) => {
            await cloud.invite(session, organizationId, input);
            await invitationsQuery.refetch();
          }}
          onRevokeInvitation={async (invitationId) => {
            await cloud.revokeInvitation(session, organizationId, invitationId);
            await invitationsQuery.refetch();
          }}
          onChangeRole={async (membershipId, role) => {
            await cloud.changeMemberRole(session, organizationId, membershipId, role);
            await Promise.all([membersQuery.refetch(), organizationsQuery.refetch()]);
          }}
          onRemove={async (membershipId) => {
            await cloud.removeMember(session, organizationId, membershipId);
            await membersQuery.refetch();
          }}
        />
      );
    if (page === 'spaces-admin')
      return (
        <SpacesGovernancePage
          online={online}
          spaces={spacesQuery.data ?? []}
          organizationMembers={membersQuery.data ?? []}
          loadMembers={(spaceId) => cloud.spaceMembers(session, organizationId, spaceId)}
          onCreate={async (input) => {
            await cloud.createSpace(session, organizationId, input);
            await spacesQuery.refetch();
          }}
          onPolicy={async (spaceId, reviewPolicy) => {
            await cloud.updateSpacePolicy(session, organizationId, spaceId, reviewPolicy);
            await spacesQuery.refetch();
          }}
          onArchive={async (spaceId) => {
            await cloud.archiveSpace(session, organizationId, spaceId);
            await spacesQuery.refetch();
          }}
          onAddMember={(spaceId, userId, role) => cloud.addSpaceMember(session, organizationId, spaceId, userId, role)}
          onChangeMemberRole={(spaceId, membershipId, role) =>
            cloud.changeSpaceMemberRole(session, organizationId, spaceId, membershipId, role)
          }
          onRemoveMember={(spaceId, membershipId) =>
            cloud.removeSpaceMember(session, organizationId, spaceId, membershipId)
          }
        />
      );
    if (page === 'security' && securityPolicyQuery.data)
      return (
        <SecurityCenterPage
          online={online}
          canManage={Boolean(canManage)}
          policy={securityPolicyQuery.data}
          sessions={sessionsQuery.data ?? []}
          deadLetters={deadLettersQuery.data ?? []}
          publicationRisks={publicationRisksQuery.data ?? []}
          onSavePolicy={async (policy) => {
            await cloud.updateSecurityPolicy(session, organizationId, policy);
            await securityPolicyQuery.refetch();
          }}
          onRevokeSession={async (sessionId) => {
            await cloud.revokeSession(session, sessionId);
            await sessionsQuery.refetch();
          }}
          onRetryDeadLetter={async (kind, jobId) => {
            await cloud.retryDeadLetter(session, organizationId, kind, jobId);
            await deadLettersQuery.refetch();
          }}
        />
      );
    if (page === 'audit')
      return (
        <AuditPage
          entries={auditQuery.data?.entries ?? []}
          hasMore={Boolean(auditQuery.data?.nextCursor)}
          onFilter={async (action) => {
            const result = await cloud.audit(session, organizationId, action.trim() ? { action: action.trim() } : {});
            queryClient.setQueryData<AuditPageData>(['audit', organizationId], result);
          }}
          onLoadMore={async (action) => {
            const current = auditQuery.data;
            if (!current?.nextCursor) return;
            const next = await cloud.audit(session, organizationId, {
              ...(action ? { action } : {}),
              cursor: current.nextCursor,
            });
            queryClient.setQueryData<AuditPageData>(['audit', organizationId], {
              entries: [...current.entries, ...next.entries],
              ...(next.nextCursor ? { nextCursor: next.nextCursor } : {}),
            });
          }}
        />
      );
    if (page === 'analytics') return <AnalyticsPage {...(metricsQuery.data ? { metrics: metricsQuery.data } : {})} />;
    if (page === 'org-settings' && organization)
      return (
        <OrganizationSettingsPage
          online={online}
          canManage={Boolean(canManage)}
          organization={organization}
          {...(userQuery.data ? { user: userQuery.data } : {})}
          members={membersQuery.data ?? []}
          accountDeletionStatus={accountDeletionQuery.data ?? { status: 'none' }}
          onRename={async (name) => {
            if (!cloud.updateOrganization) throw new Error('当前服务不支持修改组织信息');
            await cloud.updateOrganization(session, organizationId, { name });
            await organizationsQuery.refetch();
          }}
          onExportOrganization={async () =>
            downloadJson(`${organization.slug}-export.json`, await cloud.exportOrganization(session, organizationId))
          }
          onExportAccount={async () => downloadJson('capaport-account-export.json', await cloud.exportAccount(session))}
          onTransferOwnership={async (membershipId) => {
            await cloud.transferOwnership(session, organizationId, membershipId);
            await Promise.all([organizationsQuery.refetch(), membersQuery.refetch()]);
          }}
          onLeave={async () => {
            await cloud.leaveOrganization(session, organizationId);
            const { organizationId: _organizationId, ...sessionWithoutOrganization } = session;
            sessionStore.set(sessionWithoutOrganization);
            await organizationsQuery.refetch();
            setPage('home');
          }}
          onCloseOrganization={async (confirmation) => {
            await cloud.closeOrganization(session, organizationId, confirmation);
            await organizationsQuery.refetch();
          }}
          onCancelClosure={async () => {
            await cloud.cancelOrganizationClosure(session, organizationId);
            await organizationsQuery.refetch();
          }}
          onRequestAccountDeletion={async () => {
            await cloud.requestAccountDeletion(session);
            await accountDeletionQuery.refetch();
          }}
          onCancelAccountDeletion={async () => {
            await cloud.cancelAccountDeletion(session);
            await accountDeletionQuery.refetch();
          }}
        />
      );
    return (
      <SettingsPage
        key={organization?.id}
        user={userQuery.data}
        organization={organization}
        queue={queueQuery.data}
        online={online}
        onLogout={async () => {
          try {
            await cloud.logout(session);
          } finally {
            sessionStore.clear();
            queryClient.clear();
          }
        }}
        onRefreshQueue={() => void queueQuery.refetch()}
        onAcceptInvitation={async (token) => {
          if (!session || !cloud.acceptInvitation) throw new Error('当前客户端不支持接受组织邀请');
          const result = await cloud.acceptInvitation(session, token);
          if (result.status !== 'accepted' || !result.organizationId) throw new Error('邀请已失效或不匹配当前账号');
          sessionStore.set({ ...session, organizationId: result.organizationId });
          await organizationsQuery.refetch();
          setPage('home');
        }}
        onUpdateOrganization={async (name) => {
          if (!session || !organizationId || !cloud.updateOrganization) throw new Error('当前客户端不支持修改组织信息');
          await cloud.updateOrganization(session, organizationId, { name });
          queryClient.setQueryData<OrganizationSummary[]>(['organizations', session.accessToken], (current) =>
            current?.map((item) => (item.id === organizationId ? { ...item, name } : item)),
          );
        }}
        onSyncQueue={() => {
          if (!session) return;
          void offlineQueue
            .retryFailed()
            .then(() => offlineQueue.syncNow(queuedCloudHandlers(baseCloud, session)))
            .then(() => queueQuery.refetch());
        }}
      />
    );
  })();
  const personalSpaceId = spacesQuery.data?.find((space) => space.type === 'personal')?.id;

  return (
    <div className={`desktop-shell ${railCollapsed ? 'desktop-shell--collapsed' : ''}`}>
      <aside className="side-rail">
        <div className="side-rail__brand">
          <BrandLockup tone="dark" context="CAPABILITY REGISTRY" compact={railCollapsed} />
          <button
            type="button"
            aria-label={railCollapsed ? '展开侧栏' : '收起侧栏'}
            onClick={() => setRailCollapsed((value) => !value)}
          >
            {railCollapsed ? <Menu /> : <PanelLeftClose />}
          </button>
        </div>
        <nav aria-label="主导航">
          <span className="side-rail__section-label">工作区</span>
          {workspaceNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                aria-label={item.label}
                title={item.label}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
              </button>
            );
          })}
          <span className="side-rail__section-label">组织治理</span>
          {governanceNav
            .filter((item) => (!item.manage || canManage) && (!item.observe || canObserve))
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-label={item.label}
                  title={item.label}
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
            <div className="notification-menu">
              <button type="button" aria-label="通知" onClick={() => setNotificationsOpen((value) => !value)}>
                <Bell />
              </button>
              {notificationsOpen ? (
                <section className="notification-popover" aria-label="通知列表">
                  <h2>通知</h2>
                  {notificationsQuery.data?.notifications.length ? (
                    notificationsQuery.data.notifications.map((item) => (
                      <article key={item.id}>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        {!item.readAt ? (
                          <button
                            type="button"
                            className="text-button"
                            onClick={async () => {
                              if (!session || !organizationId || !cloud.markNotificationRead) return;
                              await cloud.markNotificationRead(session, organizationId, item.id);
                              await notificationsQuery.refetch();
                            }}
                          >
                            标为已读
                          </button>
                        ) : (
                          <small>已读</small>
                        )}
                      </article>
                    ))
                  ) : (
                    <p>{notificationsQuery.isLoading ? '正在加载…' : '暂无通知'}</p>
                  )}
                </section>
              ) : null}
            </div>
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
          {...(securityPolicyQuery.data ? { securityPolicy: securityPolicyQuery.data } : {})}
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
          {...(updateChecksQuery.data?.[installing.id] ? { updateCheck: updateChecksQuery.data[installing.id] } : {})}
          {...(personalSpaceId ? { personalSpaceId } : {})}
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
