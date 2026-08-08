import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { webFixture } from '../test/fixtures';
import { createMemoryWebSessionStore } from './session-store';
import { WebApp } from './web-app';

describe('organization web console', () => {
  it('creates an organization from an editable name without asking for a technical identifier', async () => {
    const client = webFixture();
    client.organizations = async () => [];
    const createOrganization = vi.fn(async ({ name }: { name: string }) => ({
      id: 'org-new',
      name,
      slug: 'org-generated',
      role: 'owner' as const,
      status: 'active' as const,
    }));
    client.createOrganization = createOrganization;

    render(
      <WebApp
        client={client}
        sessionStore={createMemoryWebSessionStore({ accessToken: 'token', refreshToken: 'refresh' })}
      />,
    );

    const name = await screen.findByLabelText('组织名称');
    fireEvent.change(name, { target: { value: '海岸' } });
    fireEvent.change(name, { target: { value: '海岸小香蕉' } });
    expect(name).toHaveValue('海岸小香蕉');
    expect(screen.queryByLabelText('组织标识')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }));
    await waitFor(() => expect(createOrganization).toHaveBeenCalledWith({ name: '海岸小香蕉' }));
  });

  it('prefills the verification code returned by the local development API', async () => {
    const client = webFixture();
    client.register = async () => ({
      challengeId: 'challenge-a',
      maskedTarget: '15*******93',
      developmentCode: '654321',
    });
    render(<WebApp client={client} sessionStore={createMemoryWebSessionStore()} />);
    fireEvent.click(screen.getByRole('button', { name: '没有账号？创建账号' }));
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'Rocky' } });
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: '15000836993' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Strong-Password-1!' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并验证' }));

    expect(await screen.findByLabelText('验证码')).toHaveValue('654321');
    expect(screen.getByText('仅本地开发：验证码已自动填入。')).toBeInTheDocument();
  });

  it('protects administrator routes behind authentication', () => {
    render(<WebApp client={webFixture()} sessionStore={createMemoryWebSessionStore()} />);
    expect(screen.getByRole('heading', { name: '登录管理后台' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '成员与邀请' })).not.toBeInTheDocument();
  });

  it('lets a user recover an account and set a new password', async () => {
    render(<WebApp client={webFixture()} sessionStore={createMemoryWebSessionStore()} />);
    fireEvent.click(screen.getByRole('button', { name: '忘记密码' }));
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'person@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByRole('heading', { name: '重置密码' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: '完成重置' }));
    expect(await screen.findByRole('status')).toHaveTextContent('密码已重置');
  });

  it('shows permission-aware navigation for an organization member', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'member' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    expect(await screen.findByRole('button', { name: '能力市场' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '成员与邀请' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审核中心' })).not.toBeInTheDocument();
  });

  it('edits capability metadata from the marketplace', async () => {
    render(
      <WebApp
        client={webFixture()}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '能力市场' }));
    fireEvent.click(await screen.findByRole('button', { name: /发布护航/ }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑元数据' }));
    fireEvent.change(screen.getByLabelText('能力名称'), { target: { value: '发布护航 Pro' } });
    fireEvent.change(screen.getByLabelText('能力标签'), { target: { value: 'release, security' } });
    fireEvent.click(screen.getByRole('button', { name: '保存元数据' }));
    expect(await screen.findByRole('heading', { name: '发布护航 Pro' })).toBeInTheDocument();
    expect(screen.getByText('release, security')).toBeInTheDocument();
  });

  it('compares immutable capability versions from the marketplace', async () => {
    render(
      <WebApp
        client={webFixture()}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '能力市场' }));
    fireEvent.click(await screen.findByRole('button', { name: /发布护航/ }));
    fireEvent.click(await screen.findByRole('button', { name: '比较 v1.0.0 与 v0.9.0' }));
    expect(await screen.findByText('建议 minor 版本变更')).toBeInTheDocument();
    expect(screen.getByText(/prompts\/release-helper\.md/)).toBeInTheDocument();
    expect(screen.getByText(/skills\/release-helper\/SKILL\.md/)).toBeInTheDocument();
  });

  it('lets a non-owner leave the current organization', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'member' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '组织设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '退出当前组织' }));
    expect(await screen.findByRole('heading', { name: '登录管理后台' })).toBeInTheDocument();
  });

  it('exposes export, ownership transfer, and confirmed closure controls to an owner', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'owner' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '组织设置' }));
    expect(await screen.findByRole('button', { name: '导出组织数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出我的数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移交所有权' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('新所有者'), { target: { value: 'member-b' } });
    expect(screen.getByRole('button', { name: '移交所有权' })).toBeEnabled();
    const close = screen.getByRole('button', { name: '安排关闭组织' });
    expect(close).toBeDisabled();
    fireEvent.change(screen.getByLabelText('输入组织名称或标识确认关闭'), { target: { value: 'platform' } });
    expect(close).toBeEnabled();
  });

  it('manages roles inside a team space', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'owner', includeTeamSpace: true })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '空间与策略' }));
    fireEvent.click(await screen.findByRole('button', { name: '管理研发团队成员' }));
    expect((await screen.findAllByText('林默')).length).toBeGreaterThan(1);
    await screen.findByRole('option', { name: '陈夏' });
    fireEvent.change(screen.getByLabelText('新成员'), { target: { value: 'user-b' } });
    expect(screen.getByRole('button', { name: '添加成员' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }));
    expect(await screen.findByRole('cell', { name: '陈夏' })).toBeInTheDocument();
  });

  it('lets an owner invite a member with a role', async () => {
    const client = webFixture({ role: 'owner' });
    render(
      <WebApp
        client={client}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '成员与邀请' }));
    fireEvent.change(screen.getByLabelText('邀请邮箱或手机号'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('组织角色'), { target: { value: 'auditor' } });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }));
    expect(await screen.findByRole('status')).toHaveTextContent('邀请已发送');
  });

  it('filters review items and exposes an accessible empty state', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'admin', publications: [] })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '审核中心' }));
    expect(await screen.findByRole('heading', { name: '暂无待审核发布' })).toBeInTheDocument();
  });

  it('keeps audit metadata redacted in the rendered table', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'auditor' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '审计日志' }));
    expect(await screen.findByText('publication.approved')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-token');
    expect(document.body.textContent).not.toContain('/Users/private');
  });

  it('lets an owner govern organization scan policy and inspect publication risk reports', async () => {
    render(
      <WebApp
        client={webFixture({ role: 'owner' })}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '安全中心' }));
    expect(await screen.findByRole('heading', { name: '组织扫描策略' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('组织禁止词'), { target: { value: 'ORCHID\ncustomer-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存安全策略' }));
    expect(await screen.findByRole('status')).toHaveTextContent('安全策略已保存');
    expect(screen.getByRole('heading', { name: '发布风险报告' })).toBeInTheDocument();
    expect(screen.getByText('SEC_ORG_TERM')).toBeInTheDocument();
  });

  it('opens notifications and marks an item as read', async () => {
    render(
      <WebApp
        client={webFixture()}
        sessionStore={createMemoryWebSessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '通知' }));
    expect(await screen.findByText('发布已通过')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '标为已读' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '标为已读' })).not.toBeInTheDocument());
  });
});
