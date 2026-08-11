import type {
  AgentId,
  CapabilitySummary,
  CapabilityVersionDiff,
  CapabilityVersionSummary,
  SpaceSummary,
  UpdateCapabilityRequest,
} from '@capaport/contracts';
import { agentLabels, type EditableAgent } from '@capaport/capability-kit';
import { Boxes, GitCompareArrows } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

const editableAgents: readonly EditableAgent[] = [
  'codex',
  'claude-code',
  'cursor',
  'gemini-cli',
  'workbuddy',
  'qwenwork',
];

export function CapabilityAssetsPage({
  capabilities,
  spaces,
  online,
  canManage,
  currentUserId,
  loadVersions,
  loadDiff,
  onUpdate,
  onTransition,
}: {
  capabilities: CapabilitySummary[];
  spaces: SpaceSummary[];
  online: boolean;
  canManage: boolean;
  currentUserId?: string;
  loadVersions: (capabilityId: string) => Promise<CapabilityVersionSummary[]>;
  loadDiff: (capabilityId: string, versionId: string, againstVersionId: string) => Promise<CapabilityVersionDiff>;
  onUpdate: (capabilityId: string, input: UpdateCapabilityRequest) => Promise<void>;
  onTransition: (
    capabilityId: string,
    versionId: string,
    action: 'deprecate' | 'withdraw' | 'archive',
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState<CapabilitySummary>();
  const [versions, setVersions] = useState<CapabilityVersionSummary[]>([]);
  const [diff, setDiff] = useState<CapabilityVersionDiff>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [compatibility, setCompatibility] = useState<AgentId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const spaceNames = new Map(spaces.map((space) => [space.id, space.name]));
  const selectedSpace = spaces.find((space) => space.id === selected?.spaceId);
  const canEditMetadata = Boolean(
    selected &&
      (canManage ||
        selected.ownerUserId === currentUserId ||
        selectedSpace?.role === 'manager' ||
        selectedSpace?.role === 'contributor'),
  );

  async function select(capability: CapabilitySummary) {
    setSelected(capability);
    setName(capability.name);
    setDescription(capability.description);
    setTags(capability.tags.join(', '));
    setCompatibility(capability.compatibility);
    setDiff(undefined);
    setError('');
    try {
      setVersions(await loadVersions(capability.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本加载失败');
    }
  }

  function toggleAgent(agent: AgentId) {
    setCompatibility((current) =>
      current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent],
    );
  }

  async function save() {
    if (!selected || !name.trim() || !compatibility.length) return;
    setBusy(true);
    setError('');
    try {
      await onUpdate(selected.id, {
        name: name.trim(),
        description: description.trim(),
        tags: [
          ...new Set(
            tags
              .split(',')
              .map((tag) => tag.trim().toLowerCase())
              .filter(Boolean),
          ),
        ],
        compatibility,
      });
      setSelected({ ...selected, name: name.trim(), description: description.trim(), compatibility });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '能力元数据保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!selected || versions.length < 2) return;
    const [currentVersion, previousVersion] = versions;
    if (!currentVersion || !previousVersion) return;
    setBusy(true);
    setError('');
    try {
      setDiff(await loadDiff(selected.id, currentVersion.id, previousVersion.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本比较失败');
    } finally {
      setBusy(false);
    }
  }

  async function transition(version: CapabilityVersionSummary, action: 'deprecate' | 'withdraw' | 'archive') {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await onTransition(selected.id, version.id, action);
      setVersions(await loadVersions(selected.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版本状态更新失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="CAPABILITY GOVERNANCE"
        title="能力资产"
        description="管理已发布和未发布能力的元数据、不可变版本与生命周期。"
      />
      <div className="governance-split">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ASSET CATALOG</p>
              <h2>全部能力资产</h2>
            </div>
          </div>
          {capabilities.length ? (
            <div className="governance-list">
              {capabilities.map((capability) => (
                <button
                  type="button"
                  className={selected?.id === capability.id ? 'is-selected' : ''}
                  key={capability.id}
                  onClick={() => void select(capability)}
                >
                  <span>
                    <strong>{capability.name}</strong>
                    <small>{spaceNames.get(capability.spaceId) ?? capability.slug}</small>
                  </span>
                  <Status tone={capability.hasPublishedVersion ? 'good' : 'warn'}>
                    {capability.hasPublishedVersion ? '已发布' : '未发布'}
                  </Status>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Boxes />} title="暂无能力资产" description="创建或导入能力后将在这里统一管理。" />
          )}
        </Panel>
        <Panel>
          {selected ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">PACKAGE METADATA</p>
                  <h2>{selected.name}</h2>
                </div>
              </div>
              {error ? <ErrorNotice>{error}</ErrorNotice> : null}
              <div className="form-grid governance-form">
                <label>
                  能力名称
                  <input aria-label="能力名称" value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  描述
                  <textarea
                    aria-label="能力描述"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label>
                  标签
                  <input aria-label="能力标签" value={tags} onChange={(event) => setTags(event.target.value)} />
                </label>
                <fieldset>
                  <legend>兼容 Agent</legend>
                  {editableAgents.map((agent) => (
                    <label key={agent}>
                      <input
                        type="checkbox"
                        checked={compatibility.includes(agent)}
                        onChange={() => toggleAgent(agent)}
                      />
                      {agentLabels[agent]}
                    </label>
                  ))}
                </fieldset>
                <Button
                  busy={busy}
                  disabled={!online || !canEditMetadata || !name.trim() || !compatibility.length}
                  onClick={() => void save()}
                >
                  保存元数据
                </Button>
              </div>
              <div className="panel-heading governance-section-heading">
                <div>
                  <p className="eyebrow">IMMUTABLE VERSIONS</p>
                  <h2>版本历史</h2>
                </div>
                <Button variant="secondary" disabled={versions.length < 2 || busy} onClick={() => void compare()}>
                  <GitCompareArrows aria-hidden />
                  比较版本
                </Button>
              </div>
              <div className="version-list">
                {versions.map((version) => (
                  <div key={version.id}>
                    <span>
                      <strong>v{version.version}</strong>
                      <small>
                        {version.status} · {version.contentDigest.slice(0, 12)}
                      </small>
                    </span>
                    <div>
                      <Button
                        variant="secondary"
                        disabled={!online || !canManage || busy}
                        aria-label={`弃用版本 ${version.version}`}
                        onClick={() => void transition(version, 'deprecate')}
                      >
                        弃用
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!online || !canManage || busy}
                        onClick={() => void transition(version, 'withdraw')}
                      >
                        撤回
                      </Button>
                      <Button
                        variant="danger"
                        disabled={!online || !canManage || busy}
                        onClick={() => void transition(version, 'archive')}
                      >
                        归档
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {diff ? (
                <div className="review-evidence">
                  <GitCompareArrows aria-hidden />
                  <div>
                    <strong>版本差异 · {diff.recommendedChange}</strong>
                    <p>
                      新增 {diff.added.length} · 修改 {diff.modified.length} · 删除 {diff.removed.length}
                    </p>
                    <ul>
                      {diff.added.map((path) => (
                        <li key={path}>+ {path}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState icon={<Boxes />} title="选择一个能力资产" description="查看元数据和版本生命周期。" />
          )}
        </Panel>
      </div>
    </div>
  );
}
