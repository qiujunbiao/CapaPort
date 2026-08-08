import type {
  CapabilitySummary,
  PublicationCandidateDiff,
  PublicationSummary,
  SpaceSummary,
} from '@capaport/contracts';
import { Clock3, FileDiff, FileWarning, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

type ReviewContext = {
  details: PublicationSummary & { reviews?: Array<Record<string, unknown>> };
  scan: Record<string, unknown>;
  diff: PublicationCandidateDiff;
};

function publicationStatus(status: PublicationSummary['status']) {
  if (status === 'published') return { label: '已发布', tone: 'good' as const };
  if (status === 'in_review') return { label: '审核中', tone: 'warn' as const };
  if (status === 'changes_requested') return { label: '需修改', tone: 'danger' as const };
  if (status === 'rejected') return { label: '已拒绝', tone: 'danger' as const };
  return { label: '已撤回', tone: 'neutral' as const };
}

export function PublishingPage({
  publications,
  capabilities = [],
  spaces = [],
  canReview = false,
  online = false,
  loadReviewContext,
  onReview,
}: {
  publications: PublicationSummary[];
  capabilities?: CapabilitySummary[];
  spaces?: SpaceSummary[];
  canReview?: boolean;
  online?: boolean;
  loadReviewContext?: (publicationId: string) => Promise<ReviewContext>;
  onReview?: (
    publicationId: string,
    decision: 'approve' | 'request-changes' | 'reject',
    reason: string,
  ) => Promise<void>;
}) {
  const [status, setStatus] = useState<PublicationSummary['status'] | 'all'>('in_review');
  const [selected, setSelected] = useState<PublicationSummary>();
  const [context, setContext] = useState<ReviewContext>();
  const [reason, setReason] = useState('');
  const [loadingContext, setLoadingContext] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const capabilityNames = useMemo(() => new Map(capabilities.map((item) => [item.id, item.name])), [capabilities]);
  const spaceNames = useMemo(() => new Map(spaces.map((item) => [item.id, item.name])), [spaces]);
  const filtered = publications.filter((item) => status === 'all' || item.status === status);

  async function selectPublication(publication: PublicationSummary) {
    setSelected(publication);
    setContext(undefined);
    setReviewError('');
    if (!loadReviewContext) return;
    setLoadingContext(true);
    try {
      setContext(await loadReviewContext(publication.id));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '审核证据加载失败');
    } finally {
      setLoadingContext(false);
    }
  }

  async function review(decision: 'approve' | 'request-changes' | 'reject') {
    if (!selected || !context || !onReview || reason.trim().length < 3) return;
    setReviewing(true);
    setReviewError('');
    try {
      await onReview(selected.id, decision, reason.trim());
      setSelected(undefined);
      setContext(undefined);
      setReason('');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '审核操作失败');
    } finally {
      setReviewing(false);
    }
  }

  const decisionDisabled = !online || reviewing || !context || reason.trim().length < 3;

  return (
    <div className="page">
      <PageHeader
        eyebrow="GOVERNED PUBLISHING"
        title="发布中心"
        description="从本地安全检查到组织审核，完整追踪每个候选版本。"
      />
      <div className="publishing-stages">
        <div>
          <ShieldCheck aria-hidden />
          <span>
            <strong>本地扫描</strong>
            <small>密钥与隐私阻断</small>
          </span>
        </div>
        <i />
        <div>
          <Send aria-hidden />
          <span>
            <strong>提交空间</strong>
            <small>生成不可变候选</small>
          </span>
        </div>
        <i />
        <div>
          <Clock3 aria-hidden />
          <span>
            <strong>审核决策</strong>
            <small>保留理由与记录</small>
          </span>
        </div>
        <i />
        <div>
          <ShieldCheck aria-hidden />
          <span>
            <strong>组织发布</strong>
            <small>可安装版本</small>
          </span>
        </div>
      </div>
      <div className="desktop-review-layout">
        <Panel className="desktop-review-queue">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SUBMISSIONS</p>
              <h2>提交与审核记录</h2>
            </div>
          </div>
          <div className="scope-tabs" role="tablist" aria-label="审核状态">
            {(
              [
                ['in_review', '待审核'],
                ['changes_requested', '待修改'],
                ['published', '已发布'],
                ['rejected', '已拒绝'],
                ['all', '全部'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={status === value}
                key={value}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {filtered.length ? (
            <div className="review-publication-list">
              {filtered.map((publication) => {
                const state = publicationStatus(publication.status);
                const name = capabilityNames.get(publication.capabilityId) ?? publication.capabilityId.slice(0, 8);
                return (
                  <button
                    type="button"
                    className={selected?.id === publication.id ? 'is-selected' : ''}
                    key={publication.id}
                    onClick={() => void selectPublication(publication)}
                  >
                    <span>
                      <strong>{name}</strong>
                      <small>
                        v{publication.version} ·{' '}
                        {spaceNames.get(publication.targetSpaceId) ?? publication.targetSpaceId.slice(0, 8)}
                      </small>
                    </span>
                    <Status tone={state.tone}>{state.label}</Status>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<FileWarning />} title="没有匹配的发布记录" description="切换状态查看其他提交。" />
          )}
        </Panel>
        <Panel className="desktop-review-detail">
          {selected ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">FROZEN CANDIDATE</p>
                  <h2>
                    {capabilityNames.get(selected.capabilityId) ?? selected.capabilityId.slice(0, 8)} · v
                    {selected.version}
                  </h2>
                  <small className="mono">摘要 {selected.candidateDigest.slice(0, 20)}…</small>
                </div>
              </div>
              {reviewError ? <ErrorNotice>{reviewError}</ErrorNotice> : null}
              {loadingContext ? <p className="quiet-copy">正在读取安全扫描与版本差异…</p> : null}
              {context ? (
                <>
                  <div className="review-evidence">
                    <ShieldAlert aria-hidden />
                    <div>
                      <strong>安全扫描</strong>
                      <pre>{JSON.stringify(context.scan, null, 2)}</pre>
                    </div>
                  </div>
                  <div className="review-evidence">
                    <FileDiff aria-hidden />
                    <div>
                      <strong>候选差异 · {context.diff.recommendedChange}</strong>
                      <p>
                        新增 {context.diff.added.length} · 修改 {context.diff.modified.length} · 删除{' '}
                        {context.diff.removed.length}
                      </p>
                      <ul>
                        {context.diff.added.map((path) => (
                          <li key={`a-${path}`}>+ {path}</li>
                        ))}
                        {context.diff.modified.map((path) => (
                          <li key={`m-${path}`}>~ {path}</li>
                        ))}
                        {context.diff.removed.map((path) => (
                          <li key={`r-${path}`}>- {path}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {context.details.reviews?.length ? (
                    <div className="review-history">
                      <strong>审核历史</strong>
                      <pre>{JSON.stringify(context.details.reviews, null, 2)}</pre>
                    </div>
                  ) : null}
                </>
              ) : null}
              {selected.status === 'in_review' && canReview ? (
                <>
                  <label className="review-reason">
                    审核理由
                    <textarea
                      aria-label="审核理由"
                      rows={3}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <div className="review-actions">
                    <Button busy={reviewing} disabled={decisionDisabled} onClick={() => void review('approve')}>
                      通过审核
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={decisionDisabled}
                      onClick={() => void review('request-changes')}
                    >
                      要求修改
                    </Button>
                    <Button variant="danger" disabled={decisionDisabled} onClick={() => void review('reject')}>
                      拒绝
                    </Button>
                  </div>
                </>
              ) : selected.status === 'in_review' ? (
                <small>需要组织管理员审核</small>
              ) : (
                <Status tone="neutral">该申请已处理</Status>
              )}
            </>
          ) : (
            <EmptyState
              icon={<FileDiff />}
              title="选择一个提交"
              description="查看冻结摘要、安全扫描和版本差异后再作出审核决定。"
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
