import type { AgentId, SpaceSummary } from '@agentdoor/contracts';
import { ArrowLeft, CheckCircle2, FileSearch, LoaderCircle, Radar, ShieldAlert, UploadCloud, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CloudClient, LocalClient, Session } from '../../app/types';
import { Button, ErrorNotice, Status } from '../../components/ui';
import type { AgentDescriptor, LocalCapabilitySummary, LocalScanReport } from '../../generated/commands';

type Selected = { agent: AgentDescriptor; capability: LocalCapabilitySummary };

export function DiscoveryModal({
  cloud,
  local,
  session,
  organizationId,
  spaces,
  onClose,
  onPublished,
}: {
  cloud: CloudClient;
  local: LocalClient;
  session: Session;
  organizationId: string;
  spaces: SpaceSummary[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [inventory, setInventory] = useState<Selected[]>([]);
  const [selected, setSelected] = useState<Selected>();
  const [scan, setScan] = useState<LocalScanReport>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [targetSpaceId, setTargetSpaceId] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [pendingDraft, setPendingDraft] = useState<{
    capabilityId: string;
    draftId: string;
    riskFindingDigests: string[];
  }>();
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [riskReason, setRiskReason] = useState('');
  const availableSpaces = useMemo(() => spaces.filter((space) => space.status === 'active'), [spaces]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detected = await local.detectAgents();
        const discovered = (
          await Promise.all(
            detected.map(async (agent) =>
              (
                await local.inventoryAgent({ adapterId: agent.adapterId, rootPath: agent.rootPath })
              ).map((capability) => ({ agent, capability })),
            ),
          )
        ).flat();
        if (!cancelled) {
          setAgents(detected);
          setInventory(discovered);
          setSpaceId(availableSpaces[0]?.id ?? '');
          setTargetSpaceId(
            availableSpaces.find((space) => space.type === 'organization')?.id ?? availableSpaces[0]?.id ?? '',
          );
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '本地发现失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [availableSpaces, local]);

  async function select(item: Selected) {
    setSelected(item);
    setScan(undefined);
    setError('');
    setBusy(true);
    try {
      const root = item.agent.rootPath.replace(/[\\/]$/, '');
      setScan(await local.scanLocalPackage(`${root}/${item.capability.relativePath}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '安全扫描失败');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!selected || !local.exportLocalPackage || !spaceId || !targetSpaceId || scan?.blocked) return;
    setBusy(true);
    setError('');
    try {
      const archive = await local.exportLocalPackage({
        adapterId: selected.agent.adapterId,
        rootPath: selected.agent.rootPath,
        componentType: selected.capability.componentType,
        slug: selected.capability.slug,
      });
      const draft =
        pendingDraft ??
        (await cloud.createCapabilityDraft({
          session,
          organizationId,
          spaceId,
          slug: selected.capability.slug,
          agent: selected.agent.adapterId as AgentId,
          archive,
        }));
      if (draft.riskFindingDigests.length && (!riskAccepted || riskReason.trim().length < 3)) {
        setPendingDraft(draft);
        return;
      }
      await cloud.submitPublication({
        session,
        organizationId,
        capabilityId: draft.capabilityId,
        draftId: draft.draftId,
        targetSpaceId,
        version,
        ...(draft.riskFindingDigests.length
          ? { riskAcceptance: { findingDigests: draft.riskFindingDigests, reason: riskReason.trim() } }
          : {}),
      });
      onPublished();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建草稿失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop discovery-backdrop">
      <section className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="discover-title">
        <header className="modal-bar">
          <div>
            <p className="eyebrow">LOCAL DISCOVERY</p>
            <h2 id="discover-title">{selected ? '导入与安全检查' : '发现本地能力'}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </header>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
        {selected ? (
          <div className="import-layout">
            <button
              type="button"
              className="back-link"
              onClick={() => {
                setSelected(undefined);
                setScan(undefined);
              }}
            >
              <ArrowLeft aria-hidden />
              返回发现结果
            </button>
            <div className="import-summary">
              <span className="package-mark">
                <FileSearch />
              </span>
              <div>
                <strong>{selected.capability.slug}</strong>
                <p>
                  {selected.agent.displayName} · {selected.capability.componentType}
                </p>
                <small className="mono">DIGEST {selected.capability.digest.slice(0, 16)}</small>
              </div>
            </div>
            {busy && !scan ? (
              <div className="scan-running">
                <LoaderCircle className="spin" />
                <strong>正在本地扫描</strong>
                <span>内容不会离开设备</span>
              </div>
            ) : scan ? (
              <div className={`scan-report ${scan.blocked ? 'scan-report--blocked' : ''}`}>
                <div className="scan-report__title">
                  {scan.blocked ? <ShieldAlert /> : <CheckCircle2 />}
                  <span>
                    <strong>{scan.blocked ? '发现高风险内容，已阻止上传' : '安全检查通过'}</strong>
                    <small>
                      {scan.files} 个文件 · {scan.bytes} 字节 · {scan.findings.length} 个发现项
                    </small>
                  </span>
                  <Status tone={scan.blocked ? 'danger' : 'good'}>{scan.blocked ? '阻断' : '可发布'}</Status>
                </div>
                {scan.findings.map((finding) => (
                  <div className="finding-row" key={`${finding.rule}-${finding.relativePath}`}>
                    <Status tone="danger">高风险</Status>
                    <strong>{finding.rule}</strong>
                    <span>{finding.relativePath}</span>
                    <small>内容已脱敏</small>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="import-fields">
              <label>
                保存到空间
                <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
                  {availableSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name} · {space.type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                发布到空间
                <select value={targetSpaceId} onChange={(event) => setTargetSpaceId(event.target.value)}>
                  {availableSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name} · {space.reviewPolicy === 'required' ? '需审核' : '直接发布'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                候选版本
                <input value={version} onChange={(event) => setVersion(event.target.value)} />
              </label>
              {pendingDraft?.riskFindingDigests.length ? (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={riskAccepted}
                      onChange={(event) => setRiskAccepted(event.target.checked)}
                    />
                    我已确认 {pendingDraft.riskFindingDigests.length} 项可确认风险
                  </label>
                  <label>
                    确认原因
                    <textarea
                      aria-label="风险确认原因"
                      value={riskReason}
                      onChange={(event) => setRiskReason(event.target.value)}
                      rows={3}
                      required
                    />
                  </label>
                </>
              ) : null}
            </div>
            <div className="modal__actions">
              <Button variant="quiet" onClick={onClose}>
                稍后处理
              </Button>
              <Button
                busy={busy}
                disabled={
                  !scan ||
                  scan.blocked ||
                  !spaceId ||
                  !targetSpaceId ||
                  !local.exportLocalPackage ||
                  Boolean(pendingDraft?.riskFindingDigests.length && (!riskAccepted || riskReason.trim().length < 3))
                }
                onClick={publish}
              >
                <UploadCloud size={16} />
                创建云端草稿
              </Button>
            </div>
          </div>
        ) : (
          <div className="discovery-results">
            <div className="discovery-summary">
              <span>
                <Radar />
                <strong>
                  {loading ? '正在检测本地 Agent' : `发现 ${agents.length} 个 Agent，${inventory.length} 项能力`}
                </strong>
              </span>
              <small>只读取 Codex、Claude Code、Cursor 与 Gemini CLI 的已知能力目录。</small>
            </div>
            {loading ? (
              <div className="skeleton-lines">
                <i />
                <i />
                <i />
              </div>
            ) : inventory.length ? (
              <div className="inventory-list">
                {inventory.map((item) => (
                  <div className="inventory-row" key={`${item.agent.rootPath}-${item.capability.relativePath}`}>
                    <span className="inventory-type">{item.capability.componentType.toUpperCase()}</span>
                    <div>
                      <strong>{item.capability.slug}</strong>
                      <small>
                        {item.agent.displayName} · {item.agent.scope === 'user' ? '用户级' : '项目级'}
                      </small>
                    </div>
                    <span className="mono">{item.capability.digest.slice(0, 10)}</span>
                    <Button
                      variant="secondary"
                      aria-label={`导入 ${item.capability.slug}`}
                      onClick={() => select(item)}
                    >
                      导入
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="scan-running">
                <Radar />
                <strong>没有发现本地能力</strong>
                <span>确认对应 Agent 的能力目录存在后重试。</span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
