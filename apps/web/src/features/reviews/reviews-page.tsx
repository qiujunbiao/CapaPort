import type {
  CapabilitySummary,
  PublicationCandidateDiff,
  PublicationSummary,
  SpaceSummary,
} from '@capaport/contracts';
import { CheckCircle2, FileDiff, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

export function ReviewsPage({
  client,
  publications,
  capabilities,
  spaces,
  onRefresh,
}: {
  client: WebClient;
  publications: PublicationSummary[];
  capabilities: CapabilitySummary[];
  spaces: SpaceSummary[];
  onRefresh: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState('in_review');
  const [selected, setSelected] = useState<PublicationSummary>();
  const [scan, setScan] = useState<Record<string, unknown>>();
  const [diff, setDiff] = useState<PublicationCandidateDiff>();
  const [reason, setReason] = useState('符合组织安全与复用规范');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filtered = publications.filter((item) => status === 'all' || item.status === status);
  const names = new Map(capabilities.map((item) => [item.id, item.name]));
  const spaceNames = new Map(spaces.map((item) => [item.id, item.name]));

  async function select(item: PublicationSummary) {
    setSelected(item);
    setScan(undefined);
    setDiff(undefined);
    setError('');
    try {
      const [nextScan, nextDiff] = await Promise.all([client.scanReport(item.id), client.publicationDiff(item.id)]);
      setScan(nextScan);
      setDiff(nextDiff);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '扫描报告加载失败');
    }
  }
  async function review(decision: 'approve' | 'request-changes' | 'reject') {
    if (!selected || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      await client.review(selected.id, decision, reason);
      setSelected(undefined);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审核操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="GOVERNED PUBLISHING / 03"
        title="审核中心"
        description="核对冻结候选摘要、安全扫描与版本信息后作出独立审核决定。"
      />
      <div className="review-layout">
        <Panel className="review-queue">
          <div className="filter-tabs" role="tablist" aria-label="审核状态">
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
            <div className="review-list">
              {filtered.map((item) => (
                <button
                  type="button"
                  className={selected?.id === item.id ? 'selected' : ''}
                  key={item.id}
                  onClick={() => void select(item)}
                >
                  <span>
                    <strong>{names.get(item.capabilityId) ?? '能力包'}</strong>
                    <small>
                      v{item.version} · {spaceNames.get(item.targetSpaceId) ?? '目标空间'}
                    </small>
                  </span>
                  <Status
                    tone={item.status === 'in_review' ? 'warn' : item.status === 'published' ? 'good' : 'neutral'}
                  >
                    {item.status}
                  </Status>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无待审核发布" description="新的组织空间发布申请会显示在这里。" />
          )}
        </Panel>
        <Panel className="review-detail">
          {selected ? (
            <>
              <div className="review-detail__head">
                <span className="package-icon">
                  <FileDiff />
                </span>
                <div>
                  <p className="eyebrow">FROZEN CANDIDATE</p>
                  <h2>
                    {names.get(selected.capabilityId) ?? '能力包'} · v{selected.version}
                  </h2>
                  <small>摘要 {selected.candidateDigest.slice(0, 20)}…</small>
                </div>
              </div>
              {error ? <ErrorNotice>{error}</ErrorNotice> : null}
              <div className="scan-summary">
                <ShieldAlert />
                <div>
                  <strong>安全扫描</strong>
                  <p>{scan ? JSON.stringify(scan) : '正在读取服务器扫描结果…'}</p>
                </div>
              </div>
              <div className="scan-summary">
                <FileDiff />
                <div>
                  <strong>候选差异 · {diff?.recommendedChange ?? '计算中'}</strong>
                  {diff ? (
                    <>
                      <p>
                        新增 {diff.added.length} · 修改 {diff.modified.length} · 删除 {diff.removed.length}
                      </p>
                      <ul>
                        {diff.added.map((path) => (
                          <li key={`a-${path}`}>+ {path}</li>
                        ))}
                        {diff.modified.map((path) => (
                          <li key={`m-${path}`}>~ {path}</li>
                        ))}
                        {diff.removed.map((path) => (
                          <li key={`r-${path}`}>- {path}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>正在计算与上一发布版的差异…</p>
                  )}
                </div>
              </div>
              <label className="review-reason">
                审核意见
                <textarea
                  aria-label="审核意见"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  maxLength={2000}
                />
              </label>
              {selected.status === 'in_review' ? (
                <div className="review-actions">
                  <Button busy={busy} onClick={() => void review('approve')}>
                    <CheckCircle2 />
                    批准发布
                  </Button>
                  <Button variant="secondary" busy={busy} onClick={() => void review('request-changes')}>
                    要求修改
                  </Button>
                  <Button variant="danger" busy={busy} onClick={() => void review('reject')}>
                    <XCircle />
                    拒绝
                  </Button>
                </div>
              ) : (
                <Status tone="neutral">该申请已处理</Status>
              )}
            </>
          ) : (
            <EmptyState title="选择一个审核项" description="右侧将展示冻结摘要、安全检查与审核操作。" />
          )}
        </Panel>
      </div>
    </div>
  );
}
