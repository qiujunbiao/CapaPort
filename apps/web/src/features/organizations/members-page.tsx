import type { OrganizationRole } from '@capaport/contracts';
import { MailPlus, MoreHorizontal, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import type { OrganizationInvitation, OrganizationMember, WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function MembersPage({
  client,
  organizationId,
  members,
  invitations,
  onRefresh,
}: {
  client: WebClient;
  organizationId: string;
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
  onRefresh: () => Promise<void> | void;
}) {
  const [target, setTarget] = useState('');
  const [role, setRole] = useState<'admin' | 'auditor' | 'member'>('member');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function invite() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await client.invite(organizationId, { kind: target.includes('@') ? 'email' : 'phone', target, role });
      setTarget('');
      setMessage('邀请已发送');
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邀请发送失败');
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(memberId: string, nextRole: OrganizationRole) {
    if (nextRole === 'owner') return;
    try {
      await client.changeMemberRole(organizationId, memberId, nextRole);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '角色更新失败');
    }
  }
  async function remove(memberId: string) {
    try {
      await client.removeMember(organizationId, memberId);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '成员移除失败');
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="DIRECTORY & ACCESS / 04"
        title="成员与邀请"
        description="管理组织角色、待接受邀请与成员生命周期。"
      />
      <Panel className="invite-panel">
        <div>
          <span className="section-icon">
            <MailPlus />
          </span>
          <div>
            <h2>邀请成员</h2>
            <p>邮箱或手机号将按最小权限角色加入。</p>
          </div>
        </div>
        <label>
          邀请邮箱或手机号
          <input
            aria-label="邀请邮箱或手机号"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="name@example.com"
          />
        </label>
        <label>
          组织角色
          <select aria-label="组织角色" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="member">成员</option>
            <option value="auditor">审计员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <Button busy={busy} disabled={target.trim().length < 3} onClick={() => void invite()}>
          发送邀请
        </Button>
      </Panel>
      {message ? (
        <p className="success-banner" role="status">
          {message}
        </p>
      ) : null}
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <Panel>
        <div className="panel-title">
          <div>
            <p className="eyebrow">ACTIVE MEMBERS</p>
            <h2>成员 ({members.length})</h2>
          </div>
        </div>
        {members.length ? (
          <div className="data-table">
            <div className="data-table__head">
              <span>成员</span>
              <span>角色</span>
              <span>状态</span>
              <span>加入时间</span>
              <span>操作</span>
            </div>
            {members.map((member) => (
              <div className="data-table__row" key={member.id}>
                <span className="member-cell">
                  <i>
                    <UserRound />
                  </i>
                  <b>{member.displayName}</b>
                  <small>{member.userId.slice(0, 10)}…</small>
                </span>
                <span>
                  <select
                    aria-label={`${member.displayName}的角色`}
                    value={member.role}
                    disabled={member.role === 'owner'}
                    onChange={(event) => void changeRole(member.id, event.target.value as OrganizationRole)}
                  >
                    <option value="owner">所有者</option>
                    <option value="admin">管理员</option>
                    <option value="auditor">审计员</option>
                    <option value="member">成员</option>
                  </select>
                </span>
                <span>
                  <Status tone={member.status === 'active' ? 'good' : 'warn'}>{member.status}</Status>
                </span>
                <span>{new Date(member.joinedAt).toLocaleDateString()}</span>
                <span>
                  {member.role !== 'owner' ? (
                    <Button
                      variant="quiet"
                      aria-label={`移除 ${member.displayName}`}
                      onClick={() => void remove(member.id)}
                    >
                      <MoreHorizontal />
                    </Button>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无成员" description="发送第一个组织邀请。" />
        )}
      </Panel>
      <Panel>
        <div className="panel-title">
          <div>
            <p className="eyebrow">PENDING INVITATIONS</p>
            <h2>邀请记录</h2>
          </div>
        </div>
        {invitations.length ? (
          <div className="compact-list">
            {invitations.map((invitation) => (
              <div className="invitation-row" key={invitation.id}>
                <span>
                  <strong>{invitation.target}</strong>
                  <small>
                    {invitation.role} · 截止 {new Date(invitation.expiresAt).toLocaleDateString()}
                  </small>
                </span>
                <Status tone={invitation.acceptedAt ? 'good' : invitation.revokedAt ? 'bad' : 'warn'}>
                  {invitation.acceptedAt ? '已接受' : invitation.revokedAt ? '已撤销' : '等待接受'}
                </Status>
                {!invitation.acceptedAt && !invitation.revokedAt ? (
                  <Button
                    variant="quiet"
                    aria-label={`撤销 ${invitation.target} 的邀请`}
                    onClick={async () => {
                      await client.revokeInvitation(organizationId, invitation.id);
                      await onRefresh();
                    }}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-copy">暂无邀请记录。</p>
        )}
      </Panel>
    </div>
  );
}
