import { MailPlus, Users } from 'lucide-react';
import { useState } from 'react';
import type { OrganizationInvitation, OrganizationMember } from '../../app/types';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

type InviteInput = { kind: 'email' | 'phone'; target: string; role: 'admin' | 'auditor' | 'member' };

export function MembersPage({
  online,
  members,
  invitations,
  onInvite,
  onRevokeInvitation,
  onChangeRole,
  onRemove,
}: {
  online: boolean;
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
  onInvite: (input: InviteInput) => Promise<void>;
  onRevokeInvitation: (invitationId: string) => Promise<void>;
  onChangeRole: (membershipId: string, role: InviteInput['role']) => Promise<void>;
  onRemove: (membershipId: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<'email' | 'phone'>('email');
  const [target, setTarget] = useState('');
  const [role, setRole] = useState<InviteInput['role']>('member');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function mutate(id: string, operation: () => Promise<void>) {
    setBusy(id);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '成员操作失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATION ACCESS"
        title="成员与邀请"
        description="维护组织成员、邀请状态和最小权限角色。"
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="governance-grid">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INVITE MEMBER</p>
              <h2>发送邀请</h2>
            </div>
          </div>
          <div className="form-grid governance-form">
            <label>
              账号类型
              <select value={kind} onChange={(event) => setKind(event.target.value as 'email' | 'phone')}>
                <option value="email">邮箱</option>
                <option value="phone">手机号</option>
              </select>
            </label>
            <label>
              邀请账号
              <input aria-label="邀请账号" value={target} onChange={(event) => setTarget(event.target.value)} />
            </label>
            <label>
              组织角色
              <select value={role} onChange={(event) => setRole(event.target.value as InviteInput['role'])}>
                <option value="member">成员</option>
                <option value="auditor">审计员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <Button
              disabled={!online || !target.trim()}
              busy={busy === 'invite'}
              onClick={() =>
                void mutate('invite', async () => {
                  await onInvite({ kind, target: target.trim(), role });
                  setTarget('');
                })
              }
            >
              <MailPlus aria-hidden />
              发送邀请
            </Button>
          </div>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INVITATION HISTORY</p>
              <h2>邀请记录</h2>
            </div>
          </div>
          {invitations.length ? (
            <div className="governance-list">
              {invitations.map((invitation) => {
                const status = invitation.acceptedAt ? '已接受' : invitation.revokedAt ? '已撤销' : '等待接受';
                return (
                  <div className="governance-row" key={invitation.id}>
                    <span>
                      <strong>{invitation.target}</strong>
                      <small>
                        {invitation.role} · {new Date(invitation.expiresAt).toLocaleDateString()}
                      </small>
                    </span>
                    <Status tone={invitation.acceptedAt ? 'good' : invitation.revokedAt ? 'neutral' : 'warn'}>
                      {status}
                    </Status>
                    {!invitation.acceptedAt && !invitation.revokedAt ? (
                      <Button
                        variant="secondary"
                        disabled={!online || Boolean(busy)}
                        onClick={() => void mutate(invitation.id, () => onRevokeInvitation(invitation.id))}
                      >
                        撤销
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<MailPlus />} title="暂无邀请记录" description="新发送的邀请会显示在这里。" />
          )}
        </Panel>
      </div>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ACTIVE MEMBERS</p>
            <h2>组织成员</h2>
          </div>
        </div>
        {members.length ? (
          <div className="member-table">
            {members.map((member) => (
              <div className="governance-row" key={member.id}>
                <span>
                  <strong>{member.displayName}</strong>
                  <small>
                    {member.status} · {member.userId}
                  </small>
                </span>
                <Status tone={member.status === 'active' ? 'good' : 'neutral'}>{member.status}</Status>
                {member.role === 'owner' ? (
                  <strong>Owner</strong>
                ) : (
                  <select
                    aria-label={`${member.displayName} 的组织角色`}
                    value={member.role}
                    disabled={!online || Boolean(busy)}
                    onChange={(event) =>
                      void mutate(member.id, () => onChangeRole(member.id, event.target.value as InviteInput['role']))
                    }
                  >
                    <option value="member">成员</option>
                    <option value="auditor">审计员</option>
                    <option value="admin">管理员</option>
                  </select>
                )}
                <Button
                  variant="danger"
                  aria-label={`移除 ${member.displayName}`}
                  disabled={!online || member.role === 'owner' || Boolean(busy)}
                  onClick={() => void mutate(member.id, () => onRemove(member.id))}
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Users />} title="暂无组织成员" description="组织成员信息会显示在这里。" />
        )}
      </Panel>
    </div>
  );
}
