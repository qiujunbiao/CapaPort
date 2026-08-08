import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('shows a content diff, imports the local variant as a draft, and can restore an applied update', async () => {
    const local = localFixture({ installConflict: true });
    const rollbackInstall = vi.fn(local.rollbackInstall);
    local.rollbackInstall = rollbackInstall;
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
    fireEvent.click(await screen.findByRole('button', { name: '能力库' }));
    fireEvent.click(await screen.findByRole('button', { name: '安装' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看差异' }));
    expect(await screen.findByText(/# Local managed content/)).toBeInTheDocument();
    expect(screen.getByText(/# managed by Agentdoor/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导入本地为草稿' }));
    expect(await screen.findByText('本地版本已保存为个人草稿')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('使用组织版本'));
    fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
    expect(await screen.findByText('本地更新已完成')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复更新前版本' }));
    await waitFor(() => expect(rollbackInstall).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('已恢复到更新前版本')).toBeInTheDocument();
  });

  it('shows retry queue and syncs again without exposing local paths', async () => {
    const local = localFixture({ pendingRetries: 2, failedRetries: 1 });
    const retryFailedWrites = vi.fn(local.retryFailedWrites);
    local.retryFailedWrites = retryFailedWrites;
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
    fireEvent.click(screen.getByRole('button', { name: '重试失败任务' }));
    await waitFor(() => expect(retryFailedWrites).toHaveBeenCalledTimes(1));
  });

  it('creates a Skill, Prompt, and context package in the authoring workspace and submits it', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: '创作' }));
    fireEvent.change(screen.getByLabelText('能力标识'), { target: { value: 'team-release' } });
    fireEvent.change(screen.getByLabelText('能力名称'), { target: { value: '团队发布助手' } });
    fireEvent.change(screen.getByLabelText('Skill 内容'), { target: { value: '# Skill' } });
    fireEvent.click(screen.getByRole('button', { name: '添加Prompt' }));
    fireEvent.change(screen.getByLabelText('Prompt 内容'), { target: { value: '# Prompt' } });
    fireEvent.click(screen.getByRole('button', { name: '添加项目上下文' }));
    fireEvent.change(screen.getByLabelText('项目上下文 内容'), { target: { value: '# Context' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('草稿修订 #1 已保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
    expect(await screen.findByText('已提交到审核流程')).toBeInTheDocument();
  });

  it('never requests a cloud upload when authoring content contains a blocking secret', async () => {
    const cloud = cloudFixture();
    const createCapabilityDraft = vi.fn(cloud.createCapabilityDraft);
    cloud.createCapabilityDraft = createCapabilityDraft;
    render(
      <DesktopApp
        cloud={cloud}
        local={localFixture()}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '创作' }));
    fireEvent.change(screen.getByLabelText('能力标识'), { target: { value: 'unsafe-skill' } });
    fireEvent.change(screen.getByLabelText('能力名称'), { target: { value: '不安全能力' } });
    fireEvent.change(screen.getByLabelText('Skill 内容'), {
      target: { value: '-----BEGIN PRIVATE KEY-----\nsecret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('本地安全扫描发现阻断风险，能力包未上传')).toBeInTheDocument();
    expect(createCapabilityDraft).not.toHaveBeenCalled();
  });

  it('reopens a changes-requested draft, saves an immutable revision, and resubmits it', async () => {
    render(
      <DesktopApp
        cloud={cloudFixture({ changesRequested: true })}
        local={localFixture()}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '创作' }));
    fireEvent.click(await screen.findByRole('button', { name: /继续修改 组织 A 能力/ }));
    expect(await screen.findByText('已载入审核退回的草稿，可修改后再次提交')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill 内容')).toHaveValue('# Existing skill');
    fireEvent.change(screen.getByLabelText('Skill 内容'), { target: { value: '# Revised skill' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('草稿修订 #2 已保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
    expect(await screen.findByText('已提交到审核流程')).toBeInTheDocument();
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

  it('revokes the cloud session before clearing local credentials on logout', async () => {
    const cloud = cloudFixture();
    const logout = vi.fn().mockResolvedValue(undefined);
    Object.assign(cloud, { logout });
    const sessionStore = createMemorySessionStore({
      accessToken: 'token',
      refreshToken: 'refresh',
      organizationId: 'org-a',
    });
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={sessionStore} />);

    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(logout).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'token' })));
    expect(await screen.findByRole('heading', { name: '进入 Agentdoor' })).toBeInTheDocument();
  });
});
