import type { OrganizationSecurityPolicy, PublicationSummary } from '@capaport/contracts';
import { AlertTriangle, KeyRound, Laptop, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary, WebClient } from '../../app/types';
import { Button, EmptyState, ErrorNotice, LoadingBlock, PageHeader, Panel, Status } from '../../components/ui';

type RiskFinding = { ruleId: string; severity: string; path: string; message: string; blocking: boolean };
type PublicationRisk = { publication: PublicationSummary; findings: RiskFinding[] };

function lines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function SecurityPage({
  client,
  organizationId,
  canManage,
}: {
  client: WebClient;
  organizationId: string;
  canManage: boolean;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const [deadLetters, setDeadLetters] = useState<Array<Record<string, unknown>>>();
  const [policy, setPolicy] = useState<OrganizationSecurityPolicy>();
  const [blockedTerms, setBlockedTerms] = useState('');
  const [allowedHosts, setAllowedHosts] = useState('');
  const [allowedPaths, setAllowedPaths] = useState('');
  const [risks, setRisks] = useState<PublicationRisk[]>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [nextSessions, nextDeadLetters, nextPolicy, publications] = await Promise.all([
        client.sessions(),
        client.deadLetters(),
        client.securityPolicy(organizationId),
        client.publications(),
      ]);
      const nextRisks = await Promise.all(
        publications.map(async (publication) => {
          const report = await client.scanReport(publication.id);
          const findings = Array.isArray(report.findings) ? (report.findings as RiskFinding[]) : [];
          return { publication, findings };
        }),
      );
      setSessions(nextSessions);
      setDeadLetters(nextDeadLetters);
      setPolicy(nextPolicy);
      setBlockedTerms(nextPolicy.blockedTerms.join('\n'));
      setAllowedHosts(nextPolicy.allowedNetworkHosts.join('\n'));
      setAllowedPaths(nextPolicy.allowedExecutablePaths.join('\n'));
      setRisks(nextRisks.filter((item) => item.findings.length));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '安全数据加载失败');
    }
  }, [client, organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function savePolicy() {
    if (!policy) return;
    setError('');
    setSaved(false);
    try {
      const updated = await client.updateSecurityPolicy(organizationId, {
        ...policy,
        blockedTerms: lines(blockedTerms),
        allowedNetworkHosts: lines(allowedHosts),
        allowedExecutablePaths: lines(allowedPaths),
      });
      setPolicy(updated);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '安全策略保存失败');
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="SECURITY POSTURE / 06"
        title="安全中心"
        description="治理组织扫描策略、发布风险、登录会话与后台失败任务。"
      />
      {error ? <ErrorNotice onRetry={() => void load()}>{error}</ErrorNotice> : null}
      {saved ? (
        <div role="status">
          <Status tone="good">安全策略已保存</Status>
        </div>
      ) : null}
      <div className="security-summary">
        <Panel>
          <ShieldCheck />
          <span>
            <strong>客户端与云端双重扫描</strong>
            <small>组织规则无法由客户端绕过</small>
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
            <p className="eyebrow">ORGANIZATION POLICY</p>
            <h2>组织扫描策略</h2>
          </div>
        </div>
        {!policy ? (
          <LoadingBlock label="读取扫描策略" />
        ) : (
          <div className="form-grid">
            <label>
              可执行文件策略
              <select
                value={policy.executablePolicy}
                disabled={!canManage}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    executablePolicy: event.target.value as OrganizationSecurityPolicy['executablePolicy'],
                  })
                }
              >
                <option value="deny">全部阻止</option>
                <option value="confirm">要求确认</option>
                <option value="allow-listed">仅允许白名单</option>
              </select>
            </label>
            <label>
              组织禁止词
              <textarea
                rows={4}
                value={blockedTerms}
                disabled={!canManage}
                onChange={(event) => setBlockedTerms(event.target.value)}
              />
            </label>
            <label>
              允许访问的网络主机
              <textarea
                rows={4}
                value={allowedHosts}
                disabled={!canManage}
                onChange={(event) => setAllowedHosts(event.target.value)}
              />
            </label>
            <label>
              允许的可执行文件路径
              <textarea
                rows={4}
                value={allowedPaths}
                disabled={!canManage}
                onChange={(event) => setAllowedPaths(event.target.value)}
              />
            </label>
            {canManage ? (
              <Button onClick={() => void savePolicy()}>保存安全策略</Button>
            ) : (
              <p className="quiet-copy">审计员拥有只读权限。</p>
            )}
          </div>
        )}
      </Panel>
      <Panel>
        <div className="panel-title">
          <div>
            <p className="eyebrow">PUBLICATION RISK</p>
            <h2>发布风险报告</h2>
          </div>
        </div>
        {!risks ? (
          <LoadingBlock label="读取发布风险" />
        ) : risks.length ? (
          <div className="session-list">
            {risks.flatMap(({ publication, findings }) =>
              findings.map((finding) => (
                <article
                  key={`${publication.id}:${finding.ruleId}:${finding.path}:${finding.severity}:${finding.message}`}
                >
                  <span>
                    <strong>{finding.ruleId}</strong>
                    <small>
                      {publication.version} · {finding.path} · {finding.message}
                    </small>
                  </span>
                  <Status tone={finding.blocking ? 'bad' : 'warn'}>{finding.severity}</Status>
                </article>
              )),
            )}
          </div>
        ) : (
          <EmptyState title="暂无发布风险" description="当前发布记录没有扫描发现。" />
        )}
      </Panel>
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
          <div className="session-list">
            {deadLetters.map((job) => {
              const kind = String(job.kind ?? 'operation') as 'operation' | 'outbox' | 'delivery';
              const id = String(job.id ?? '');
              return (
                <article key={`${kind}:${id}`}>
                  <span>
                    <strong>{String(job.type ?? job.event_type ?? job.channel ?? kind)}</strong>
                    <small>
                      {kind} · 尝试 {String(job.attempts ?? 0)} 次 ·{' '}
                      {String(job.last_error ?? job.error_code ?? '失败')}
                    </small>
                  </span>
                  <Button
                    onClick={async () => {
                      await client.retryDeadLetter(kind, id);
                      await load();
                    }}
                  >
                    重新执行
                  </Button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="quiet-copy">当前没有进入死信队列的通知或分析任务。</p>
        )}
      </Panel>
    </div>
  );
}
