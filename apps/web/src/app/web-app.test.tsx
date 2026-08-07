import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { webFixture } from '../test/fixtures';
import { createMemoryWebSessionStore } from './session-store';
import { WebApp } from './web-app';

describe('organization web console', () => {
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
