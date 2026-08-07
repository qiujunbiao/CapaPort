import type { CapabilitySummary, PublicationSummary, SpaceSummary } from '@agentdoor/contracts';
import { ArrowUpRight, Box, Layers3, Send, Users } from 'lucide-react';
import type { AnalyticsMetrics, OrganizationMember } from '../../app/types';
import { PageHeader, Panel, Status } from '../../components/ui';

export function DashboardPage({
  capabilities,
  publications,
  spaces,
  members,
  metrics,
  onNavigate,
}: {
  capabilities: CapabilitySummary[];
  publications: PublicationSummary[];
  spaces: SpaceSummary[];
  members: OrganizationMember[];
  metrics: AnalyticsMetrics | undefined;
  onNavigate: (page: string) => void;
}) {
  const pending = publications.filter((item) => item.status === 'in_review');
  const cards = [
    { label: '能力资产', value: capabilities.length, icon: Box, detail: '可见能力包' },
    { label: '空间', value: spaces.length, icon: Layers3, detail: '个人 / 团队 / 项目 / 组织' },
    {
      label: '活跃成员',
      value: members.filter((item) => item.status === 'active').length,
      icon: Users,
      detail: '当前组织',
    },
    { label: '待审核', value: pending.length, icon: Send, detail: '需要组织处理' },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATION OVERVIEW / 01"
        title="组织仪表盘"
        description="查看能力沉淀、治理流转与复用健康度。"
      />
      <div className="metric-grid">
        {cards.map(({ label, value, icon: Icon, detail }) => (
          <Panel className="metric-card" key={label}>
            <span className="metric-card__icon">
              <Icon />
            </span>
            <p>{label}</p>
            <strong>{value.toString().padStart(2, '0')}</strong>
            <small>{detail}</small>
          </Panel>
        ))}
      </div>
      <div className="dashboard-grid">
        <Panel>
          <div className="panel-title">
            <div>
              <p className="eyebrow">REVIEW QUEUE</p>
              <h2>待处理审核</h2>
            </div>
            <button type="button" onClick={() => onNavigate('reviews')}>
              查看全部 <ArrowUpRight />
            </button>
          </div>
          {pending.length ? (
            <div className="compact-list">
              {pending.slice(0, 5).map((item) => (
                <button type="button" key={item.id} onClick={() => onNavigate('reviews')}>
                  <span>
                    <strong>版本 {item.version}</strong>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </span>
                  <Status tone="warn">审核中</Status>
                </button>
              ))}
            </div>
          ) : (
            <p className="quiet-copy">暂无待处理审核，组织发布队列保持清空。</p>
          )}
        </Panel>
        <Panel>
          <div className="panel-title">
            <div>
              <p className="eyebrow">ADOPTION / 30 DAYS</p>
              <h2>复用趋势</h2>
            </div>
            <Status tone="good">实时聚合</Status>
          </div>
          <div className="adoption-readout">
            <strong>{metrics?.installationOutcomes.installed ?? 0}</strong>
            <span>成功安装</span>
            <div>
              <b>{metrics?.activeDevices ?? 0}</b> 活跃设备 · <b>{metrics?.productEvents['capability.updated'] ?? 0}</b>{' '}
              次更新
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
