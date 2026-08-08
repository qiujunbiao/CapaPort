import type { OrganizationSummary, PublicUser } from '@agentdoor/contracts';
import { Bell, Bug, Cloud, KeyRound, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Button, PageHeader, Panel, Status } from '../../components/ui';
import type { SyncQueueStatus } from '../../generated/commands';

export function SettingsPage({
  user,
  organization,
  queue,
  online,
  onLogout,
  onRefreshQueue,
  onSyncQueue,
}: {
  user: PublicUser | undefined;
  organization: OrganizationSummary | undefined;
  queue: SyncQueueStatus | undefined;
  online: boolean;
  onLogout: () => void;
  onRefreshQueue: () => void;
  onSyncQueue: () => void;
}) {
  const [diagnosticStatus, setDiagnosticStatus] = useState('');

  function exportDiagnostics() {
    const payload = createDiagnosticPayload({ online, queue, generatedAt: new Date() });
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `agentdoor-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDiagnosticStatus('已导出；文件不包含令牌、用户标识或本地路径。');
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="DESKTOP CONTROL / 05"
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
          <Button variant="secondary" onClick={onLogout}>
            <LogOut aria-hidden size={15} />
            退出登录
          </Button>
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
              <dd className="mono">0.1.0</dd>
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

export function createDiagnosticPayload({
  online,
  queue,
  generatedAt,
}: {
  online: boolean;
  queue: SyncQueueStatus | undefined;
  generatedAt: Date;
}) {
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    clientVersion: '0.1.0',
    connectivity: online ? 'online' : 'offline',
    localDatabase: 'available',
    syncQueue: { pending: queue?.pending ?? 0, failed: queue?.failed ?? 0 },
  };
}
