import { Activity } from 'lucide-react';
import type { AnalyticsMetrics } from '../../app/types';
import { EmptyState, Metric, PageHeader, Panel } from '../../components/ui';

export function AnalyticsPage({ metrics }: { metrics?: AnalyticsMetrics }) {
  if (!metrics)
    return (
      <div className="page">
        <PageHeader eyebrow="ADOPTION ANALYTICS" title="采用分析" description="查看组织能力的发布与安装采用趋势。" />
        <EmptyState icon={<Activity />} title="暂无分析数据" description="产生发布或安装事件后将在这里显示。" />
      </div>
    );
  const installed = metrics.installationOutcomes.installed ?? 0;
  const failed = metrics.installationOutcomes.failed ?? 0;
  const installationTotal = installed + failed;
  const installationSuccessRate = installationTotal ? Math.round((installed / installationTotal) * 100) : 0;
  return (
    <div className="page">
      <PageHeader
        eyebrow="ADOPTION ANALYTICS"
        title="采用分析"
        description={`${metrics.range.from} 至 ${metrics.range.to}`}
      />
      <div className="metric-strip">
        <Metric value={metrics.activeDevices} label="活跃设备" tone="green" />
        <Metric value={installed} label="成功安装" tone="orange" />
        <Metric value={metrics.publicationFunnel.published ?? 0} label="已发布" />
        <Metric value={`${installationSuccessRate}%`} label="安装成功率" />
      </div>
      <div className="governance-grid">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PUBLICATION FUNNEL</p>
              <h2>发布漏斗</h2>
            </div>
          </div>
          <pre>{JSON.stringify(metrics.publicationFunnel, null, 2)}</pre>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INSTALLATION OUTCOMES</p>
              <h2>安装结果</h2>
            </div>
          </div>
          <pre>{JSON.stringify(metrics.installationOutcomes, null, 2)}</pre>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PRODUCT EVENTS</p>
              <h2>关键事件</h2>
            </div>
          </div>
          {Object.keys(metrics.productEvents).length ? (
            <div className="governance-list">
              {Object.entries(metrics.productEvents).map(([name, count]) => (
                <div className="governance-row" key={name}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Activity />} title="暂无产品事件" description="客户端操作事件将在这里聚合显示。" />
          )}
        </Panel>
      </div>
    </div>
  );
}
