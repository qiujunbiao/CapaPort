import type { OrganizationSummary, PublicUser } from '@capaport/contracts';
import { Building2, Download, LogOut, Save, ShieldCheck, Trash2, UserRoundCog } from 'lucide-react';
import { useState } from 'react';
import type { OrganizationMember, WebClient } from '../../app/types';
import { Button, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function OrganizationSettingsPage({
  client,
  organization,
  user,
  members,
  accountDeletionStatus,
  canManage,
  onSaved,
  onLogout,
  onLeave,
}: {
  client: WebClient;
  organization: OrganizationSummary;
  user: PublicUser | undefined;
  members: OrganizationMember[];
  accountDeletionStatus: { status: string; deletionScheduledAt?: string } | undefined;
  canManage: boolean;
  onSaved: () => Promise<void> | void;
  onLogout: () => void;
  onLeave: () => Promise<void>;
}) {
  const [name, setName] = useState(organization.name);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [targetOwner, setTargetOwner] = useState('');
  const [accountDeletionAt, setAccountDeletionAt] = useState(
    accountDeletionStatus?.status === 'scheduled' ? (accountDeletionStatus.deletionScheduledAt ?? '') : '',
  );
  function download(data: Record<string, unknown>, filename: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function action(task: () => Promise<void>, success: string) {
    setError('');
    try {
      await task();
      setMessage(success);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    }
  }
  async function save() {
    try {
      await client.updateOrganization(organization.id, name);
      setMessage('组织设置已保存');
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATION SETTINGS / 09"
        title="组织设置"
        description="管理组织基础信息、当前账号和数据保护承诺。"
      />
      {message ? (
        <p className="success-banner" role="status">
          {message}
        </p>
      ) : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="settings-grid">
        <Panel>
          <div className="settings-title">
            <Building2 />
            <div>
              <h2>基础信息</h2>
              <p>组织名称与唯一标识</p>
            </div>
          </div>
          <label>
            组织名称
            <input
              aria-label="组织名称"
              value={name}
              disabled={!canManage}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            组织标识
            <input value={organization.slug} disabled />
          </label>
          <Button
            disabled={!canManage || name.trim().length < 2 || name === organization.name}
            onClick={() => void save()}
          >
            <Save />
            保存设置
          </Button>
          {!canManage ? <p className="quiet-copy">只有组织所有者或管理员可以修改组织信息。</p> : null}
          <Button
            variant="secondary"
            onClick={() =>
              void action(async () => {
                download(await client.exportOrganization(organization.id), `capaport-${organization.slug}.json`);
              }, '组织数据已导出')
            }
          >
            <Download />
            导出组织数据
          </Button>
        </Panel>
        <Panel>
          <div className="settings-title">
            <ShieldCheck />
            <div>
              <h2>当前账号</h2>
              <p>身份与组织角色</p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>显示名称</dt>
              <dd>{user?.displayName ?? '—'}</dd>
            </div>
            <div>
              <dt>组织角色</dt>
              <dd>
                <Status tone="good">{organization.role}</Status>
              </dd>
            </div>
            <div>
              <dt>账号标识</dt>
              <dd>{user?.id.slice(0, 12) ?? '—'}…</dd>
            </div>
          </dl>
          <Button variant="secondary" onClick={onLogout}>
            <LogOut />
            退出登录
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void action(async () => {
                download(await client.exportAccount(), 'capaport-account.json');
              }, '账号数据已导出')
            }
          >
            <Download />
            导出我的数据
          </Button>
          {!accountDeletionAt ? (
            <Button
              variant="danger"
              onClick={() =>
                void action(async () => {
                  if (!window.confirm('账号将在 30 天后匿名化删除。仍要继续吗？')) return;
                  const result = await client.requestAccountDeletion();
                  setAccountDeletionAt(result.deletionScheduledAt);
                }, '账号注销已进入 30 天宽限期')
              }
            >
              <Trash2 />
              申请注销账号
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() =>
                void action(async () => {
                  await client.cancelAccountDeletion();
                  setAccountDeletionAt('');
                }, '账号注销已取消')
              }
            >
              取消账号注销（原定 {new Date(accountDeletionAt).toLocaleDateString()}）
            </Button>
          )}
          {organization.role !== 'owner' ? (
            <Button variant="danger" onClick={() => void onLeave()}>
              <LogOut />
              退出当前组织
            </Button>
          ) : null}
        </Panel>
        {organization.role === 'owner' ? (
          <Panel className="wide">
            <div className="settings-title">
              <UserRoundCog />
              <div>
                <h2>所有权与组织关闭</h2>
                <p>所有权移交即时生效；组织关闭有 30 天可撤销宽限期。</p>
              </div>
            </div>
            <label>
              新所有者
              <select value={targetOwner} onChange={(event) => setTargetOwner(event.target.value)}>
                <option value="">选择一个活跃成员</option>
                {members
                  .filter((member) => member.status === 'active' && member.userId !== user?.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName} · {member.role}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={!targetOwner}
              onClick={() =>
                void action(async () => {
                  if (!window.confirm('移交后你的角色将变为管理员。确认继续？')) return;
                  await client.transferOwnership(organization.id, targetOwner);
                }, '组织所有权已移交')
              }
            >
              <UserRoundCog />
              移交所有权
            </Button>
            {organization.status === 'closing' ? (
              <>
                <p className="quiet-copy">
                  组织将在{' '}
                  {organization.deletionScheduledAt
                    ? new Date(organization.deletionScheduledAt).toLocaleString()
                    : '宽限期结束后'}{' '}
                  永久删除。
                </p>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void action(async () => {
                      await client.cancelOrganizationClosure(organization.id);
                    }, '组织关闭已取消')
                  }
                >
                  取消组织关闭
                </Button>
              </>
            ) : (
              <>
                <label>
                  输入组织名称或标识确认关闭
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                </label>
                <Button
                  variant="danger"
                  disabled={confirmation !== organization.name && confirmation !== organization.slug}
                  onClick={() =>
                    void action(async () => {
                      await client.closeOrganization(organization.id, confirmation);
                    }, '组织关闭已进入 30 天宽限期')
                  }
                >
                  <Trash2 />
                  安排关闭组织
                </Button>
              </>
            )}
          </Panel>
        ) : null}
        <Panel className="wide">
          <div className="settings-title">
            <ShieldCheck />
            <div>
              <h2>数据保护边界</h2>
              <p>CapaPort 默认不上传业务源码、绝对路径、令牌与本地密钥。</p>
            </div>
          </div>
          <div className="assurance-grid">
            <span>云端加密制品存储</span>
            <span>上传前客户端扫描</span>
            <span>组织级租户隔离</span>
            <span>不可变审计与保留策略</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
