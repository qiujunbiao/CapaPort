import type { AgentId, CapabilitySummary, SpaceSummary, UpdateCheck } from '@capaport/contracts';
import { Box, Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InstallationSummary } from '../../app/types';
import { Button, EmptyState, PageHeader, Panel, Status } from '../../components/ui';

const scopeTypes: Record<string, SpaceSummary['type'] | undefined> = {
  个人: 'personal',
  团队: 'team',
  项目: 'project',
  组织: 'organization',
};

export function LibraryPage({
  capabilities,
  spaces,
  installations,
  updateChecks,
  online,
  onInstall,
  onUninstall,
}: {
  capabilities: CapabilitySummary[];
  spaces: SpaceSummary[];
  installations: InstallationSummary[];
  updateChecks: Record<string, UpdateCheck>;
  online: boolean;
  onInstall: (capability: CapabilitySummary) => void;
  onUninstall: (capability: CapabilitySummary, installation: InstallationSummary) => void;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('全部');
  const [agent, setAgent] = useState('all');
  const spaceTypes = useMemo(() => new Map(spaces.map((space) => [space.id, space.type])), [spaces]);
  const installedIds = useMemo(
    () =>
      new Set(
        installations
          .filter((installation) => installation.status === 'installed')
          .map((installation) => installation.capabilityId),
      ),
    [installations],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const type = scopeTypes[scope];
    return capabilities.filter((item) => {
      const matchesSearch = `${item.name} ${item.slug} ${item.tags.join(' ')}`.toLowerCase().includes(normalizedQuery);
      const matchesScope =
        scope === '全部'
          ? true
          : scope === '已安装'
            ? installedIds.has(item.id)
            : spaceTypes.get(item.spaceId) === type;
      const matchesAgent = agent === 'all' || item.compatibility.includes(agent as AgentId);
      return matchesSearch && matchesScope && matchesAgent;
    });
  }, [agent, capabilities, installedIds, query, scope, spaceTypes]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="CAPABILITY REGISTRY / 02"
        title="能力库"
        description="跨个人、团队、项目与组织空间复用可执行能力、提示词和上下文包。"
      />
      <Panel className="library-panel">
        <div className="scope-tabs" role="tablist" aria-label="能力作用域">
          {['全部', '个人', '团队', '项目', '组织', '已安装'].map((item) => (
            <button type="button" role="tab" aria-selected={scope === item} key={item} onClick={() => setScope(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="library-tools">
          <label className="search-field">
            <Search aria-hidden />
            <span className="sr-only">搜索能力</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、标识或标签"
            />
          </label>
          <label>
            兼容 Agent
            <select aria-label="兼容 Agent" value={agent} onChange={(event) => setAgent(event.target.value)}>
              <option value="all">全部 Agent</option>
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
              <option value="cursor">Cursor</option>
              <option value="gemini-cli">Gemini CLI</option>
            </select>
          </label>
        </div>
        {filtered.length ? (
          <div className="registry-list">
            {filtered.map((capability) => (
              <article className="registry-row" key={capability.id}>
                <span className="package-mark">
                  <Box aria-hidden />
                </span>
                <div className="registry-row__main">
                  <div>
                    <strong>{capability.name}</strong>
                    <span className="version">LATEST</span>
                  </div>
                  <p>{capability.description || '暂无描述'}</p>
                  <small>
                    capaport/{capability.slug} · {capability.tags.join(' / ') || '未分类'}
                  </small>
                </div>
                <div className="compatibility">
                  {capability.compatibility.map((agent) => (
                    <span key={agent}>{agent}</span>
                  ))}
                </div>
                <Status tone={updateChecks[capability.id]?.action === 'remove' ? 'warn' : 'good'}>
                  {updateChecks[capability.id]?.action === 'remove' ? '版本已撤回' : '已发布'}
                </Status>
                <Button
                  disabled={!online || updateChecks[capability.id]?.action === 'remove'}
                  onClick={() => onInstall(capability)}
                >
                  <Download aria-hidden size={15} />
                  {updateChecks[capability.id]?.action === 'update'
                    ? '更新'
                    : updateChecks[capability.id]?.action === 'remove'
                      ? '不可安装'
                      : installedIds.has(capability.id)
                        ? '重新安装'
                        : '安装'}
                </Button>
                {installations.find(
                  (installation) => installation.capabilityId === capability.id && installation.status === 'installed',
                ) ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const installation = installations.find(
                        (item) => item.capabilityId === capability.id && item.status === 'installed',
                      );
                      if (installation) onUninstall(capability, installation);
                    }}
                  >
                    卸载
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Box />} title="没有匹配的能力包" description="调整搜索条件，或从本地发现一个新能力。" />
        )}
      </Panel>
    </div>
  );
}
