import type { OrganizationSummary, PublicUser } from '@capaport/contracts';
import { Bell, Bug, Cloud, Download, KeyRound, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bundledAppVersion, resolveDesktopVersion } from '../../app/app-version';
import { createTauriUpdater, type DesktopUpdaterState } from '../../app/updater';
import { Button, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';
import type { SyncQueueStatus } from '../../generated/commands';

export function SettingsPage({
  user,
  organization,
  queue,
  online,
  onLogout,
  onRefreshQueue,
  onAcceptInvitation,
  onUpdateOrganization,
  onSyncQueue,
}: {
  user: PublicUser | undefined;
  organization: OrganizationSummary | undefined;
  queue: SyncQueueStatus | undefined;
  online: boolean;
  onLogout: () => void | Promise<void>;
  onRefreshQueue: () => void;
  onAcceptInvitation: (token: string) => Promise<void>;
  onUpdateOrganization: (name: string) => Promise<void>;
  onSyncQueue: () => void;
}) {
  const [diagnosticStatus, setDiagnosticStatus] = useState('');
  const [clientVersion, setClientVersion] = useState(bundledAppVersion);
  const [updater] = useState(createTauriUpdater);
  const [update, setUpdate] = useState<DesktopUpdaterState>(updater.state());
  const [organizationName, setOrganizationName] = useState(organization?.name ?? '');
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [organizationError, setOrganizationError] = useState('');
  const [organizationMessage, setOrganizationMessage] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [invitationError, setInvitationError] = useState('');

  useEffect(() => {
    void resolveDesktopVersion().then(setClientVersion);
  }, []);
  useEffect(() => {
    setOrganizationName(organization?.name ?? '');
  }, [organization?.name]);

  async function saveOrganizationName() {
    setOrganizationBusy(true);
    setOrganizationError('');
    setOrganizationMessage('');
    try {
      await onUpdateOrganization(organizationName.trim());
      setOrganizationMessage('组织名称已更新');
    } catch (caught) {
      setOrganizationError(caught instanceof Error ? caught.message : '组织名称更新失败');
    } finally {
      setOrganizationBusy(false);
    }
  }

  async function acceptInvitation() {
    setInvitationBusy(true);
    setInvitationError('');
    try {
      await onAcceptInvitation(invitationToken.trim());
      setInvitationToken('');
    } catch (caught) {
      setInvitationError(caught instanceof Error ? caught.message : '加入组织失败');
    } finally {
      setInvitationBusy(false);
    }
  }

  async function checkUpdate() {
    setUpdate({ status: 'checking' });
    setUpdate(await updater.check());
  }

  async function installUpdate() {
    setUpdate(await updater.install(setUpdate));
  }

  function exportDiagnostics() {
    const payload = createDiagnosticPayload({ online, queue, generatedAt: new Date(), clientVersion });
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `capaport-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDiagnosticStatus('已导出；文件不包含令牌、用户标识或本地路径。');
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="DESKTOP CONTROL"
        title="设置与诊断"
        description="管理账号、隐私边界、本地运行时和同步恢复。"
      />
      <div className="settings-grid">
        <Panel>
          <div className="settings-section-title">
            <UserRound aria-hidden />
            <div>
              <h2>账号与组织</h2>
              <p>当前身份与共享边界</p>
            </div>
          </div>
          <dl className="settings-list">
            <div>
              <dt>显示名称</dt>
              <dd>{user?.displayName ?? '—'}</dd>
            </div>
            <div>
              <dt>当前组织</dt>
              <dd>{organization?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>组织角色</dt>
              <dd>{organization?.role ?? '—'}</dd>
            </div>
          </dl>
          <div className="organization-settings">
            <label>
              组织名称
              <input
                value={organizationName}
                disabled={!organization || !['owner', 'admin'].includes(organization.role)}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </label>
            <label>
              组织标识
              <input value={organization?.slug ?? ''} readOnly />
            </label>
            <label>
              内部组织 ID
              <input value={organization?.id ?? ''} readOnly />
            </label>
            <p className="quiet-copy">加入组织需要邀请令牌，组织 ID 不能直接用于加入。</p>
            {organizationError ? <ErrorNotice>{organizationError}</ErrorNotice> : null}
            {organizationMessage ? (
              <p className="success-message" role="status">
                {organizationMessage}
              </p>
            ) : null}
            <Button
              busy={organizationBusy}
              disabled={
                !organization ||
                !['owner', 'admin'].includes(organization.role) ||
                organizationName.trim().length < 2 ||
                organizationName.trim() === organization.name
              }
              onClick={() => void saveOrganizationName()}
            >
              保存组织名称
            </Button>
            {organization && !['owner', 'admin'].includes(organization.role) ? (
              <p className="quiet-copy">只有组织所有者或管理员可以修改组织名称。</p>
            ) : null}
            <div className="organization-invitation">
              <strong>加入其他组织</strong>
              <label>
                邀请令牌
                <input
                  value={invitationToken}
                  placeholder="粘贴邀请邮件或短信中的令牌"
                  onChange={(event) => setInvitationToken(event.target.value)}
                />
              </label>
              {invitationError ? <ErrorNotice>{invitationError}</ErrorNotice> : null}
              <Button
                variant="secondary"
                busy={invitationBusy}
                disabled={!online || invitationToken.trim().length < 32}
                onClick={() => void acceptInvitation()}
              >
                加入组织
              </Button>
            </div>
          </div>
          <Button variant="secondary" onClick={onLogout}>
            <LogOut aria-hidden size={15} />
            退出登录
          </Button>
        </Panel>
        <Panel>
          <div className="settings-section-title">
            <Download aria-hidden />
            <div>
              <h2>桌面客户端更新</h2>
              <p>只安装通过内置公钥验证的签名更新</p>
            </div>
          </div>
          <dl className="settings-list">
            <div>
              <dt>当前版本</dt>
              <dd className="mono">{update.currentVersion ?? clientVersion}</dd>
            </div>
            <div>
              <dt>更新状态</dt>
              <dd>
                <Status tone={update.status === 'error' ? 'warn' : update.status === 'ready' ? 'good' : 'neutral'}>
                  {updateLabel(update)}
                </Status>
              </dd>
            </div>
          </dl>
          {update.version ? <p className="quiet-copy">可用版本：{update.version}</p> : null}
          {update.body ? <p className="quiet-copy">{update.body}</p> : null}
          {update.status === 'downloading' ? (
            <progress aria-label="更新下载进度" max={100} value={update.progress ?? 0} />
          ) : null}
          {update.error ? <p className="diagnostic-status">{update.error}</p> : null}
          <Button
            variant="secondary"
            disabled={update.status === 'checking' || update.status === 'disabled'}
            onClick={() => void checkUpdate()}
          >
            <RefreshCw aria-hidden size={15} />
            {update.status === 'checking' ? '正在检查' : '检查更新'}
          </Button>
          {update.status === 'available' ? (
            <Button onClick={() => void installUpdate()}>
              <Download aria-hidden size={15} />
              下载并安装
            </Button>
          ) : null}
          {update.status === 'ready' ? (
            <Button onClick={() => void updater.restart().then(setUpdate)}>重启完成更新</Button>
          ) : null}
        </Panel>
        <Panel>
          <div className="settings-section-title">
            <Cloud aria-hidden />
            <div>
              <h2>同步与重试</h2>
              <p>离线操作会在恢复网络后重试</p>
            </div>
          </div>
          <div className="queue-readout">
            <strong>{queue?.pending ?? 0}</strong>
            <span>{queue?.pending ? `${queue.pending} 个操作等待重试` : '同步队列已清空'}</span>
            <Status tone={online ? 'good' : 'warn'}>{online ? '云端可用' : '离线'}</Status>
          </div>
          <Button variant="secondary" onClick={onRefreshQueue}>
            <RefreshCw aria-hidden size={15} />
            刷新状态
          </Button>
          <Button variant="secondary" disabled={!online} onClick={onSyncQueue}>
            <RefreshCw aria-hidden size={15} />
            {queue?.failed ? '重试失败任务' : '立即同步'}
          </Button>
        </Panel>
        <Panel>
          <div className="settings-section-title">
            <ShieldCheck aria-hidden />
            <div>
              <h2>安全与隐私</h2>
              <p>默认最小化传输</p>
            </div>
          </div>
          <ul className="security-points">
            <li>
              <KeyRound aria-hidden />
              <span>
                <strong>令牌进入系统凭据库</strong>
                <small>不写入日志或普通配置文件</small>
              </span>
            </li>
            <li>
              <ShieldCheck aria-hidden />
              <span>
                <strong>上传前本地扫描</strong>
                <small>高风险内容默认阻止</small>
              </span>
            </li>
            <li>
              <Bell aria-hidden />
              <span>
                <strong>仅上传能力包</strong>
                <small>项目源码与绝对路径不会上传</small>
              </span>
            </li>
          </ul>
        </Panel>
        <Panel>
          <div className="settings-section-title">
            <Bug aria-hidden />
            <div>
              <h2>运行时诊断</h2>
              <p>便于定位安装与同步问题</p>
            </div>
          </div>
          <dl className="settings-list">
            <div>
              <dt>客户端版本</dt>
              <dd className="mono">{clientVersion}</dd>
            </div>
            <div>
              <dt>本地数据库</dt>
              <dd>
                <Status tone="good">可用</Status>
              </dd>
            </div>
            <div>
              <dt>失败任务</dt>
              <dd>{queue?.failed ?? 0}</dd>
            </div>
          </dl>
          <Button variant="secondary" onClick={exportDiagnostics}>
            导出脱敏诊断
          </Button>
          {diagnosticStatus ? (
            <p className="diagnostic-status" role="status">
              {diagnosticStatus}
            </p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

function updateLabel(update: DesktopUpdaterState): string {
  const labels: Record<DesktopUpdaterState['status'], string> = {
    disabled: '本地构建未启用在线更新',
    idle: '尚未检查',
    checking: '检查签名清单',
    current: '已是最新版本',
    available: '发现签名更新',
    downloading: `下载安装中 ${update.progress ?? 0}%`,
    ready: '安装完成，等待重启',
    error: '更新失败',
  };
  return labels[update.status];
}

export function createDiagnosticPayload({
  online,
  queue,
  generatedAt,
  clientVersion,
}: {
  online: boolean;
  queue: SyncQueueStatus | undefined;
  generatedAt: Date;
  clientVersion: string;
}) {
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    clientVersion,
    connectivity: online ? 'online' : 'offline',
    localDatabase: 'available',
    syncQueue: { pending: queue?.pending ?? 0, failed: queue?.failed ?? 0 },
  };
}
