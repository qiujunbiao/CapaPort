import type { SpaceSummary } from '@agentdoor/contracts';
import { FolderGit2, Link2, Plus, Shield } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, PageHeader, Panel, Status } from '../../components/ui';

export function ProjectsPage({
  spaces,
  onBind,
}: {
  spaces: SpaceSummary[];
  onBind: (spaceId: string, path: string) => Promise<void>;
}) {
  const projects = spaces.filter((space) => space.type === 'project');
  const [binding, setBinding] = useState<{ spaceId: string; path: string }>();
  const [message, setMessage] = useState('');
  async function submit() {
    if (!binding?.path) return;
    await onBind(binding.spaceId, binding.path);
    setMessage('目录已绑定。同步仅包含规则、上下文和能力包，不上传业务源码。');
    setBinding(undefined);
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="PROJECT CONTEXT / 03"
        title="项目空间"
        description="一个项目可绑定多个本地目录，精确控制规则、上下文与能力同步。"
      />
      <div className="notice-line">
        <Shield aria-hidden />
        <span>
          <strong>源码边界</strong> Agentdoor 不扫描或上传业务源码，只处理明确选择的能力目录与项目规则。
        </span>
      </div>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PROJECT BINDINGS</p>
            <h2>本地目录绑定</h2>
          </div>
        </div>
        {message ? (
          <p className="success-message" role="status">
            {message}
          </p>
        ) : null}
        {projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <div className="project-card__top">
                  <FolderGit2 aria-hidden />
                  <Status tone={project.reviewPolicy === 'required' ? 'warn' : 'good'}>
                    {project.reviewPolicy === 'required' ? '发布需审核' : '直接发布'}
                  </Status>
                </div>
                <h3>{project.name}</h3>
                <p className="mono">{project.slug}</p>
                <dl>
                  <div>
                    <dt>本地目录</dt>
                    <dd>尚未绑定</dd>
                  </div>
                  <div>
                    <dt>共享范围</dt>
                    <dd>规则 · 上下文 · 能力包</dd>
                  </div>
                </dl>
                <Button variant="secondary" onClick={() => setBinding({ spaceId: project.id, path: '' })}>
                  <Link2 aria-hidden size={15} />
                  绑定目录
                </Button>
              </article>
            ))}
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
              <p>输入经你确认的项目绝对路径。客户端将建立本地关联，不会把路径上传到云端。</p>
            </div>
            <label>
              项目目录
              <input
                value={binding.path}
                placeholder="/path/to/project"
                onChange={(event) => setBinding({ ...binding, path: event.target.value })}
              />
            </label>
            <div className="modal__actions">
              <Button variant="quiet" onClick={() => setBinding(undefined)}>
                取消
              </Button>
              <Button disabled={!binding.path} onClick={submit}>
                <Plus aria-hidden size={15} />
                确认绑定
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
