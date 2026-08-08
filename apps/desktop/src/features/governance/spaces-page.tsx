import {
  createSpaceRequestSchema,
  type SpaceReviewPolicy,
  type SpaceRole,
  type SpaceSummary,
} from '@capaport/contracts';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import type { OrganizationMember, SpaceMember } from '../../app/types';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function SpacesGovernancePage({
  online,
  spaces,
  organizationMembers,
  loadMembers,
  onCreate,
  onPolicy,
  onArchive,
  onAddMember,
  onChangeMemberRole,
  onRemoveMember,
}: {
  online: boolean;
  spaces: SpaceSummary[];
  organizationMembers: OrganizationMember[];
  loadMembers: (spaceId: string) => Promise<SpaceMember[]>;
  onCreate: (input: { type: 'team' | 'project'; name: string; reviewPolicy: SpaceReviewPolicy }) => Promise<void>;
  onPolicy: (spaceId: string, policy: SpaceReviewPolicy) => Promise<void>;
  onArchive: (spaceId: string) => Promise<void>;
  onAddMember: (spaceId: string, userId: string, role: SpaceRole) => Promise<void>;
  onChangeMemberRole: (spaceId: string, membershipId: string, role: SpaceRole) => Promise<void>;
  onRemoveMember: (spaceId: string, membershipId: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<SpaceSummary>();
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [type, setType] = useState<'team' | 'project'>('team');
  const [name, setName] = useState('');
  const [reviewPolicy, setReviewPolicy] = useState<SpaceReviewPolicy>('required');
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<SpaceRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const createSpaceInput = createSpaceRequestSchema.safeParse({ type, name, reviewPolicy });

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '空间操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function select(space: SpaceSummary) {
    setSelected(space);
    setReviewPolicy(space.reviewPolicy);
    setNewUserId(organizationMembers[0]?.userId ?? '');
    setError('');
    try {
      setMembers(await loadMembers(space.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '空间成员加载失败');
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="SPACE GOVERNANCE"
        title="空间与策略"
        description="维护团队、项目空间、审核策略和空间成员角色。"
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CREATE SPACE</p>
            <h2>新建共享空间</h2>
          </div>
        </div>
        <div className="inline-form governance-form space-create-form">
          <label>
            空间类型
            <select value={type} onChange={(event) => setType(event.target.value as 'team' | 'project')}>
              <option value="team">团队</option>
              <option value="project">项目</option>
            </select>
          </label>
          <label>
            空间名称
            <input aria-label="空间名称" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            审核策略
            <select
              aria-label="创建空间审核策略"
              value={reviewPolicy}
              onChange={(event) => setReviewPolicy(event.target.value as SpaceReviewPolicy)}
            >
              <option value="direct">直接发布</option>
              <option value="required">必须审核</option>
            </select>
          </label>
          <Button
            disabled={!online || !createSpaceInput.success || busy}
            onClick={() => {
              if (!createSpaceInput.success) return;
              const { type: validType, name: validName, reviewPolicy: validReviewPolicy } = createSpaceInput.data;
              void run(() => onCreate({ type: validType, name: validName, reviewPolicy: validReviewPolicy }));
            }}
          >
            创建空间
          </Button>
        </div>
      </Panel>
      <div className="governance-split">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SPACES</p>
              <h2>团队与项目空间</h2>
            </div>
          </div>
          {spaces.filter((space) => space.type === 'team' || space.type === 'project').length ? (
            <div className="governance-list">
              {spaces
                .filter((space) => space.type === 'team' || space.type === 'project')
                .map((space) => (
                  <button
                    type="button"
                    key={space.id}
                    className={selected?.id === space.id ? 'is-selected' : ''}
                    onClick={() => void select(space)}
                  >
                    <span>
                      <strong>{space.name}</strong>
                      <small>
                        {space.slug} · {space.type}
                      </small>
                    </span>
                    <Status tone={space.status === 'active' ? 'good' : 'neutral'}>{space.status}</Status>
                  </button>
                ))}
            </div>
          ) : (
            <EmptyState
              icon={<Building2 />}
              title="暂无团队或项目空间"
              description="创建共享空间后可配置审核策略和成员。"
            />
          )}
        </Panel>
        <Panel>
          {selected ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SPACE POLICY</p>
                  <h2>{selected.name}</h2>
                </div>
              </div>
              <label>
                审核策略
                <select
                  aria-label="已选空间审核策略"
                  value={reviewPolicy}
                  disabled={!online || busy}
                  onChange={(event) => {
                    const value = event.target.value as SpaceReviewPolicy;
                    setReviewPolicy(value);
                    void run(() => onPolicy(selected.id, value));
                  }}
                >
                  <option value="direct">直接发布</option>
                  <option value="required">必须审核</option>
                </select>
              </label>
              <div className="inline-form governance-form">
                <label>
                  成员
                  <select value={newUserId} onChange={(event) => setNewUserId(event.target.value)}>
                    {organizationMembers.map((member) => (
                      <option value={member.userId} key={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  空间角色
                  <select value={newRole} onChange={(event) => setNewRole(event.target.value as SpaceRole)}>
                    <option value="viewer">查看者</option>
                    <option value="contributor">贡献者</option>
                    <option value="reviewer">审核者</option>
                    <option value="manager">负责人</option>
                  </select>
                </label>
                <Button
                  disabled={!online || !newUserId || busy}
                  onClick={() =>
                    void run(async () => {
                      await onAddMember(selected.id, newUserId, newRole);
                      setMembers(await loadMembers(selected.id));
                    })
                  }
                >
                  添加空间成员
                </Button>
              </div>
              <div className="governance-list">
                {members.map((member) => (
                  <div className="governance-row" key={member.id}>
                    <span>
                      <strong>{member.displayName}</strong>
                      <small>{member.userId}</small>
                    </span>
                    <select
                      aria-label={`${member.displayName} 的空间角色`}
                      value={member.role}
                      onChange={(event) =>
                        void run(() => onChangeMemberRole(selected.id, member.id, event.target.value as SpaceRole))
                      }
                    >
                      <option value="viewer">查看者</option>
                      <option value="contributor">贡献者</option>
                      <option value="reviewer">审核者</option>
                      <option value="manager">负责人</option>
                    </select>
                    <Button variant="danger" onClick={() => void run(() => onRemoveMember(selected.id, member.id))}>
                      移除
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="danger"
                disabled={!online || busy}
                onClick={() => void run(() => onArchive(selected.id))}
              >
                归档空间
              </Button>
            </>
          ) : (
            <EmptyState icon={<Building2 />} title="选择一个空间" description="查看并维护审核策略和成员。" />
          )}
        </Panel>
      </div>
    </div>
  );
}
