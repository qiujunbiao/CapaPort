import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsPage } from './analytics-page';
import { AuditPage } from './audit-page';
import { OrganizationOverviewPage } from './organization-overview-page';
import { OrganizationSettingsPage } from './organization-settings-page';
import { SecurityCenterPage } from './security-center-page';

describe('Desktop governance pages', () => {
  it('renders organization asset, publication, member, and adoption metrics', () => {
    render(
      <OrganizationOverviewPage
        capabilities={[]}
        publications={[]}
        spaces={[]}
        members={[]}
        metrics={{
          range: { from: '', to: '' },
          productEvents: {},
          publicationFunnel: {},
          installationOutcomes: { installed: 4 },
          activeDevices: 2,
        }}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('组织概览')).toBeInTheDocument();
    expect(screen.getByText('成功安装').previousElementSibling).toHaveTextContent('4');
  });

  it('shows pending review summaries and capability update counts to managers', () => {
    const onNavigate = vi.fn();
    render(
      <OrganizationOverviewPage
        capabilities={[]}
        publications={[
          {
            id: 'publication-a',
            organizationId: 'org-a',
            capabilityId: 'capability-a',
            sourceSpaceId: 'space-a',
            sourceRevisionId: 'revision-a',
            targetSpaceId: 'space-org',
            candidateDigest: 'a'.repeat(64),
            version: '1.2.0',
            status: 'in_review',
            submittedByUserId: 'user-a',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        ]}
        spaces={[]}
        members={[]}
        metrics={{
          range: { from: '', to: '' },
          productEvents: { 'capability.updated': 7 },
          publicationFunnel: {},
          installationOutcomes: {},
          activeDevices: 2,
        }}
        canManage
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('版本 1.2.0')).toBeInTheDocument();
    expect(screen.getByText('成功安装').parentElement).toHaveTextContent(/7\s*次更新/);
    fireEvent.click(screen.getByRole('button', { name: /版本 1.2.0/ }));
    expect(onNavigate).toHaveBeenCalledWith('reviews');
  });

  it('updates security policy, revokes sessions, and retries dead letters', async () => {
    const onSavePolicy = vi.fn(async () => undefined);
    const onRevokeSession = vi.fn(async () => undefined);
    const onRetryDeadLetter = vi.fn(async () => undefined);
    render(
      <SecurityCenterPage
        online
        canManage
        policy={{
          blockedSeverities: ['critical'],
          confirmationSeverities: ['medium'],
          blockedTerms: [],
          allowedExecutablePaths: [],
          allowedNetworkHosts: [],
          executablePolicy: 'confirm',
        }}
        sessions={[{ id: 'session-a', deviceName: 'Mac', current: false, createdAt: '', lastSeenAt: '' }]}
        deadLetters={[{ id: 'job-a', kind: 'operation', status: 'dead_letter' }]}
        publicationRisks={[
          {
            publicationId: 'publication-a',
            version: '1.0.0',
            findings: [
              {
                ruleId: 'SEC_NETWORK_HOST',
                path: 'SKILL.md',
                message: '发现未授权网络主机',
                severity: 'high',
                blocking: true,
              },
            ],
          },
        ]}
        onSavePolicy={onSavePolicy}
        onRevokeSession={onRevokeSession}
        onRetryDeadLetter={onRetryDeadLetter}
      />,
    );
    fireEvent.change(screen.getByLabelText('可执行文件策略'), { target: { value: 'deny' } });
    fireEvent.change(screen.getByLabelText('允许的网络主机'), { target: { value: 'api.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '保存安全策略' }));
    await waitFor(() =>
      expect(onSavePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ executablePolicy: 'deny', allowedNetworkHosts: ['api.example.com'] }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销会话 Mac' }));
    await waitFor(() => expect(onRevokeSession).toHaveBeenCalledWith('session-a'));
    await waitFor(() => expect(screen.getByRole('button', { name: '重试任务 job-a' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '重试任务 job-a' }));
    await waitFor(() => expect(onRetryDeadLetter).toHaveBeenCalledWith('operation', 'job-a'));
    expect(screen.getByText('SEC_NETWORK_HOST')).toBeInTheDocument();
    expect(screen.getByText(/1.0.0 · SKILL.md/)).toBeInTheDocument();
  });

  it('does not expose manager-only overview actions to regular members', () => {
    render(
      <OrganizationOverviewPage
        capabilities={[]}
        publications={[]}
        spaces={[]}
        members={[]}
        canManage={false}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /处理 .* 项审核/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /维护 .* 个空间/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '管理组织成员' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /管理 .* 项资产/ })).toBeInTheDocument();
  });

  it('renders audit entries with understandable Chinese labels and filters by known actions', async () => {
    const onFilter = vi.fn(async () => undefined);
    render(
      <AuditPage
        entries={[
          {
            id: 'audit-a',
            action: 'publication.approve',
            resourceType: 'publication',
            resourceId: 'a7319469-8be0-415c-81f2-49ac402fd398',
            actorUserId: 'd2366863-27fa-4b69-b9b1-59b95558a76e',
            metadata: { decision: 'approve', accessToken: 'must-not-render' },
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        ]}
        onFilter={onFilter}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    );
    const auditAction = screen.getByLabelText('审计动作');
    expect(auditAction.closest('label')).toHaveClass('audit-filter');
    expect(auditAction.closest('label')).not.toHaveClass('search-field');
    expect(screen.getByText('发布审核已通过', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '发布审核已通过' })).toBeInTheDocument();
    expect(screen.getByText(/发布申请 · a7319469…d398/)).toBeInTheDocument();
    expect(screen.getByText(/操作人 · d2366863…a76e/)).toBeInTheDocument();
    expect(screen.getByText('查看技术详情')).toBeInTheDocument();
    expect(screen.getByText('publication.approve')).toBeInTheDocument();
    expect(screen.getByText(/"decision":"approve"/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('must-not-render');
    fireEvent.change(auditAction, { target: { value: 'publication.approve' } });
    await waitFor(() => expect(onFilter).toHaveBeenCalledWith('publication.approve'));
  });

  it('renders analytics', () => {
    render(
      <AnalyticsPage
        metrics={{
          range: { from: '2026-08-01', to: '2026-08-08' },
          productEvents: { 'capability.installed': 3 },
          publicationFunnel: { published: 2 },
          installationOutcomes: { installed: 3, failed: 1 },
          activeDevices: 2,
        }}
      />,
    );
    expect(screen.getByText('采用分析')).toBeInTheDocument();
    expect(screen.getByText('活跃设备').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('capability.installed')).toBeInTheDocument();
    expect(screen.getByText('capability.installed').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('安装成功率').previousElementSibling).toHaveTextContent('75%');
  });

  it('prevents regular members from renaming an organization', () => {
    render(
      <OrganizationSettingsPage
        online
        canManage={false}
        organization={{ id: 'org-a', name: '海岸小香蕉', slug: 'banana', role: 'member', status: 'active' }}
        members={[]}
        accountDeletionStatus={{ status: 'none' }}
        onRename={vi.fn()}
        onExportOrganization={vi.fn()}
        onExportAccount={vi.fn()}
        onTransferOwnership={vi.fn()}
        onLeave={vi.fn()}
        onCloseOrganization={vi.fn()}
        onCancelClosure={vi.fn()}
        onRequestAccountDeletion={vi.fn()}
        onCancelAccountDeletion={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('组织名称')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存组织名称' })).toBeDisabled();
    expect(screen.getByText('只有组织所有者或管理员可以修改组织信息。')).toBeInTheDocument();
    expect(screen.getByText('组织角色').nextElementSibling).toHaveTextContent('member');
    expect(screen.getByText('数据保护边界')).toBeInTheDocument();
    expect(screen.getByText('上传前客户端扫描')).toBeInTheDocument();
  });

  it('exports organization data and accepts the organization slug as closure confirmation', async () => {
    const onExportOrganization = vi.fn(async () => undefined);
    const onCloseOrganization = vi.fn(async () => undefined);
    render(
      <OrganizationSettingsPage
        online
        organization={{ id: 'org-a', name: '海岸小香蕉', slug: 'banana', role: 'owner', status: 'active' }}
        user={{ id: 'user-a', displayName: 'Rocky', identities: [] }}
        members={[]}
        accountDeletionStatus={{ status: 'none' }}
        onRename={vi.fn()}
        onExportOrganization={onExportOrganization}
        onExportAccount={vi.fn()}
        onTransferOwnership={vi.fn()}
        onLeave={vi.fn()}
        onCloseOrganization={onCloseOrganization}
        onCancelClosure={vi.fn()}
        onRequestAccountDeletion={vi.fn()}
        onCancelAccountDeletion={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '导出组织数据' }));
    await waitFor(() => expect(onExportOrganization).toHaveBeenCalled());
    expect(screen.getByText('user-a')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('关闭组织确认'), { target: { value: 'banana' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭组织' }));
    await waitFor(() => expect(onCloseOrganization).toHaveBeenCalledWith('banana'));
  });

  it('shows scheduled account and organization deletion dates', () => {
    render(
      <OrganizationSettingsPage
        online
        organization={{
          id: 'org-a',
          name: '海岸小香蕉',
          slug: 'banana',
          role: 'owner',
          status: 'closing',
          deletionScheduledAt: '2026-09-08T00:00:00.000Z',
        }}
        user={{ id: 'user-a', displayName: 'Rocky', identities: [] }}
        members={[]}
        accountDeletionStatus={{ status: 'scheduled', deletionScheduledAt: '2026-09-09T00:00:00.000Z' }}
        onRename={vi.fn()}
        onExportOrganization={vi.fn()}
        onExportAccount={vi.fn()}
        onTransferOwnership={vi.fn()}
        onLeave={vi.fn()}
        onCloseOrganization={vi.fn()}
        onCancelClosure={vi.fn()}
        onRequestAccountDeletion={vi.fn()}
        onCancelAccountDeletion={vi.fn()}
      />,
    );

    expect(screen.getByText(/组织计划删除时间/)).toHaveTextContent('2026');
    expect(screen.getByText(/账号计划注销时间/)).toHaveTextContent('2026');
  });
});
