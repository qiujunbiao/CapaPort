import type { AuditEntry } from '@capaport/contracts';
import { ChevronRight, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel } from '../../components/ui';

function safeMetadata(metadata: Record<string, unknown>) {
  const blocked = /token|secret|password|content|absolute|path/i;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.test(key)));
}

export function AuditPage({ client }: { client: WebClient }) {
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(
    async (cursor?: string) => {
      setError('');
      try {
        const page = await client.audit({ ...(action ? { action } : {}), ...(cursor ? { cursor } : {}) });
        setEntries((current) => (cursor ? [...(current ?? []), ...page.entries] : page.entries));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '审计日志加载失败');
      }
    },
    [action, client],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="IMMUTABLE AUDIT / 07"
        title="审计日志"
        description="按组织隔离查询不可变操作记录；敏感元数据在服务端与界面双重脱敏。"
      />
      <Panel>
        <form
          className="filter-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label className="search">
            <Search />
            <span className="sr-only">按操作筛选</span>
            <input
              aria-label="按操作筛选"
              placeholder="例如 publication.approved"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary">
            筛选
          </Button>
        </form>
        {error ? <ErrorNotice onRetry={() => void load()}>{error}</ErrorNotice> : null}
        {!entries ? (
          <LoadingBlock label="加载不可变日志" />
        ) : entries.length ? (
          <div className="audit-table">
            <div className="audit-table__head">
              <span>时间</span>
              <span>操作</span>
              <span>资源</span>
              <span>操作者</span>
              <span>元数据</span>
            </div>
            {entries.map((entry) => (
              <div className="audit-table__row" key={entry.id}>
                <time>{new Date(entry.createdAt).toLocaleString()}</time>
                <strong>{entry.action}</strong>
                <span>
                  {entry.resourceType}
                  <small>{entry.resourceId.slice(0, 10)}…</small>
                </span>
                <span>{entry.actorUserId?.slice(0, 10) ?? 'system'}</span>
                <code>{JSON.stringify(safeMetadata(entry.metadata))}</code>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无审计记录" description="匹配条件内没有操作日志。" />
        )}
        {nextCursor ? (
          <Button className="load-more" variant="secondary" onClick={() => void load(nextCursor)}>
            加载更多 <ChevronRight />
          </Button>
        ) : null}
      </Panel>
    </div>
  );
}
