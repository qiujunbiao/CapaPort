import type { CapabilitySummary, PublicationSummary, SpaceSummary } from '@capaport/contracts';
import { Box, Layers3, Send, Users } from 'lucide-react';
import type { AnalyticsMetrics, OrganizationMember } from '../../app/types';
import { Button, Metric, PageHeader, Panel, Status } from '../../components/ui';

export function OrganizationOverviewPage({
  capabilities,
  publications,
  spaces,
  members,
  metrics,
  canManage = false,
  onNavigate,
}: {
  capabilities: CapabilitySummary[];
  publications: PublicationSummary[];
  spaces: SpaceSummary[];
  members: OrganizationMember[];
  metrics?: AnalyticsMetrics;
  canManage?: boolean;
  onNavigate: (page: string) => void;
}) {
  const published = capabilities.filter((item) => item.hasPublishedVersion).length;
  const pendingPublications = publications.filter((item) => item.status === 'in_review');
  const pending = pendingPublications.length;
  return (
    <div className="page">
      <PageHeader
        eyebrow="ORGANIZATION OVERVIEW"
        title="组织概览"
        description="统一查看组织能力资产、治理队列与采用情况。"
      />
      <div className="metric-strip">
        <Metric value={capabilities.length} label="能力资产" tone="orange" />
        <Metric value={published} label="已发布能力" tone="green" />
        <Metric value={pending} label="待审核" />
        <Metric value={members.filter((item) => item.status === 'active').length} label="活跃成员" />
      </div>
      <div className="governance-grid">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">GOVERNANCE QUEUE</p>
              <h2>组织治理</h2>
            </div>
          </div>
          {canManage && pendingPublications.length ? (
            <div className="governance-list overview-review-list">
              {pendingPublications.slice(0, 5).map((publication) => (
                <button type="button" key={publication.id} onClick={() => onNavigate('reviews')}>
                  <span>
                    <strong>版本 {publication.version}</strong>
                    <small>{new Date(publication.createdAt).toLocaleString('zh-CN')}</small>
                  </span>
                  <Status tone="warn">审核中</Status>
                </button>
              ))}
            </div>
          ) : null}
          <div className="action-list">
            {canManage ? (
              <Button variant="secondary" onClick={() => onNavigate('reviews')}>
                <Send aria-hidden />
                处理 {pending} 项审核
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => onNavigate('assets')}>
              <Box aria-hidden />
              管理 {capabilities.length} 项资产
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => onNavigate('spaces-admin')}>
                  <Layers3 aria-hidden />
                  维护 {spaces.length} 个空间
                </Button>
                <Button variant="secondary" onClick={() => onNavigate('members')}>
                  <Users aria-hidden />
                  管理组织成员
                </Button>
              </>
            ) : null}
          </div>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ADOPTION</p>
              <h2>采用情况</h2>
            </div>
            <Status tone="good">实时</Status>
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
