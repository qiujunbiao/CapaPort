import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cloudFixture, localFixture } from '../test/fixtures';
import { CloudError } from './cloud-client';
import { DesktopApp } from './desktop-app';
import { createMemorySessionStore } from './session-store';
import type { Session } from './types';

describe('desktop application safety workflows', () => {
  it('uses meaningful page labels without decorative sequence numbers', async () => {
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

    await screen.findByRole('button', { name: '首页' });
    expect(document.body).not.toHaveTextContent(/\/ 0[1-5]/);
  });

  it('prefills the verification code returned by the local development API', async () => {
    const cloud = cloudFixture();
    cloud.register = async () => ({
      challengeId: 'challenge-a',
      maskedTarget: '15*******93',
      developmentCode: '654321',
    });
    cloud.verify = async () => ({ verified: true });
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={createMemorySessionStore()} />);
    fireEvent.click(screen.getByRole('button', { name: '没有账号？立即注册' }));
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: 'Rocky' } });
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: '15000836993' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Strong-Password-1!' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并验证' }));

    expect(await screen.findByLabelText('验证码')).toHaveValue('654321');
    expect(screen.getByText('仅本地开发：验证码已自动填入。')).toBeInTheDocument();
  });

  it('protects authenticated routes and exposes accessible login errors', async () => {
    const cloud = cloudFixture({ loginError: '账号或密码错误' });
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={createMemorySessionStore()} />);
    expect(screen.getByRole('heading', { name: '进入 CapaPort' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误');
  });

  it('returns to login when a restored session can no longer be refreshed', async () => {
    const cloud = cloudFixture();
    cloud.organizations = async () => {
      throw new CloudError('AUTH_REFRESH_REPLAY', '登录状态已失效');
    };
    const sessionStore = createMemorySessionStore({
      accessToken: 'expired',
      refreshToken: 'replayed',
      organizationId: 'org-a',
    });

    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={sessionStore} />);

    expect(await screen.findByRole('heading', { name: '进入 CapaPort' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '建立共享边界' })).not.toBeInTheDocument();
    expect(sessionStore.get()).toBeUndefined();
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
      'capaport:cache:org-a:capabilities',
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

  it('shows linked global skills and scans their canonical source path', async () => {
    const local = localFixture();
    const sourcePath = '/external/shared/linked-global';
    local.discoverLocalSkills = async () => ({
      skills: [
        {
          adapterId: 'codex',
          displayName: 'Codex',
          scope: 'user',
          sourceKind: 'global',
          linked: true,
          sourcePath,
          slug: 'linked-global',
          digest: 'f'.repeat(64),
        },
      ],
      issues: [{ path: '/broken/skill', reason: 'broken-symlink' }],
    });
    const scanLocalPackage = vi.fn(local.scanLocalPackage);
    local.scanLocalPackage = scanLocalPackage;
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

    fireEvent.click(await screen.findByRole('button', { name: '本地发现' }));
    expect(await screen.findByText(/全局安装 · 符号链接/)).toBeInTheDocument();
    expect(screen.getByText('另有 1 个路径未能读取')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导入 linked-global' }));

    await waitFor(() => expect(scanLocalPackage).toHaveBeenCalledWith(sourcePath));
  });

  it('saves discovered capabilities to the personal space before publishing to the organization', async () => {
    const cloud = cloudFixture();
    cloud.spaces = async () => [
      {
        id: 'space-org',
        organizationId: 'org-a',
        type: 'organization',
        name: '海岸小香蕉',
        slug: 'organization',
        reviewPolicy: 'required',
        status: 'active',
      },
      {
        id: 'space-personal',
        organizationId: 'org-a',
        type: 'personal',
        name: 'Personal space',
        slug: 'personal-user-a',
        reviewPolicy: 'direct',
        status: 'active',
      },
    ];
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

    fireEvent.click(await screen.findByRole('button', { name: '本地发现' }));
    fireEvent.click(await screen.findByRole('button', { name: '导入 release-helper' }));

    expect(await screen.findByLabelText('保存到空间')).toHaveValue('space-personal');
    expect(screen.getByLabelText('发布到空间')).toHaveValue('space-org');
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
    expect(screen.getByText(/# managed by CapaPort/)).toBeInTheDocument();
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

  it('labels local builds instead of contacting an unconfigured release feed', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByText('本地构建未启用在线更新')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled();
  });

  it('keeps the audit action filter when loading the next page', async () => {
    const cloud = cloudFixture();
    const audit = vi.fn(
      async (_session: Session, _organizationId: string, query?: { action?: string; cursor?: string }) => ({
        entries: [],
        ...(query?.action === 'publication.approved' && !query.cursor ? { nextCursor: 'next-a' } : {}),
      }),
    );
    cloud.audit = audit;
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

    fireEvent.click(await screen.findByRole('button', { name: '审计日志' }));
    fireEvent.change(await screen.findByLabelText('审计动作'), { target: { value: 'publication.approved' } });
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));

    await waitFor(() =>
      expect(audit).toHaveBeenLastCalledWith(
        expect.anything(),
        'org-a',
        expect.objectContaining({ action: 'publication.approved', cursor: 'next-a' }),
      ),
    );
  });

  it('keeps accepted and revoked invitations visible in organization history', async () => {
    const cloud = cloudFixture();
    cloud.invitations = async () => [
      {
        id: 'invitation-accepted',
        kind: 'email',
        target: 'accepted@example.com',
        role: 'member',
        expiresAt: '2026-08-10T00:00:00.000Z',
        acceptedAt: '2026-08-08T01:00:00.000Z',
        revokedAt: null,
        createdAt: '2026-08-08T00:00:00.000Z',
      },
    ];
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

    fireEvent.click(await screen.findByRole('button', { name: '成员与邀请' }));
    expect(await screen.findByText('accepted@example.com')).toBeInTheDocument();
    expect(screen.getByText('已接受')).toBeInTheDocument();
  });

  it('lets organization managers rename twice without issuing a stale organization-list request', async () => {
    const cloud = cloudFixture();
    const organizationId = '11111111-1111-4111-8111-111111111111';
    let organizationName = '海岸小香蕉';
    const organizationSessions: string[] = [];
    const sessionStore = createMemorySessionStore({
      accessToken: 'token',
      refreshToken: 'refresh',
      organizationId,
    });
    cloud.organizations = async (session) => {
      organizationSessions.push(session.accessToken);
      return [
        {
          id: organizationId,
          name: organizationName,
          slug: 'coastal-banana',
          role: 'owner',
          status: 'active',
        },
      ];
    };
    const updateOrganization = vi.fn(async (_session: Session, _organizationId: string, input: { name: string }) => {
      organizationName = input.name;
    });
    cloud.updateOrganization = updateOrganization;
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={sessionStore} />);

    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    expect(screen.getByDisplayValue('coastal-banana')).toBeInTheDocument();
    expect(screen.getByDisplayValue(organizationId)).toBeInTheDocument();
    expect(screen.getByText('加入组织需要邀请令牌，组织 ID 不能直接用于加入。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '海岸香蕉团队' } });
    fireEvent.click(screen.getByRole('button', { name: '保存组织名称' }));

    await waitFor(() =>
      expect(updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'token' }),
        organizationId,
        {
          name: '海岸香蕉团队',
        },
      ),
    );
    await waitFor(() => expect(screen.getByText('当前组织').nextSibling).toHaveTextContent('海岸香蕉团队'));

    fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '海岸香蕉研发' } });
    fireEvent.click(screen.getByRole('button', { name: '保存组织名称' }));

    await waitFor(() =>
      expect(updateOrganization).toHaveBeenLastCalledWith(
        expect.objectContaining({ accessToken: 'token' }),
        organizationId,
        { name: '海岸香蕉研发' },
      ),
    );
    expect(organizationSessions).toEqual(['token']);
  });

  it('joins another organization with an invitation token instead of an organization id', async () => {
    const cloud = cloudFixture();
    const token = 'invitation-token-that-is-long-enough-123456';
    const acceptInvitation = vi.fn(async () => ({ status: 'accepted', organizationId: 'org-b' }));
    cloud.acceptInvitation = acceptInvitation;
    const sessionStore = createMemorySessionStore({
      accessToken: 'token',
      refreshToken: 'refresh',
      organizationId: 'org-a',
    });
    render(<DesktopApp cloud={cloud} local={localFixture()} sessionStore={sessionStore} />);

    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.change(screen.getByLabelText('邀请令牌'), { target: { value: token } });
    fireEvent.click(screen.getByRole('button', { name: '加入组织' }));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith(expect.anything(), token));
    expect(sessionStore.get()?.organizationId).toBe('org-b');
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

  it('queues an unchanged saved draft for submission while offline', async () => {
    let online = true;
    const cloud = cloudFixture();
    cloud.isOnline = () => online;
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
    fireEvent.change(screen.getByLabelText('能力标识'), { target: { value: 'offline-release' } });
    fireEvent.change(screen.getByLabelText('能力名称'), { target: { value: '离线发布助手' } });
    fireEvent.change(screen.getByLabelText('Skill 内容'), { target: { value: '# Offline-safe skill' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('草稿修订 #1 已保存')).toBeInTheDocument();

    online = false;
    window.dispatchEvent(new Event('offline'));
    const submit = screen.getByRole('button', { name: '提交审核' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(await screen.findByText('已加入离线队列，联网后自动提交')).toBeInTheDocument();
    online = true;
    window.dispatchEvent(new Event('online'));
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
    expect(await screen.findByRole('region', { name: '通知列表' })).toHaveClass('notification-popover');
    expect(screen.getByRole('button', { name: '通知' }).parentElement).toHaveClass('notification-menu');
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
    expect(await screen.findByRole('heading', { name: '进入 CapaPort' })).toBeInTheDocument();
  });

  it('projects selected project context into every configured local agent before cloud sync', async () => {
    const cloud = cloudFixture();
    cloud.spaces = async () => [
      {
        id: 'project-a',
        organizationId: 'org-a',
        type: 'project',
        name: '支付平台',
        slug: 'payments',
        reviewPolicy: 'required',
        status: 'active',
      },
    ];
    cloud.projectBindings = async () => [
      {
        id: 'binding-cloud-a',
        organizationId: 'org-a',
        projectSpaceId: 'project-a',
        deviceId: 'device-a',
        localBindingId: '11111111-1111-4111-8111-111111111111',
        agents: ['codex', 'cursor'],
        status: 'active',
        createdAt: new Date(0).toISOString(),
      },
    ];
    const syncProjectContext = vi.fn(cloud.syncProjectContext);
    cloud.syncProjectContext = syncProjectContext;
    const local = localFixture();
    local.listProjectBindings = async () => [
      {
        localBindingId: '11111111-1111-4111-8111-111111111111',
        spaceId: 'project-a',
        localPath: '/private/projects/payments',
        agents: ['codex', 'cursor'],
        status: 'active',
        createdAt: '0001',
      },
    ];
    const projectContextPlan = vi.fn(local.projectContextPlan);
    const applyInstall = vi.fn(local.applyInstall);
    local.projectContextPlan = projectContextPlan;
    local.applyInstall = applyInstall;
    render(
      <DesktopApp
        cloud={cloud}
        local={local}
        sessionStore={createMemorySessionStore({
          accessToken: 'token',
          refreshToken: 'refresh',
          organizationId: 'org-a',
        })}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '项目' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择同步' }));
    fireEvent.click(await screen.findByRole('button', { name: '同步 1 个文件' }));

    await waitFor(() => expect(projectContextPlan).toHaveBeenCalledTimes(2));
    expect(projectContextPlan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ adapterId: 'codex', rootPath: '/private/projects/payments' }),
    );
    expect(projectContextPlan).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ adapterId: 'cursor', rootPath: '/private/projects/payments' }),
    );
    expect(applyInstall).toHaveBeenCalledTimes(2);
    expect(syncProjectContext).toHaveBeenCalledTimes(1);
  });
});
