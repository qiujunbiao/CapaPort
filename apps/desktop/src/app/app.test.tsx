import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cloudFixture, localFixture } from '../test/fixtures';
import { DesktopApp } from './desktop-app';
import { createMemorySessionStore } from './session-store';

describe('desktop application safety workflows', () => {
  it('protects authenticated routes and exposes accessible login errors', async () => {
    const cloud = cloudFixture({ loginError: '账号或密码错误' });
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={createMemorySessionStore()} />);
    expect(screen.getByRole('heading', { name: '进入 Agentdoor' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误');
  });

  it('lets a user recover an account from the desktop client', async () => {
    render(<DesktopApp cloud={cloudFixture()} local={localFixture()} sessionStore={createMemorySessionStore()} />);
    fireEvent.click(screen.getByRole('button', { name: '忘记密码' }));
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'person@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByRole('heading', { name: '重置密码' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: '完成重置' }));
    expect(await screen.findByRole('status')).toHaveTextContent('密码已重置');
  });

  it('keeps local discovery available offline while disabling cloud actions', async () => {
    localStorage.setItem(
      'agentdoor:cache:org-a:capabilities',
      JSON.stringify(await cloudFixture().capabilities({ accessToken: 'token', refreshToken: 'refresh' }, 'org-a')),
    );
    const sessionStore = createMemorySessionStore({
      accessToken: 'token',
      refreshToken: 'refresh',
      organizationId: 'org-a',
    });
    render(<DesktopApp cloud={cloudFixture({ online: false })} local={localFixture()} sessionStore={sessionStore} />);
    expect(await screen.findByText('离线工作')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '本地发现' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '能力库' }));
    expect(await screen.findByRole('button', { name: '安装' })).toBeDisabled();
  });

  it('partitions cached cloud data when switching organizations', async () => {
    const cloud = cloudFixture();
    const sessionStore = createMemorySessionStore({
      accessToken: 'token',
      refreshToken: 'refresh',
      organizationId: 'org-a',
    });
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={sessionStore} />);
    expect(await screen.findByText('组织 A 能力')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('当前组织'), { target: { value: 'org-b' } });
    expect(await screen.findByText('组织 B 能力')).toBeInTheDocument();
    expect(screen.queryByText('组织 A 能力')).not.toBeInTheDocument();
  });

  it('blocks publishing when the local scan finds a secret', async () => {
    render(
      <DesktopApp
        cloud={cloudFixture()}
        local={localFixture({ blockedScan: true })}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '本地发现' }));
    fireEvent.click(await screen.findByRole('button', { name: '导入 release-helper' }));
    expect(await screen.findByText('发现高风险内容，已阻止上传')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建云端草稿' })).toBeDisabled();
  });

  it('previews installation writes and requires a conflict choice', async () => {
    render(
      <DesktopApp
        cloud={cloudFixture()}
        local={localFixture({ installConflict: true })}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '能力库' }));
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    expect(await screen.findByText('安装 / 更新预览')).toBeInTheDocument();
    expect(screen.getByText('rules/security.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认安装' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('保留本地版本'));
    expect(screen.getByRole('button', { name: '确认安装' })).toBeEnabled();
  });

  it('shows retry queue and syncs again without exposing local paths', async () => {
    const local = localFixture({ pendingRetries: 2 });
    render(
      <DesktopApp
        cloud={cloudFixture()}
        local={local}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByText('2 个操作等待重试')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/Users/private');
  });

  it('filters installed capabilities and exposes an available update', async () => {
    render(
      <DesktopApp
        cloud={cloudFixture({ installed: true, updateAvailable: true })}
        local={localFixture()}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '能力库' }));
    expect(await screen.findByRole('button', { name: '更新' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: '已安装' }));
    expect(screen.getByText('组织 A 能力')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '团队' }));
    expect(screen.queryByText('组织 A 能力')).not.toBeInTheDocument();
  });

  it('filters the capability library by compatible agent', async () => {
    render(
      <DesktopApp
        cloud={cloudFixture({ includeClaudeOnly: true })}
        local={localFixture()}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '能力库' }));
    expect(await screen.findByText('Claude 专用能力')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('兼容 Agent'), { target: { value: 'codex' } });
    expect(screen.queryByText('Claude 专用能力')).not.toBeInTheDocument();
  });

  it('opens desktop notifications and marks an item as read', async () => {
    render(
      <DesktopApp
        cloud={cloudFixture()}
        local={localFixture()}
        sessionStore={createMemorySessionStore({
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
