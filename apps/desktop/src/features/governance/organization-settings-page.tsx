import type { OrganizationSummary, PublicUser } from '@capaport/contracts';
import { Download, Settings } from 'lucide-react';
import { useState } from 'react';
import type { OrganizationMember } from '../../app/types';
import { Button, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function OrganizationSettingsPage({
  online,
  canManage,
  organization,
  user,
  members,
  accountDeletionStatus,
  onRename,
  onExportOrganization,
  onExportAccount,
  onTransferOwnership,
  onLeave,
  onCloseOrganization,
  onCancelClosure,
  onRequestAccountDeletion,
  onCancelAccountDeletion,
}: {
  online: boolean;
  canManage?: boolean;
  organization: OrganizationSummary;
  user?: PublicUser;
  members: OrganizationMember[];
  accountDeletionStatus: { status: string; deletionScheduledAt?: string };
  onRename: (name: string) => Promise<void>;
  onExportOrganization: () => Promise<void>;
  onExportAccount: () => Promise<void>;
  onTransferOwnership: (membershipId: string) => Promise<void>;
  onLeave: () => Promise<void>;
  onCloseOrganization: (confirmation: string) => Promise<void>;
  onCancelClosure: () => Promise<void>;
  onRequestAccountDeletion: () => Promise<void>;
  onCancelAccountDeletion: () => Promise<void>;
}) {
  const mayManageOrganization = canManage ?? (organization.role === 'owner' || organization.role === 'admin');
  const [name, setName] = useState(organization.name);
  const [confirmation, setConfirmation] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATION LIFECYCLE"
        title="组织设置"
        description="管理组织身份、数据导出、所有权和关闭流程。"
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="governance-grid">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">IDENTITY</p>
              <h2>组织信息</h2>
            </div>
          </div>
          <div className="form-grid governance-form">
            <label>
              组织名称
              <input
                aria-label="组织名称"
                value={name}
                disabled={!mayManageOrganization}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              组织标识
              <input readOnly value={organization.slug} />
            </label>
            <label>
              内部组织 ID
              <input readOnly value={organization.id} />
            </label>
            <Button
              disabled={!online || !mayManageOrganization || busy || name.trim().length < 2}
              onClick={() => void run(() => onRename(name.trim()))}
            >
              保存组织名称
            </Button>
          </div>
          {!mayManageOrganization ? <p className="quiet-copy">只有组织所有者或管理员可以修改组织信息。</p> : null}
          <dl className="settings-list">
            {user ? (
              <>
                <div>
                  <dt>当前账号</dt>
                  <dd>{user.displayName}</dd>
                </div>
                <div>
                  <dt>账号标识</dt>
                  <dd>{user.id}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>组织角色</dt>
              <dd>{organization.role}</dd>
            </div>
          </dl>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DATA PORTABILITY</p>
              <h2>数据导出</h2>
            </div>
          </div>
          <div className="action-list">
            <Button variant="secondary" disabled={!online || busy} onClick={() => void run(onExportOrganization)}>
              <Download aria-hidden />
              导出组织数据
            </Button>
            <Button variant="secondary" disabled={!online || busy} onClick={() => void run(onExportAccount)}>
              导出账号数据
            </Button>
          </div>
        </Panel>
      </div>
      {organization.role === 'owner' ? (
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">OWNERSHIP</p>
              <h2>所有权与关闭</h2>
            </div>
            <Status tone={organization.status === 'closing' ? 'warn' : 'good'}>{organization.status}</Status>
          </div>
          {organization.status === 'closing' && organization.deletionScheduledAt ? (
            <p className="quiet-copy">
              组织计划删除时间：{new Date(organization.deletionScheduledAt).toLocaleString('zh-CN')}
            </p>
          ) : null}
          <div className="form-grid governance-form">
            <label>
              新所有者
              <select value={owner} onChange={(event) => setOwner(event.target.value)}>
                <option value="">选择成员</option>
                {members
                  .filter((item) => item.role !== 'owner' && item.status === 'active')
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={!online || !owner || busy}
              onClick={() => void run(() => onTransferOwnership(owner))}
            >
              移交所有权
            </Button>
            <label>
              关闭组织确认
              <input
                aria-label="关闭组织确认"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={organization.name}
              />
            </label>
            {organization.status === 'closing' ? (
              <Button disabled={!online || busy} onClick={() => void run(onCancelClosure)}>
                取消关闭组织
              </Button>
            ) : (
              <Button
                variant="danger"
                disabled={!online || busy || (confirmation !== organization.name && confirmation !== organization.slug)}
                onClick={() => void run(() => onCloseOrganization(confirmation))}
              >
                关闭组织
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <Panel>
          <Button variant="danger" disabled={!online || busy} onClick={() => void run(onLeave)}>
            退出组织
          </Button>
        </Panel>
      )}
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ACCOUNT</p>
            <h2>账号生命周期</h2>
          </div>
          <Status tone={accountDeletionStatus.status === 'none' ? 'good' : 'warn'}>
            {accountDeletionStatus.status}
          </Status>
        </div>
        {accountDeletionStatus.status === 'scheduled' && accountDeletionStatus.deletionScheduledAt ? (
          <p className="quiet-copy">
            账号计划注销时间：{new Date(accountDeletionStatus.deletionScheduledAt).toLocaleString('zh-CN')}
          </p>
        ) : null}
        {accountDeletionStatus.status === 'scheduled' ? (
          <Button disabled={!online || busy} onClick={() => void run(onCancelAccountDeletion)}>
            取消注销账号
          </Button>
        ) : (
          <Button variant="danger" disabled={!online || busy} onClick={() => void run(onRequestAccountDeletion)}>
            <Settings aria-hidden />
            申请注销账号
          </Button>
        )}
      </Panel>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DATA PROTECTION</p>
            <h2>数据保护边界</h2>
          </div>
        </div>
        <p className="quiet-copy">CapaPort 默认不上传业务源码、绝对路径、令牌与本地密钥。</p>
        <div className="action-list">
          <Status tone="good">云端加密制品存储</Status>
          <Status tone="good">上传前客户端扫描</Status>
          <Status tone="good">组织级租户隔离</Status>
          <Status tone="good">不可变审计与保留策略</Status>
        </div>
      </Panel>
    </div>
  );
}
