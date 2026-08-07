import { AlertTriangle, KeyRound, Laptop, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary, WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel, Status } from '../../components/ui';

export function SecurityPage({ client }: { client: WebClient }) {
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [deadLetters, setDeadLetters] = useState<Array<Record<string, unknown>>>();
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [nextSessions, nextDeadLetters] = await Promise.all([client.sessions(), client.deadLetters()]);
      setSessions(nextSessions);
      setDeadLetters(nextDeadLetters);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '安全数据加载失败');
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="page">
      <PageHeader
        eyebrow="SECURITY POSTURE / 06"
        title="安全中心"
        description="查看登录会话、凭据边界与后台失败任务，不展示秘密值和本地路径。"
      />
      {error ? <ErrorNotice onRetry={() => void load()}>{error}</ErrorNotice> : null}
      <div className="security-summary">
        <Panel>
          <ShieldCheck />
          <span>
            <strong>本地敏感信息检测</strong>
            <small>高风险内容默认阻止上传</small>
          </span>
          <Status tone="good">启用</Status>
        </Panel>
        <Panel>
          <KeyRound />
          <span>
            <strong>旋转刷新令牌</strong>
            <small>重放会撤销令牌链</small>
          </span>
          <Status tone="good">启用</Status>
        </Panel>
        <Panel>
          <AlertTriangle />
          <span>
            <strong>失败任务</strong>
            <small>可重试通知与事件投递</small>
          </span>
          <Status tone={deadLetters?.length ? 'warn' : 'good'}>{deadLetters?.length ?? 0}</Status>
        </Panel>
      </div>
      <Panel>
        <div className="panel-title">
          <div>
            <p className="eyebrow">ACCOUNT SESSIONS</p>
            <h2>登录会话</h2>
          </div>
        </div>
        {!sessions ? (
          <LoadingBlock label="读取会话" />
        ) : sessions.length ? (
          <div className="session-list">
            {sessions.map((session) => (
              <article key={session.id}>
                <span className="section-icon">
                  <Laptop />
                </span>
                <div>
                  <strong>{session.deviceName || '浏览器会话'}</strong>
                  <small>最近活动 {new Date(session.lastSeenAt).toLocaleString()}</small>
                </div>
                {session.current ? (
                  <Status tone="good">当前会话</Status>
                ) : (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      await client.revokeSession(session.id);
                      await load();
                    }}
                  >
                    撤销
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无会话" description="没有可管理的登录会话。" />
        )}
      </Panel>
      <Panel>
        <div className="panel-title">
          <div>
            <p className="eyebrow">DEAD LETTER VISIBILITY</p>
            <h2>失败任务</h2>
          </div>
        </div>
        {deadLetters?.length ? (
          <pre className="safe-json">{JSON.stringify(deadLetters, null, 2)}</pre>
        ) : (
          <p className="quiet-copy">当前没有进入死信队列的通知或分析任务。</p>
        )}
      </Panel>
    </div>
  );
}
