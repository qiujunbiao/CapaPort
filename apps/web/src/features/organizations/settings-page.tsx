import type { OrganizationSummary, PublicUser } from '@agentdoor/contracts';
import { Building2, LogOut, Save, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { WebClient } from '../../app/types';
import { Button, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function OrganizationSettingsPage({
  client,
  organization,
  user,
  canManage,
  onSaved,
  onLogout,
  onLeave,
}: {
  client: WebClient;
  organization: OrganizationSummary;
  user: PublicUser | undefined;
  canManage: boolean;
  onSaved: () => Promise<void> | void;
  onLogout: () => void;
  onLeave: () => Promise<void>;
}) {
  const [name, setName] = useState(organization.name);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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
          {organization.role !== 'owner' ? (
            <Button variant="danger" onClick={() => void onLeave()}>
              <LogOut />
              退出当前组织
            </Button>
          ) : null}
        </Panel>
        <Panel className="wide">
          <div className="settings-title">
            <ShieldCheck />
            <div>
              <h2>数据保护边界</h2>
              <p>Agentdoor 默认不上传业务源码、绝对路径、令牌与本地密钥。</p>
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
