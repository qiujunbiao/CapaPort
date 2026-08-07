import type { SpaceReviewPolicy, SpaceSummary } from '@agentdoor/contracts';
import { Archive, FolderKanban, Plus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import type { WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function SpacesPage({
  client,
  spaces,
  onRefresh,
}: {
  client: WebClient;
  spaces: SpaceSummary[];
  onRefresh: () => Promise<void> | void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<'team' | 'project'>('team');
  const [policy, setPolicy] = useState<SpaceReviewPolicy>('required');
  const [error, setError] = useState('');
  async function create() {
    try {
      await client.createSpace({ name, slug, type, reviewPolicy: policy });
      setCreating(false);
      setName('');
      setSlug('');
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '空间创建失败');
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="SHARING BOUNDARIES / 05"
        title="空间与治理策略"
        description="按个人、团队、项目和组织边界控制可见性与发布审核。"
        actions={
          <Button onClick={() => setCreating((value) => !value)}>
            <Plus />
            新建空间
          </Button>
        }
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {creating ? (
        <Panel className="inline-form">
          <label>
            空间名称
            <input aria-label="空间名称" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            英文标识
            <input
              aria-label="英文标识"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            />
          </label>
          <label>
            类型
            <select aria-label="空间类型" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="team">团队</option>
              <option value="project">项目</option>
            </select>
          </label>
          <label>
            发布策略
            <select
              aria-label="发布策略"
              value={policy}
              onChange={(event) => setPolicy(event.target.value as SpaceReviewPolicy)}
            >
              <option value="required">需要审核</option>
              <option value="direct">直接发布</option>
            </select>
          </label>
          <Button disabled={name.length < 2 || slug.length < 2} onClick={() => void create()}>
            创建
          </Button>
        </Panel>
      ) : null}
      {spaces.length ? (
        <div className="space-grid">
          {spaces.map((space) => (
            <Panel className="space-card" key={space.id}>
              <header>
                <span>{space.type === 'project' ? <FolderKanban /> : <UsersRound />}</span>
                <Status tone={space.status === 'active' ? 'good' : 'warn'}>{space.status}</Status>
              </header>
              <p className="eyebrow">{space.type.toUpperCase()} SPACE</p>
              <h2>{space.name}</h2>
              <small>/{space.slug}</small>
              <dl>
                <div>
                  <dt>我的角色</dt>
                  <dd>{space.role ?? (space.type === 'personal' ? 'owner' : 'organization')}</dd>
                </div>
                <div>
                  <dt>发布审核</dt>
                  <dd>
                    <select
                      aria-label={`${space.name}的发布策略`}
                      value={space.reviewPolicy}
                      disabled={space.type === 'personal' || space.type === 'organization'}
                      onChange={async (event) => {
                        await client.updateSpacePolicy(space.id, event.target.value as SpaceReviewPolicy);
                        await onRefresh();
                      }}
                    >
                      <option value="direct">直接发布</option>
                      <option value="required">需要审核</option>
                    </select>
                  </dd>
                </div>
              </dl>
              {space.type === 'team' || space.type === 'project' ? (
                <Button
                  variant="quiet"
                  onClick={async () => {
                    await client.archiveSpace(space.id);
                    await onRefresh();
                  }}
                >
                  <Archive />
                  归档空间
                </Button>
              ) : null}
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无空间" description="创建团队或项目空间开始共享能力。" />
      )}
    </div>
  );
}
