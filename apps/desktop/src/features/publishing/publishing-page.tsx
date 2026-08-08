import type { PublicationSummary } from '@capaport/contracts';
import { Clock3, FileWarning, Send, ShieldCheck } from 'lucide-react';
import { EmptyState, PageHeader, Panel, Status } from '../../components/ui';

function publicationStatus(status: PublicationSummary['status']) {
  if (status === 'published') return { label: '已发布', tone: 'good' as const };
  if (status === 'in_review') return { label: '审核中', tone: 'warn' as const };
  if (status === 'changes_requested') return { label: '需修改', tone: 'danger' as const };
  if (status === 'rejected') return { label: '已拒绝', tone: 'danger' as const };
  return { label: '已撤回', tone: 'neutral' as const };
}

export function PublishingPage({ publications }: { publications: PublicationSummary[] }) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="GOVERNED PUBLISHING / 04"
        title="发布中心"
        description="从本地安全检查到组织审核，完整追踪每个候选版本。"
      />
      <div className="publishing-stages">
        <div>
          <ShieldCheck aria-hidden />
          <span>
            <strong>01 本地扫描</strong>
            <small>密钥与隐私阻断</small>
          </span>
        </div>
        <i />
        <div>
          <Send aria-hidden />
          <span>
            <strong>02 提交空间</strong>
            <small>生成不可变候选</small>
          </span>
        </div>
        <i />
        <div>
          <Clock3 aria-hidden />
          <span>
            <strong>03 审核决策</strong>
            <small>保留理由与记录</small>
          </span>
        </div>
        <i />
        <div>
          <ShieldCheck aria-hidden />
          <span>
            <strong>04 组织发布</strong>
            <small>可安装版本</small>
          </span>
        </div>
      </div>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SUBMISSIONS</p>
            <h2>提交与审核记录</h2>
          </div>
        </div>
        {publications.length ? (
          <div className="data-table publications-table">
            <div className="data-table__head">
              <span>能力包</span>
              <span>版本</span>
              <span>目标空间</span>
              <span>提交时间</span>
              <span>状态</span>
            </div>
            {publications.map((publication) => {
              const status = publicationStatus(publication.status);
              return (
                <div className="data-table__row" key={publication.id}>
                  <span>
                    <strong className="mono">{publication.capabilityId.slice(0, 8)}</strong>
                    <small>候选摘要 {publication.candidateDigest.slice(0, 10)}</small>
                  </span>
                  <span className="mono">v{publication.version}</span>
                  <span className="mono">{publication.targetSpaceId.slice(0, 8)}</span>
                  <span>{new Date(publication.createdAt).toLocaleString('zh-CN')}</span>
                  <span>
                    <Status tone={status.tone}>{status.label}</Status>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<FileWarning />}
            title="还没有发布记录"
            description="从首页执行本地发现，导入能力后即可创建候选版本。"
          />
        )}
      </Panel>
    </div>
  );
}
