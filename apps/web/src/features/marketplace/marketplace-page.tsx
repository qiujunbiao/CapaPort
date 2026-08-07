import type { CapabilitySummary, CapabilityVersionSummary, SpaceSummary } from '@agentdoor/contracts';
import { Box, Search, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel, Status } from '../../components/ui';

export function MarketplacePage({
  client,
  capabilities,
  spaces,
  canGovern,
  onRefresh,
}: {
  client: WebClient;
  capabilities: CapabilitySummary[];
  spaces: SpaceSummary[];
  canGovern: boolean;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [spaceType, setSpaceType] = useState('all');
  const [selected, setSelected] = useState<CapabilitySummary>();
  const [versions, setVersions] = useState<CapabilityVersionSummary[]>();
  const [error, setError] = useState('');
  const types = new Map(spaces.map((space) => [space.id, space.type]));
  const filtered = useMemo(
    () =>
      capabilities.filter((capability) => {
        const matches = `${capability.name} ${capability.slug} ${capability.tags.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return matches && (spaceType === 'all' || types.get(capability.spaceId) === spaceType);
      }),
    [capabilities, query, spaceType, types],
  );

  async function open(capability: CapabilitySummary) {
    setSelected(capability);
    setVersions(undefined);
    setError('');
    try {
      setVersions(await client.versions(capability.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本加载失败');
    }
  }

  async function transition(version: CapabilityVersionSummary, action: 'deprecate' | 'withdraw' | 'archive') {
    if (!selected) return;
    setError('');
    try {
      await client.transitionVersion(selected.id, version.id, action);
      setVersions(await client.versions(selected.id));
      onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本状态更新失败');
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="CAPABILITY MARKETPLACE / 02"
        title="组织能力市场"
        description="浏览组织可见的 Skill、Prompt 与项目上下文包，查看兼容性和版本生命周期。"
      />
      <Panel>
        <div className="filter-bar">
          <label className="search">
            <Search />
            <span className="sr-only">搜索能力</span>
            <input
              placeholder="搜索名称、标签或发布者"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            空间
            <select aria-label="空间类型" value={spaceType} onChange={(event) => setSpaceType(event.target.value)}>
              <option value="all">全部空间</option>
              <option value="personal">个人</option>
              <option value="team">团队</option>
              <option value="project">项目</option>
              <option value="organization">组织</option>
            </select>
          </label>
        </div>
        {filtered.length ? (
          <div className="market-grid">
            {filtered.map((capability) => (
              <button type="button" className="market-card" key={capability.id} onClick={() => void open(capability)}>
                <span className="package-icon">
                  <Box />
                </span>
                <Status tone={types.get(capability.spaceId) === 'organization' ? 'good' : 'neutral'}>
                  {types.get(capability.spaceId) ?? 'space'}
                </Status>
                <h2>{capability.name}</h2>
                <p>{capability.description || '暂无描述'}</p>
                <div className="tag-row">
                  {capability.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <footer>
                  {capability.compatibility.join(' · ')}
                  <span>查看详情 →</span>
                </footer>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="没有匹配的能力" description="调整搜索词或空间筛选条件。" />
        )}
      </Panel>
      {selected ? (
        <div className="drawer-backdrop">
          <aside className="drawer" aria-label="能力详情">
            <header>
              <div>
                <p className="eyebrow">CAPABILITY DETAIL</p>
                <h2>{selected.name}</h2>
              </div>
              <button type="button" aria-label="关闭能力详情" onClick={() => setSelected(undefined)}>
                <X />
              </button>
            </header>
            <p className="drawer-description">{selected.description}</p>
            <dl className="detail-list">
              <div>
                <dt>标识</dt>
                <dd>agentdoor/{selected.slug}</dd>
              </div>
              <div>
                <dt>兼容 Agent</dt>
                <dd>{selected.compatibility.join(', ')}</dd>
              </div>
              <div>
                <dt>标签</dt>
                <dd>{selected.tags.join(', ') || '未分类'}</dd>
              </div>
            </dl>
            <div className="assurance">
              <ShieldCheck />
              <span>
                <strong>组织权限已验证</strong>
                <small>仅展示当前成员有权访问的版本。</small>
              </span>
            </div>
            {error ? <ErrorNotice>{error}</ErrorNotice> : null}
            <h3>版本历史</h3>
            {!versions ? (
              <LoadingBlock label="加载版本" />
            ) : versions.length ? (
              <div className="version-list">
                {versions.map((version) => (
                  <article key={version.id}>
                    <div>
                      <strong>v{version.version}</strong>
                      <small>
                        {new Date(version.publishedAt).toLocaleDateString()} · {version.contentDigest.slice(0, 12)}
                      </small>
                    </div>
                    <Status tone={version.status === 'published' ? 'good' : 'warn'}>{version.status}</Status>
                    {canGovern && version.status === 'published' ? (
                      <div className="row-actions">
                        <Button variant="quiet" onClick={() => void transition(version, 'deprecate')}>
                          弃用
                        </Button>
                        <Button variant="danger" onClick={() => void transition(version, 'withdraw')}>
                          撤回
                        </Button>
                      </div>
                    ) : null}
                    {canGovern && version.status === 'withdrawn' ? (
                      <Button variant="secondary" onClick={() => void transition(version, 'archive')}>
                        归档
                      </Button>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="暂无已发布版本" description="该能力仍在沉淀或审核中。" />
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
