import {
  compatibleAgentsForComponents,
  createEditablePackage,
  type EditableAgent,
  type EditableCapabilityPackage,
  exportEditablePackage,
  importEditablePackage,
  updatePackageMetadata,
  validateEditablePackage,
} from '@capaport/capability-kit';
import type {
  CapabilitySummary,
  OrganizationSecurityPolicy,
  PublicationSummary,
  SpaceSummary,
} from '@capaport/contracts';
import type { ScanReport } from '@capaport/security-scan';
import { FileClock, Save, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CloudClient, LocalPackageExport, Session } from '../../app/types';
import { Button, ErrorNotice, PageHeader, Panel, Status } from '../../components/ui';
import { scanArchiveBeforeUpload } from '../../security/client-scan';
import { PackageEditor } from './package-editor';

type SavedDraft = { capabilityId: string; draftId: string; digest: string; sequence: number; findings: string[] };

function archiveBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function localExport(slug: string, archive: Uint8Array, digest: string): LocalPackageExport {
  return {
    fileName: `${slug}.zip`,
    sizeBytes: archive.byteLength,
    sha256: digest,
    archiveBase64: archiveBase64(archive),
  };
}

export function AuthoringPage({
  cloud,
  session,
  organizationId,
  spaces,
  capabilities,
  publications,
  online,
  securityPolicy,
  onSubmitted,
}: {
  cloud: CloudClient;
  session: Session;
  organizationId: string;
  spaces: SpaceSummary[];
  capabilities: CapabilitySummary[];
  publications: PublicationSummary[];
  online: boolean;
  securityPolicy?: OrganizationSecurityPolicy;
  onSubmitted: () => void;
}) {
  const [editable, setEditable] = useState<EditableCapabilityPackage>(() =>
    createEditablePackage({ slug: '', name: '', description: '', tags: [], agents: ['codex'] }),
  );
  const personalSpace = spaces.find((space) => space.type === 'personal');
  const targetSpaces = spaces.filter((space) => space.type !== 'personal');
  const [sourceSpaceId, setSourceSpaceId] = useState(personalSpace?.id ?? spaces[0]?.id ?? '');
  const [targetSpaceId, setTargetSpaceId] = useState(
    spaces.find((space) => space.type === 'organization')?.id ?? targetSpaces[0]?.id ?? '',
  );
  const [version, setVersion] = useState('1.0.0');
  const [saved, setSaved] = useState<SavedDraft>();
  const [history, setHistory] = useState<Array<{ sequence: number; digest: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [riskReason, setRiskReason] = useState('');
  const [clientScan, setClientScan] = useState<ScanReport>();
  const errors = useMemo(() => validateEditablePackage(editable), [editable]);
  const compatibleAgents = useMemo(
    () => compatibleAgentsForComponents(editable.components.map((component) => component.type)),
    [editable.components],
  );
  const returnedPublications = publications.filter(
    (publication) => publication.status === 'changes_requested' && publication.sourceRevisionId,
  );

  async function resume(publication: PublicationSummary) {
    if (!publication.sourceRevisionId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const drafts = await cloud.capabilityDrafts(session, organizationId, publication.capabilityId);
      const draft = drafts.find((item) => item.currentRevisionId === publication.sourceRevisionId);
      if (!draft) throw new Error('退回草稿已被新修订替代，请刷新后重试');
      const revisions = await cloud.draftRevisions(session, organizationId, publication.capabilityId, draft.id);
      const current = revisions.find((item) => item.id === publication.sourceRevisionId);
      if (!current) throw new Error('未找到退回的草稿修订');
      const archive = await cloud.downloadDraftRevision(
        session,
        organizationId,
        publication.capabilityId,
        draft.id,
        current.id,
      );
      const nextEditable = importEditablePackage(archive);
      setEditable(nextEditable);
      setSourceSpaceId(publication.sourceSpaceId);
      setTargetSpaceId(publication.targetSpaceId);
      setVersion(publication.version);
      setSaved({
        capabilityId: publication.capabilityId,
        draftId: draft.id,
        digest: current.contentDigest,
        sequence: current.sequence,
        findings: current.riskFindingDigests,
      });
      setHistory(
        [...revisions]
          .sort((left, right) => left.sequence - right.sequence)
          .map((revision) => ({ sequence: revision.sequence, digest: revision.contentDigest })),
      );
      setMessage('已载入审核退回的草稿，可修改后再次提交');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '载入退回草稿失败');
    } finally {
      setBusy(false);
    }
  }

  async function persistRevision(): Promise<SavedDraft> {
    if (!sourceSpaceId) throw new Error('请选择草稿空间');
    const exported = await exportEditablePackage(editable);
    const report = await scanArchiveBeforeUpload(exported.archive, securityPolicy);
    setClientScan(report);
    if (report.blocked) throw new Error('本地安全扫描发现阻断风险，能力包未上传');
    if (report.requiresConfirmation && (!riskAccepted || riskReason.trim().length < 3)) {
      throw new Error('本地安全扫描发现需确认内容，请检查并填写确认理由后重试');
    }
    if (saved?.digest === exported.digest) return saved;
    const archive = localExport(editable.slug, exported.archive, exported.digest);
    if (!saved) {
      const created = await cloud.createCapabilityDraft({
        session,
        organizationId,
        spaceId: sourceSpaceId,
        slug: editable.slug,
        name: editable.name,
        description: editable.description,
        tags: editable.tags,
        agents: editable.agents,
        agent: editable.agents[0] ?? 'codex',
        archive,
      });
      const next = {
        capabilityId: created.capabilityId,
        draftId: created.draftId,
        digest: exported.digest,
        sequence: created.sequence ?? 1,
        findings: created.riskFindingDigests,
      };
      setSaved(next);
      setHistory([{ sequence: next.sequence, digest: next.digest }]);
      return next;
    }
    const revision = await cloud.saveCapabilityRevision({
      session,
      organizationId,
      spaceId: sourceSpaceId,
      capabilityId: saved.capabilityId,
      draftId: saved.draftId,
      archive,
    });
    if (revision.blocked) throw new Error('安全扫描发现阻断风险，修订未进入可提交状态');
    const next = {
      ...saved,
      digest: exported.digest,
      sequence: revision.sequence,
      findings: revision.riskFindingDigests,
    };
    setSaved(next);
    setHistory((current) => [...current, { sequence: next.sequence, digest: next.digest }]);
    return next;
  }

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const revision = await persistRevision();
      setMessage(`草稿修订 #${revision.sequence} 已保存`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存草稿失败');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!targetSpaceId) {
      setError('请选择发布目标空间');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let revision: SavedDraft;
      if (online) {
        revision = await persistRevision();
      } else {
        const exported = await exportEditablePackage(editable);
        const report = await scanArchiveBeforeUpload(exported.archive, securityPolicy);
        setClientScan(report);
        if (report.blocked) throw new Error('本地安全扫描发现阻断风险，能力包未上传');
        if (report.requiresConfirmation && (!riskAccepted || riskReason.trim().length < 3)) {
          throw new Error('本地安全扫描发现需确认内容，请检查并填写确认理由后重试');
        }
        if (!saved || saved.digest !== exported.digest) {
          throw new Error('离线时只能提交已保存且未修改的草稿，请联网保存当前修订');
        }
        revision = saved;
      }
      if (revision.findings.length && (!riskAccepted || riskReason.trim().length < 3)) {
        throw new Error('请确认可接受风险并填写确认理由');
      }
      const publication = await cloud.submitPublication({
        session,
        organizationId,
        capabilityId: revision.capabilityId,
        draftId: revision.draftId,
        targetSpaceId,
        version,
        ...(revision.findings.length
          ? { riskAcceptance: { findingDigests: revision.findings, reason: riskReason.trim() } }
          : {}),
      });
      void cloud
        .recordAnalyticsEvent(session, organizationId, {
          eventName: 'publication.started',
          capabilityId: revision.capabilityId,
          source: 'desktop',
          outcome: 'success',
        })
        .catch(() => undefined);
      setMessage(publication.queued ? '已加入离线队列，联网后自动提交' : '已提交到审核流程');
      onSubmitted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交审核失败');
    } finally {
      setBusy(false);
    }
  }

  function toggleAgent(agent: EditableAgent) {
    const agents = editable.agents.includes(agent)
      ? editable.agents.filter((item) => item !== agent)
      : [...editable.agents, agent];
    setEditable(updatePackageMetadata(editable, { agents }));
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="CAPABILITY AUTHORING / 03"
        title="能力创作"
        description="创建、编辑并版本化 Skill、Prompt 与项目上下文，经过本地检查后提交到受控空间。"
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {message ? <div className="success-notice">{message}</div> : null}
      {returnedPublications.length ? (
        <Panel className="returned-drafts">
          <div>
            <p className="eyebrow">CHANGES REQUESTED</p>
            <h2>待修改能力包</h2>
          </div>
          {returnedPublications.map((publication) => {
            const capability = capabilities.find((item) => item.id === publication.capabilityId);
            return (
              <Button key={publication.id} variant="secondary" busy={busy} onClick={() => void resume(publication)}>
                继续修改 {capability?.name ?? publication.capabilityId} · v{publication.version}
              </Button>
            );
          })}
        </Panel>
      ) : null}
      <div className="authoring-layout">
        <Panel className="authoring-form">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PACKAGE METADATA</p>
              <h2>能力包信息</h2>
            </div>
            <Status tone={errors.length ? 'warn' : 'good'}>
              {errors.length ? `${errors.length} 项待处理` : '可保存'}
            </Status>
          </div>
          <div className="form-grid">
            <label>
              能力标识
              <input
                aria-label="能力标识"
                value={editable.slug}
                onChange={(event) => setEditable(updatePackageMetadata(editable, { slug: event.target.value }))}
                placeholder="team-release"
              />
            </label>
            <label>
              能力名称
              <input
                aria-label="能力名称"
                value={editable.name}
                onChange={(event) => setEditable(updatePackageMetadata(editable, { name: event.target.value }))}
              />
            </label>
            <label className="form-grid__wide">
              描述
              <textarea
                value={editable.description}
                onChange={(event) => setEditable(updatePackageMetadata(editable, { description: event.target.value }))}
              />
            </label>
            <label>
              标签（逗号分隔）
              <input
                value={editable.tags.join(',')}
                onChange={(event) =>
                  setEditable(
                    updatePackageMetadata(editable, {
                      tags: event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    }),
                  )
                }
              />
            </label>
            <label>
              草稿空间
              <select value={sourceSpaceId} onChange={(event) => setSourceSpaceId(event.target.value)}>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="agent-checkboxes">
            <legend>兼容 Agent</legend>
            {(['codex', 'claude-code', 'cursor', 'gemini-cli'] as const).map((agent) => (
              <label key={agent}>
                <input
                  type="checkbox"
                  checked={editable.agents.includes(agent)}
                  disabled={!compatibleAgents.includes(agent)}
                  onChange={() => toggleAgent(agent)}
                />
                {agent}
              </label>
            ))}
          </fieldset>
          <PackageEditor editable={editable} onChange={setEditable} />
        </Panel>
        <aside className="authoring-sidebar">
          <Panel>
            <p className="eyebrow">PUBLISHING</p>
            <h2>保存与提交</h2>
            <label>
              目标空间
              <select value={targetSpaceId} onChange={(event) => setTargetSpaceId(event.target.value)}>
                {targetSpaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              版本号
              <input value={version} onChange={(event) => setVersion(event.target.value)} />
            </label>
            {clientScan?.findings.length ? (
              <div className={`scan-report ${clientScan.blocked ? 'scan-report--blocked' : ''}`}>
                <strong>
                  本地上传前检查 · {clientScan.blocked ? '已阻断' : clientScan.requiresConfirmation ? '需确认' : '通过'}
                </strong>
                <ul>
                  {clientScan.findings.map((finding) => (
                    <li key={`${finding.ruleId}-${finding.path}-${finding.line ?? 0}`}>
                      {finding.ruleId} · {finding.path}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {saved?.findings.length || clientScan?.requiresConfirmation ? (
              <div className="risk-acceptance">
                <label>
                  <input
                    type="checkbox"
                    checked={riskAccepted}
                    onChange={(event) => setRiskAccepted(event.target.checked)}
                  />
                  我已检查可确认风险
                </label>
                <textarea
                  value={riskReason}
                  onChange={(event) => setRiskReason(event.target.value)}
                  placeholder="确认理由"
                />
              </div>
            ) : null}
            {errors.length ? (
              <ul className="validation-list">
                {errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <div className="authoring-actions">
              <Button variant="secondary" disabled={!online || errors.length > 0} busy={busy} onClick={save}>
                <Save aria-hidden size={15} /> 保存草稿
              </Button>
              <Button disabled={errors.length > 0 || (!online && !saved)} busy={busy} onClick={submit}>
                <Send aria-hidden size={15} /> 提交审核
              </Button>
            </div>
          </Panel>
          <Panel>
            <p className="eyebrow">REVISION HISTORY</p>
            <h2>修订历史</h2>
            {history.length ? (
              <ol className="revision-list">
                {history.map((revision) => (
                  <li key={`${revision.sequence}-${revision.digest}`}>
                    <FileClock aria-hidden size={15} />
                    <span>
                      <strong>修订 #{revision.sequence}</strong>
                      <code>{revision.digest.slice(0, 12)}</code>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>保存后显示不可变修订记录。</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
