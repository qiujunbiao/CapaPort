import { Activity, MonitorUp, PackageCheck, Send } from 'lucide-react';
import type { AnalyticsMetrics } from '../../app/types';
import { PageHeader, Panel, Status } from '../../components/ui';

export function AnalyticsPage({ metrics }: { metrics: AnalyticsMetrics | undefined }) {
  const funnel = metrics?.publicationFunnel ?? {};
  const installed = metrics?.installationOutcomes.installed ?? 0;
  const failed = metrics?.installationOutcomes.failed ?? 0;
  const total = installed + failed;
  const successRate = total ? Math.round((installed / total) * 100) : 0;
  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATION SIGNALS / 08"
        title="采用与复用分析"
        description="仅展示组织级聚合指标，不采集硬件序列号、源码或绝对路径。"
      />
      <div className="metric-grid analytics-cards">
        <Panel className="metric-card">
          <span className="metric-card__icon">
            <PackageCheck />
          </span>
          <p>成功安装</p>
          <strong>{installed}</strong>
          <small>过去 30 天</small>
        </Panel>
        <Panel className="metric-card">
          <span className="metric-card__icon">
            <Activity />
          </span>
          <p>安装成功率</p>
          <strong>{successRate}%</strong>
          <small>{failed} 次失败</small>
        </Panel>
        <Panel className="metric-card">
          <span className="metric-card__icon">
            <Send />
          </span>
          <p>已发布</p>
          <strong>{funnel.published ?? 0}</strong>
          <small>{funnel.in_review ?? 0} 项审核中</small>
        </Panel>
        <Panel className="metric-card">
          <span className="metric-card__icon">
            <MonitorUp />
          </span>
          <p>活跃设备</p>
          <strong>{metrics?.activeDevices ?? 0}</strong>
          <small>已去标识聚合</small>
        </Panel>
      </div>
      <div className="dashboard-grid">
        <Panel>
          <div className="panel-title">
            <div>
              <p className="eyebrow">PUBLICATION FUNNEL</p>
              <h2>发布漏斗</h2>
            </div>
            <Status tone="neutral">30 DAYS</Status>
          </div>
          <div className="funnel">
            {['in_review', 'changes_requested', 'published', 'rejected'].map((key) => (
              <div key={key}>
                <span>{key}</span>
                <i style={{ width: `${Math.max(4, Math.min(100, (funnel[key] ?? 0) * 12))}%` }} />
                <b>{funnel[key] ?? 0}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <div className="panel-title">
            <div>
              <p className="eyebrow">EVENT COUNTS</p>
              <h2>关键事件</h2>
            </div>
          </div>
          <dl className="analytics-list">
            {Object.entries(metrics?.productEvents ?? {}).map(([name, count]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{count}</dd>
              </div>
            ))}
            {Object.keys(metrics?.productEvents ?? {}).length === 0 ? (
              <div>
                <dt>暂无事件</dt>
                <dd>0</dd>
              </div>
            ) : null}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
