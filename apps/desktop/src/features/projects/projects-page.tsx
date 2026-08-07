import type { AgentId, SpaceSummary } from '@agentdoor/contracts';
import { Check, FileCheck2, FolderGit2, Link2, Plus, RefreshCw, Shield, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, PageHeader, Panel, Status } from '../../components/ui';
import type { LocalProjectBinding, ProjectInventory } from '../../generated/commands';

const agents: Array<{ id: AgentId; label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
];

export function ProjectsPage({
  spaces,
  loadBindings,
  onBind,
  onRemove,
  onInventory,
  onSync,
}: {
  spaces: SpaceSummary[];
  loadBindings: (spaceId: string) => Promise<LocalProjectBinding[]>;
  onBind: (spaceId: string, path: string, agents: AgentId[]) => Promise<void>;
  onRemove: (spaceId: string, binding: LocalProjectBinding) => Promise<void>;
  onInventory: (binding: LocalProjectBinding) => Promise<ProjectInventory>;
  onSync: (spaceId: string, binding: LocalProjectBinding, selectedPaths: string[], agents: AgentId[]) => Promise<void>;
}) {
  const projects = useMemo(() => spaces.filter((space) => space.type === 'project'), [spaces]);
  const [bindings, setBindings] = useState<Record<string, LocalProjectBinding[]>>({});
  const [binding, setBinding] = useState<{ spaceId: string; path: string; agents: AgentId[] }>();
  const [preview, setPreview] = useState<{
    spaceId: string;
    binding: LocalProjectBinding;
    inventory: ProjectInventory;
    selected: string[];
  }>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = useCallback(
    async (spaceId: string) => {
      const loaded = await loadBindings(spaceId);
      setBindings((current) => ({ ...current, [spaceId]: loaded }));
    },
    [loadBindings],
  );

  useEffect(() => {
    for (const project of projects) void refresh(project.id);
    // Project identifiers are stable; refresh when the visible project set changes.
  }, [projects, refresh]);

  async function submitBinding() {
    if (!binding?.path || binding.agents.length === 0) return;
    setWorking(true);
    setError('');
    try {
      await onBind(binding.spaceId, binding.path, binding.agents);
      await refresh(binding.spaceId);
      setMessage('目录已绑定。云端仅保存设备与不透明绑定 ID，本地绝对路径不会上传。');
      setBinding(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '绑定失败');
    } finally {
      setWorking(false);
    }
  }

  async function inspect(spaceId: string, current: LocalProjectBinding) {
    setWorking(true);
    setError('');
    try {
      const inventory = await onInventory(current);
      setPreview({
        spaceId,
        binding: current,
        inventory,
        selected: inventory.entries.filter((entry) => entry.eligible).map((entry) => entry.relativePath),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取目录清单');
    } finally {
      setWorking(false);
    }
  }

  async function sync() {
    if (!preview?.selected.length) return;
    setWorking(true);
    setError('');
    try {
      await onSync(preview.spaceId, preview.binding, preview.selected, preview.binding.agents as AgentId[]);
      setMessage(`已同步 ${preview.selected.length} 个显式选择的上下文文件，并完成客户端与服务端双重敏感信息检查。`);
      setPreview(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '同步失败');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="PROJECT CONTEXT / 03"
        title="项目空间"
        description="一个项目可绑定多个本地目录，只同步你明确选择的规则与上下文。"
      />
      <div className="notice-line">
        <Shield aria-hidden />
        <span>
          <strong>源码边界</strong> 默认忽略依赖、构建产物和版本库；源码、密钥文件、超限文件无法被选择。
        </span>
      </div>
      {message ? (
        <p className="success-message" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DEVICE-LOCAL BINDINGS</p>
            <h2>本地目录绑定</h2>
          </div>
        </div>
        {projects.length ? (
          <div className="project-grid">
            {projects.map((project) => {
              const projectBindings = bindings[project.id] ?? [];
              return (
                <article className="project-card" key={project.id}>
                  <div className="project-card__top">
                    <FolderGit2 aria-hidden />
                    <Status tone={project.reviewPolicy === 'required' ? 'warn' : 'good'}>
                      {project.reviewPolicy === 'required' ? '发布需审核' : '直接发布'}
                    </Status>
                  </div>
                  <h3>{project.name}</h3>
                  <p className="mono">{project.slug}</p>
                  <div className="project-bindings">
                    {projectBindings.length ? (
                      projectBindings.map((current) => (
                        <div className="project-binding-row" key={current.localBindingId}>
                          <span className="project-binding-row__state">
                            {current.status === 'active' ? <Check size={13} /> : <X size={13} />}
                            {current.status === 'active'
                              ? '已连接'
                              : current.status === 'missing'
                                ? '目录已移除'
                                : '已解绑'}
                          </span>
                          <code title={current.localPath}>
                            {current.localPath.split(/[\\/]/).filter(Boolean).at(-1)}
                          </code>
                          <span>{current.agents.length} 个 Agent</span>
                          <div>
                            <Button
                              variant="quiet"
                              disabled={working || current.status !== 'active'}
                              onClick={() => inspect(project.id, current)}
                            >
                              <FileCheck2 size={14} /> 选择同步
                            </Button>
                            <Button
                              variant="quiet"
                              disabled={working || current.status === 'removed'}
                              onClick={async () => {
                                if (!window.confirm('解除此设备上的项目目录绑定？云端历史同步快照不会被删除。')) return;
                                await onRemove(project.id, current);
                                await refresh(project.id);
                              }}
                            >
                              <Trash2 size={14} /> 解绑
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted-copy">尚未绑定本机目录</p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setBinding({ spaceId: project.id, path: '', agents: ['codex'] })}
                  >
                    <Link2 aria-hidden size={15} /> 绑定另一个目录
                  </Button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<FolderGit2 />}
            title="还没有项目空间"
            description="请由组织管理员在 Web 管理后台创建项目空间。"
          />
        )}
      </Panel>

      {binding ? (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="bind-title">
            <div className="modal__head">
              <p className="eyebrow">LOCAL BINDING</p>
              <h2 id="bind-title">绑定本地目录</h2>
              <p>绝对路径只写入本机数据库。云端只能看到随机绑定 ID 和本设备 ID。</p>
            </div>
            <label>
              项目目录
              <input
                value={binding.path}
                placeholder="/path/to/project"
                onChange={(event) => setBinding({ ...binding, path: event.target.value })}
              />
            </label>
            <fieldset className="agent-checkboxes">
              <legend>投影目标</legend>
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input
                    type="checkbox"
                    checked={binding.agents.includes(agent.id)}
                    onChange={(event) =>
                      setBinding({
                        ...binding,
                        agents: event.target.checked
                          ? [...binding.agents, agent.id]
                          : binding.agents.filter((id) => id !== agent.id),
                      })
                    }
                  />
                  {agent.label}
                </label>
              ))}
            </fieldset>
            <div className="modal__actions">
              <Button variant="quiet" onClick={() => setBinding(undefined)}>
                取消
              </Button>
              <Button disabled={!binding.path || !binding.agents.length || working} onClick={submitBinding}>
                <Plus aria-hidden size={15} /> {working ? '正在绑定…' : '确认绑定'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {preview ? (
        <div className="modal-backdrop">
          <section className="modal project-preview" role="dialog" aria-modal="true" aria-labelledby="preview-title">
            <div className="modal__head">
              <p className="eyebrow">EXPLICIT ALLOWLIST</p>
              <h2 id="preview-title">选择要同步的上下文</h2>
              <p>
                {preview.inventory.eligibleFiles} 个候选文件，{preview.inventory.eligibleBytes.toLocaleString()}{' '}
                字节；未勾选内容不会离开设备。
              </p>
            </div>
            <div className="context-file-list">
              {preview.inventory.entries.map((entry) => (
                <label className={entry.eligible ? '' : 'context-file--blocked'} key={entry.relativePath}>
                  <input
                    type="checkbox"
                    disabled={!entry.eligible}
                    checked={preview.selected.includes(entry.relativePath)}
                    onChange={(event) =>
                      setPreview({
                        ...preview,
                        selected: event.target.checked
                          ? [...preview.selected, entry.relativePath]
                          : preview.selected.filter((path) => path !== entry.relativePath),
                      })
                    }
                  />
                  <code>{entry.relativePath}</code>
                  <span>{entry.eligible ? `${entry.sizeBytes} B` : entry.ignoreReason}</span>
                </label>
              ))}
            </div>
            <div className="modal__actions">
              <Button variant="quiet" onClick={() => setPreview(undefined)}>
                取消
              </Button>
              <Button disabled={!preview.selected.length || working} onClick={sync}>
                <RefreshCw size={15} /> {working ? '扫描并同步…' : `同步 ${preview.selected.length} 个文件`}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
