import type { AgentId, CapabilitySummary, UpdateCheck } from '@agentdoor/contracts';
import { AlertTriangle, Check, FileDiff, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildLocalInstallPlan, selectInstallVersion } from '../../app/install-plan';
import type { CloudClient, LocalClient, Session } from '../../app/types';
import { Button, ErrorNotice, Status } from '../../components/ui';
import type { AgentDescriptor, ApplyResult, InstallPlan, InstallPreview } from '../../generated/commands';
import { type ConflictDiffLine, componentTypeForPath, createConflictDiff } from './conflict-resolution';

type Choice = 'keep' | 'overwrite';
type InstallMetadata = { deviceId: string; versionId: string; agent: AgentId };

function decodeBase64Text(value: string): string {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function testPlan(capability: CapabilitySummary, agent: AgentDescriptor): InstallPlan {
  const bytes = new TextEncoder().encode('# managed by Agentdoor');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    transactionId: crypto.randomUUID(),
    adapterId: agent.adapterId,
    capabilitySlug: capability.slug,
    packageDigest: '0'.repeat(64),
    rootPath: agent.rootPath,
    writes: [
      {
        relativePath: 'rules/security.md',
        contentBase64: btoa(binary),
        contentDigest: '0'.repeat(64),
        expectedDigest: '0'.repeat(64),
      },
    ],
  };
}

export function InstallModal({
  capability,
  cloud,
  local,
  session,
  organizationId,
  agents,
  online,
  updateCheck,
  personalSpaceId,
  onClose,
  onInstalled,
}: {
  capability: CapabilitySummary;
  cloud: CloudClient;
  local: LocalClient;
  session: Session;
  organizationId: string;
  agents: AgentDescriptor[];
  online: boolean;
  updateCheck?: UpdateCheck;
  personalSpaceId?: string;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const compatible = useMemo(
    () => agents.filter((agent) => capability.compatibility.includes(agent.adapterId as AgentId)),
    [agents, capability],
  );
  const [agent, setAgent] = useState(compatible[0]);
  const [plan, setPlan] = useState<InstallPlan>();
  const [preview, setPreview] = useState<InstallPreview>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [installMetadata, setInstallMetadata] = useState<InstallMetadata>();
  const [installationApplied, setInstallationApplied] = useState(false);
  const [installationReported, setInstallationReported] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult>();
  const [restored, setRestored] = useState(false);
  const [diffs, setDiffs] = useState<Record<string, ConflictDiffLine[]>>({});
  const [draftMessage, setDraftMessage] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!agent) {
      setBusy(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      setPreview(undefined);
      setChoices({});
      setInstallMetadata(undefined);
      setInstallationApplied(false);
      setInstallationReported(false);
      setApplyResult(undefined);
      setRestored(false);
      setDiffs({});
      setDraftMessage('');
      try {
        let localPlan: InstallPlan;
        if (cloud.versions && cloud.devices && cloud.registerDevice) {
          const [versions, devices] = await Promise.all([
            cloud.versions(session, organizationId, capability.id),
            cloud.devices(session, organizationId),
          ]);
          const version = selectInstallVersion(
            versions,
            updateCheck?.action === 'update' ? updateCheck.availableVersionId : undefined,
          );
          if (!version) throw new Error('该能力还没有可安装版本');
          const device =
            devices.find((item) => item.status === 'active') ??
            (await cloud.registerDevice(
              session,
              organizationId,
              agents.map((item) => item.adapterId as AgentId),
            ));
          const cloudPlan = await cloud.createInstallPlan({
            session,
            organizationId,
            deviceId: device.id,
            capabilityId: capability.id,
            versionId: version.id,
            agent: agent.adapterId as AgentId,
          });
          const response = await fetch(cloudPlan.download.url);
          if (!response.ok) throw new Error('能力包下载失败');
          const installLock = await local.loadInstallLock({
            adapterId: agent.adapterId,
            capabilitySlug: capability.slug,
            rootPath: agent.rootPath,
          });
          localPlan = await buildLocalInstallPlan({
            archive: new Uint8Array(await response.arrayBuffer()),
            adapterId: agent.adapterId,
            rootPath: agent.rootPath,
            packageDigest: cloudPlan.digest,
            ...(installLock ? { installedFiles: installLock.files } : {}),
          });
          if (!cancelled)
            setInstallMetadata({ deviceId: device.id, versionId: version.id, agent: agent.adapterId as AgentId });
        } else {
          localPlan = testPlan(capability, agent);
        }
        const nextPreview = await local.previewInstall(localPlan);
        if (!cancelled) {
          setPlan(localPlan);
          setPreview(nextPreview);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '无法生成安装预览');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, agents, capability, cloud, local, organizationId, session, updateCheck]);

  const conflicts = preview?.changes.filter((change) => change.kind === 'conflict') ?? [];
  const resolved = conflicts.every((change) => choices[change.relativePath]);

  async function install() {
    if (!plan || !preview || !resolved) return;
    setBusy(true);
    setError('');
    let appliedLocally = installationApplied;
    if (installationApplied && installMetadata) {
      try {
        await cloud.reportInstallation({
          session,
          organizationId,
          capabilityId: capability.id,
          ...installMetadata,
          outcome: 'installed',
        });
        setInstallationReported(true);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '云端状态上报失败，请稍后重试');
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const writes = plan.writes
        .filter((write) => choices[write.relativePath] !== 'keep')
        .map((write) => {
          if (choices[write.relativePath] !== 'overwrite') return write;
          const { expectedDigest: _expectedDigest, ...overwrite } = write;
          return overwrite;
        });
      const result = await local.applyInstall({ ...plan, writes });
      appliedLocally = true;
      setInstallationApplied(true);
      setApplyResult(result);
      if (installMetadata) {
        await cloud.reportInstallation({
          session,
          organizationId,
          capabilityId: capability.id,
          ...installMetadata,
          outcome: 'installed',
        });
      }
      setInstallationReported(true);
    } catch (caught) {
      if (!appliedLocally && installMetadata) {
        await cloud
          .reportInstallation({
            session,
            organizationId,
            capabilityId: capability.id,
            ...installMetadata,
            outcome: 'failed',
            failureCode: 'local_apply_failed',
          })
          .catch(() => undefined);
      }
      setError(
        appliedLocally
          ? '本地安装已完成，但云端状态上报失败，请重试上报'
          : caught instanceof Error
            ? caught.message
            : '安装失败，已自动恢复',
      );
    } finally {
      setBusy(false);
    }
  }

  async function showDiff(relativePath: string) {
    if (!plan) return;
    const write = plan.writes.find((item) => item.relativePath === relativePath);
    if (!write) return;
    setBusy(true);
    setError('');
    try {
      const localFile = await local.readManagedFile({ rootPath: plan.rootPath, relativePath });
      setDiffs((current) => ({
        ...current,
        [relativePath]: createConflictDiff(
          decodeBase64Text(localFile.contentBase64),
          decodeBase64Text(write.contentBase64),
        ),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取本地文件差异');
    } finally {
      setBusy(false);
    }
  }

  async function importLocalDraft(relativePath: string) {
    if (!agent || !personalSpaceId || !local.exportLocalPackage) {
      setError('需要个人空间才能保存本地草稿');
      return;
    }
    const componentType = componentTypeForPath(relativePath);
    if (!componentType) {
      setError('该文件类型暂不支持导入草稿');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const archive = await local.exportLocalPackage({
        adapterId: agent.adapterId,
        rootPath: agent.rootPath,
        componentType,
        slug: capability.slug,
      });
      await cloud.createCapabilityDraft({
        session,
        organizationId,
        spaceId: personalSpaceId,
        slug: capability.slug,
        agent: agent.adapterId as AgentId,
        archive,
      });
      setDraftMessage('本地版本已保存为个人草稿');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '本地版本导入草稿失败');
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!applyResult) return;
    setBusy(true);
    setError('');
    try {
      await local.rollbackInstall(applyResult.transactionId);
      if (installMetadata) {
        await cloud.reportInstallation({
          session,
          organizationId,
          capabilityId: capability.id,
          ...installMetadata,
          outcome: 'uninstalled',
        });
      }
      setRestored(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '自动恢复失败，请从备份位置手动恢复');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        className="modal modal--wide install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
      >
        <header className="modal-bar">
          <div>
            <p className="eyebrow">SIGNED INSTALL PLAN</p>
            <h2 id="install-title">安装 / 更新预览</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </header>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
        {draftMessage ? <div className="success-notice">{draftMessage}</div> : null}
        {applyResult && installationReported ? (
          <div className="install-result" role="status">
            <Check aria-hidden />
            <div>
              <strong>{restored ? '已恢复到更新前版本' : '本地更新已完成'}</strong>
              <small>
                事务 {applyResult.transactionId} · {applyResult.changedFiles} 个文件
              </small>
            </div>
          </div>
        ) : null}
        <div className="install-package">
          <span className="package-mark">
            <FileDiff />
          </span>
          <div>
            <strong>{capability.name}</strong>
            <small>agentdoor/{capability.slug}</small>
          </div>
          <Status tone="good">签名下载</Status>
        </div>
        <fieldset className="agent-choices">
          <legend>目标 Agent</legend>
          {compatible.map((item) => (
            <label key={`${item.adapterId}-${item.rootPath}`}>
              <input
                type="radio"
                name="agent"
                checked={agent?.rootPath === item.rootPath}
                onChange={() => setAgent(item)}
              />
              {item.displayName}
              <small>{item.scope === 'user' ? '用户级' : '项目级'}</small>
            </label>
          ))}
        </fieldset>
        {!compatible.length ? (
          <div className="warning-block">
            <AlertTriangle />
            <span>
              <strong>没有兼容的本地 Agent</strong>
              <small>请先安装并配置该能力支持的 Agent。</small>
            </span>
          </div>
        ) : null}
        {busy && !preview ? (
          <div className="scan-running">
            <RotateCcw className="spin" />
            <strong>生成逐文件预览</strong>
            <span>正在验证制品摘要与目标路径</span>
          </div>
        ) : preview ? (
          <div className="file-preview">
            <div className="file-preview__head">
              <span>将变更的文件 ({preview.changes.length})</span>
              <Status tone={preview.conflicts ? 'warn' : 'good'}>
                {preview.conflicts ? `${preview.conflicts} 个冲突` : '无冲突'}
              </Status>
            </div>
            {preview.changes.map((change) => (
              <div className={`file-change file-change--${change.kind}`} key={change.relativePath}>
                <span className="change-symbol">
                  {change.kind === 'create' ? '+' : change.kind === 'conflict' ? '!' : '~'}
                </span>
                <strong>{change.relativePath}</strong>
                <Status tone={change.kind === 'conflict' ? 'warn' : 'good'}>
                  {change.kind === 'conflict' ? '本地已修改' : change.kind === 'create' ? '新增' : '更新'}
                </Status>
                {change.kind === 'conflict' ? (
                  <div className="conflict-resolution">
                    <div className="conflict-tools">
                      <button type="button" onClick={() => void showDiff(change.relativePath)}>
                        查看差异
                      </button>
                      <button type="button" onClick={() => void importLocalDraft(change.relativePath)}>
                        导入本地为草稿
                      </button>
                    </div>
                    {diffs[change.relativePath] ? (
                      <ol className="conflict-diff" aria-label={`${change.relativePath} 差异`}>
                        {diffs[change.relativePath]?.map((line) => (
                          <li
                            className={`conflict-diff__${line.kind}`}
                            key={`${line.kind}-${line.oldLine ?? 'x'}-${line.newLine ?? 'x'}-${line.content}`}
                          >
                            <span>{line.oldLine ?? ''}</span>
                            <span>{line.newLine ?? ''}</span>
                            <code>
                              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '} {line.content}
                            </code>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="conflict-choices">
                      <label>
                        <input
                          type="radio"
                          name={`choice-${change.relativePath}`}
                          aria-label="保留本地版本"
                          checked={choices[change.relativePath] === 'keep'}
                          onChange={() => setChoices((current) => ({ ...current, [change.relativePath]: 'keep' }))}
                        />
                        保留本地
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`choice-${change.relativePath}`}
                          aria-label="使用组织版本"
                          checked={choices[change.relativePath] === 'overwrite'}
                          onChange={() => setChoices((current) => ({ ...current, [change.relativePath]: 'overwrite' }))}
                        />
                        使用组织版本
                      </label>
                    </div>
                  </div>
                ) : (
                  <Check aria-hidden />
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div className="install-assurances">
          <span>
            <Check />
            安装前创建备份
          </span>
          <span>
            <Check />
            写入失败自动回滚
          </span>
          <span>
            <Check />
            不修改业务源码
          </span>
        </div>
        <div className="modal__actions">
          {applyResult && installationReported ? (
            <>
              <Button variant="secondary" disabled={restored} busy={busy} onClick={restore}>
                <Undo2 aria-hidden size={15} />
                恢复更新前版本
              </Button>
              <Button onClick={onInstalled}>完成</Button>
            </>
          ) : (
            <>
              <Button variant="quiet" onClick={onClose}>
                取消
              </Button>
              <Button
                disabled={!online || !plan || !preview || !resolved || !compatible.length}
                busy={busy}
                onClick={install}
              >
                {installationApplied ? '重试上报' : '确认安装'}
              </Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
