import type { CapabilitySummary } from '@agentdoor/contracts';
import { ArrowRight, Bot, CircleAlert, CloudOff, Download, Radar, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, EmptyState, Metric, PageHeader, Panel, Status } from '../../components/ui';
import type { AgentDescriptor } from '../../generated/commands';

export function HomePage({
  agents,
  capabilities,
  online,
  loading,
  onDiscover,
  onNavigate,
}: {
  agents: AgentDescriptor[];
  capabilities: CapabilitySummary[];
  online: boolean;
  loading: boolean;
  onDiscover: () => void;
  onNavigate: (page: string) => void;
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="WORKSPACE / 01"
        title="今日工作台"
        description="发现本地能力，处理组织更新与冲突。"
        actions={
          <Button onClick={onDiscover}>
            <Radar aria-hidden size={17} />
            本地发现
          </Button>
        }
      />
      {!online ? (
        <div className="offline-banner">
          <CloudOff aria-hidden />
          <span>
            <strong>离线工作</strong> 云端发布、安装与组织数据暂不可用；本地扫描和草稿仍可继续。
          </span>
        </div>
      ) : null}
      <div className="metric-strip">
        <Metric value={agents.length} label="已连接 Agent" tone="green" />
        <Metric value="0" label="待更新" />
        <Metric value="0" label="冲突待处理" />
        <Metric value={capabilities.length} label="可用能力包" tone="orange" />
      </div>
      <div className="home-grid">
        <Panel className="home-grid__agents">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LOCAL AGENTS</p>
              <h2>代理连接状态</h2>
            </div>
            <Status tone={agents.length ? 'good' : 'warn'}>{agents.length ? '本地安全已连接' : '等待检测'}</Status>
          </div>
          {loading ? (
            <div className="skeleton-lines" role="status" aria-label="正在检测本地 Agent">
              <i />
              <i />
              <i />
            </div>
          ) : agents.length ? (
            <div className="agent-list">
              {agents.map((agent) => (
                <div className="agent-row" key={`${agent.adapterId}-${agent.scope}`}>
                  <span className="agent-icon">
                    <Bot aria-hidden />
                  </span>
                  <div>
                    <strong>{agent.displayName}</strong>
                    <small>{agent.scope === 'user' ? '用户级目录' : '项目目录'}</small>
                  </div>
                  <Status tone="good">已连接</Status>
                  <span className="agent-sync">可发现</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Bot />}
              title="尚未发现 Agent"
              description="安装或配置 Codex、Claude Code、Cursor、Gemini CLI 后重新检测。"
              action={
                <Button variant="secondary" onClick={onDiscover}>
                  重新检测
                </Button>
              }
            />
          )}
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACTION QUEUE</p>
              <h2>待处理事项</h2>
            </div>
          </div>
          <button type="button" className="action-row" onClick={() => onNavigate('library')}>
            <Download aria-hidden />
            <span>
              <strong>能力包更新</strong>
              <small>检查组织能力的新版本</small>
            </span>
            <b>0</b>
            <ArrowRight aria-hidden />
          </button>
          <button type="button" className="action-row" onClick={() => onNavigate('library')}>
            <CircleAlert aria-hidden />
            <span>
              <strong>冲突待解决</strong>
              <small>本地变更始终由你决定</small>
            </span>
            <b>0</b>
            <ArrowRight aria-hidden />
          </button>
          <button type="button" className="action-row" onClick={() => onNavigate('publishing')}>
            <ShieldCheck aria-hidden />
            <span>
              <strong>扫描与发布</strong>
              <small>查看阻断项和审核状态</small>
            </span>
            <b>0</b>
            <ArrowRight aria-hidden />
          </button>
        </Panel>
      </div>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RECENT CAPABILITIES</p>
            <h2>最近使用的能力包</h2>
          </div>
          <Button variant="quiet" onClick={() => onNavigate('library')}>
            查看能力库
            <ArrowRight aria-hidden size={15} />
          </Button>
        </div>
        {capabilities.length ? (
          <div className="data-table capability-table">
            <div className="data-table__head">
              <span>能力包</span>
              <span>作用域</span>
              <span>兼容</span>
              <span>状态</span>
            </div>
            {capabilities.slice(0, 5).map((capability) => (
              <div className="data-table__row" key={capability.id}>
                <span>
                  <strong>{capability.name}</strong>
                  <small>agentdoor/{capability.slug}</small>
                </span>
                <span>组织可见</span>
                <span className="mono">{capability.compatibility.join(' · ')}</span>
                <span>
                  <Status tone="good">可安装</Status>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<RefreshCw />} title="组织能力库还是空的" description="先从本地发现并沉淀第一个能力包。" />
        )}
      </Panel>
    </div>
  );
}
