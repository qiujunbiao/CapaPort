import type { OrganizationSecurityPolicy } from '@capaport/contracts';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { SessionSummary } from '../../app/types';
import { Button, EmptyState, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';

type PublicationRisk = {
  publicationId: string;
  version: string;
  findings: Array<{
    ruleId?: string;
    path?: string;
    message?: string;
    severity?: string;
    blocking?: boolean;
  }>;
};

export function SecurityCenterPage({
  online,
  canManage,
  policy,
  sessions,
  deadLetters,
  publicationRisks,
  onSavePolicy,
  onRevokeSession,
  onRetryDeadLetter,
}: {
  online: boolean;
  canManage: boolean;
  policy: OrganizationSecurityPolicy;
  sessions: SessionSummary[];
  deadLetters: Array<Record<string, unknown>>;
  publicationRisks: PublicationRisk[];
  onSavePolicy: (policy: OrganizationSecurityPolicy) => Promise<void>;
  onRevokeSession: (sessionId: string) => Promise<void>;
  onRetryDeadLetter: (kind: 'operation' | 'outbox' | 'delivery', jobId: string) => Promise<void>;
}) {
  const [hosts, setHosts] = useState(policy.allowedNetworkHosts.join(', '));
  const [terms, setTerms] = useState(policy.blockedTerms.join(', '));
  const [paths, setPaths] = useState(policy.allowedExecutablePaths.join(', '));
  const [executablePolicy, setExecutablePolicy] = useState(policy.executablePolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '安全操作失败');
    } finally {
      setBusy(false);
    }
  }
  const list = (value: string) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return (
    <div className="page">
      <PageHeader eyebrow="SECURITY CONTROL" title="安全中心" description="管理发布策略、设备会话和失败任务恢复。" />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="governance-grid">
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ORGANIZATION POLICY</p>
              <h2>安全策略</h2>
            </div>
          </div>
          <div className="form-grid governance-form">
            <label>
              可执行文件策略
              <select
                aria-label="可执行文件策略"
                value={executablePolicy}
                disabled={!canManage}
                onChange={(event) =>
                  setExecutablePolicy(event.target.value as OrganizationSecurityPolicy['executablePolicy'])
                }
              >
                <option value="deny">全部阻止</option>
                <option value="confirm">要求确认</option>
                <option value="allow-listed">仅允许白名单</option>
              </select>
            </label>
            <label>
              允许的网络主机
              <input aria-label="允许的网络主机" value={hosts} onChange={(event) => setHosts(event.target.value)} />
            </label>
            <label>
              组织禁用词
              <input value={terms} onChange={(event) => setTerms(event.target.value)} />
            </label>
            <label>
              允许的可执行路径
              <input value={paths} onChange={(event) => setPaths(event.target.value)} />
            </label>
            <Button
              disabled={!online || !canManage || busy}
              onClick={() =>
                void run(() =>
                  onSavePolicy({
                    ...policy,
                    executablePolicy,
                    allowedNetworkHosts: list(hosts),
                    blockedTerms: list(terms),
                    allowedExecutablePaths: list(paths),
                  }),
                )
              }
            >
              保存安全策略
            </Button>
          </div>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SESSIONS</p>
              <h2>设备会话</h2>
            </div>
          </div>
          {sessions.length ? (
            <div className="governance-list">
              {sessions.map((item) => (
                <div className="governance-row" key={item.id}>
                  <span>
                    <strong>{item.deviceName}</strong>
                    <small>{item.current ? '当前会话' : item.lastSeenAt}</small>
                  </span>
                  <Button
                    variant="danger"
                    aria-label={`撤销会话 ${item.deviceName}`}
                    disabled={!online || item.current || busy}
                    onClick={() => void run(() => onRevokeSession(item.id))}
                  >
                    撤销
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ShieldCheck />} title="暂无设备会话" description="登录设备将在这里显示。" />
          )}
        </Panel>
      </div>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PUBLICATION RISK</p>
            <h2>发布风险报告</h2>
          </div>
          <Status tone={publicationRisks.length ? 'warn' : 'good'}>{publicationRisks.length} 个发布记录</Status>
        </div>
        {publicationRisks.length ? (
          <div className="governance-list">
            {publicationRisks.flatMap((risk) =>
              risk.findings.map((finding, index) => (
                <div className="governance-row" key={`${risk.publicationId}-${finding.ruleId ?? index}`}>
                  <span>
                    <strong>{finding.ruleId ?? 'UNKNOWN_RISK'}</strong>
                    <small>
                      {risk.version} · {finding.path ?? '未知路径'} · {finding.message ?? '未提供风险说明'}
                    </small>
                  </span>
                  <Status tone={finding.blocking ? 'danger' : 'warn'}>{finding.severity ?? 'unknown'}</Status>
                </div>
              )),
            )}
          </div>
        ) : (
          <EmptyState icon={<ShieldCheck />} title="暂无发布风险" description="当前发布记录没有扫描发现。" />
        )}
      </Panel>
      <Panel>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">OPERATION RECOVERY</p>
            <h2>失败任务</h2>
          </div>
          <Status tone={deadLetters.length ? 'warn' : 'good'}>{deadLetters.length} 项</Status>
        </div>
        {deadLetters.length ? (
          <div className="governance-list">
            {deadLetters.map((job, index) => {
              const id = String(job.id ?? job.jobId ?? index);
              const kind = String(job.kind ?? 'operation') as 'operation' | 'outbox' | 'delivery';
              return (
                <div className="governance-row" key={`${kind}-${id}`}>
                  <span>
                    <strong>{kind}</strong>
                    <small>
                      {id} · {String(job.status ?? 'dead_letter')}
                    </small>
                  </span>
                  <Button
                    aria-label={`重试任务 ${id}`}
                    disabled={!online || !canManage || busy}
                    onClick={() => void run(() => onRetryDeadLetter(kind, id))}
                  >
                    重试
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<ShieldCheck />} title="没有失败任务" description="当前没有需要人工恢复的任务。" />
        )}
      </Panel>
    </div>
  );
}
