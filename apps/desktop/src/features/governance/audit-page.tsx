import type { AuditEntry } from '@capaport/contracts';
import { FileClock } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, PageHeader, Panel } from '../../components/ui';

const AUDIT_ACTION_GROUPS = [
  {
    label: '发布与版本',
    actions: [
      ['publication.submitted', '已提交发布审核'],
      ['publication.approve', '发布审核已通过'],
      ['publication.approved', '发布审核已通过（历史记录）'],
      ['publication.request_changes', '已要求修改发布内容'],
      ['publication.changes_requested', '已要求修改发布内容（历史记录）'],
      ['publication.reject', '发布审核已拒绝'],
      ['publication.rejected', '发布审核已拒绝（历史记录）'],
      ['publication.direct_published', '能力版本已直接发布'],
      ['publication.withdrawn', '发布申请已撤回'],
      ['capability.version.published', '能力版本已发布'],
      ['capability.version.deprecated', '能力版本已停用'],
      ['capability.version.withdrawn', '能力版本已下架'],
    ],
  },
  {
    label: '能力与制品',
    actions: [
      ['capability.created', '已创建能力'],
      ['capability.metadata_updated', '已更新能力信息'],
      ['capability.draft_created', '已创建能力草稿'],
      ['capability.draft_revision_created', '已保存能力草稿版本'],
      ['capability.download_authorized', '已授权下载能力版本'],
      ['capability.installed', '已安装能力'],
      ['artifact.upload_requested', '已申请上传能力文件'],
      ['artifact.upload_confirmed', '能力文件上传已确认'],
    ],
  },
  {
    label: '组织与成员',
    actions: [
      ['organization.created', '已创建组织'],
      ['organization.updated', '已更新组织信息'],
      ['organization.security_policy_updated', '已更新组织安全策略'],
      ['organization.invitation_created', '已创建组织邀请'],
      ['organization.invitation_accepted', '已接受组织邀请'],
      ['organization.invitation_revoked', '已撤销组织邀请'],
      ['organization.member_role_changed', '已调整组织成员角色'],
      ['organization.member_disabled', '已停用组织成员'],
      ['organization.member_left', '成员已退出组织'],
      ['organization.ownership_transferred', '已移交组织所有权'],
      ['organization.closure_requested', '已申请注销组织'],
      ['organization.closure_cancelled', '已取消注销组织'],
    ],
  },
  {
    label: '空间与项目',
    actions: [
      ['space.created', '已创建空间'],
      ['space.updated', '已更新空间'],
      ['space.archived', '已归档空间'],
      ['space.review_policy_changed', '已更新空间审核策略'],
      ['space.member_upserted', '已添加或更新空间成员'],
      ['space.member_role_changed', '已调整空间成员角色'],
      ['space.member_disabled', '已停用空间成员'],
      ['project.binding_created', '已关联项目'],
      ['project.binding_removed', '已解除项目关联'],
      ['project.context_synced', '已同步项目上下文'],
    ],
  },
  {
    label: '设备与账号',
    actions: [
      ['device.registered', '已登记设备'],
      ['device.updated', '已更新设备信息'],
      ['device.revoked', '已撤销设备授权'],
      ['account.deletion_requested', '已申请注销账号'],
      ['account.deletion_cancelled', '已取消注销账号'],
    ],
  },
] as const;

const AUDIT_ACTION_LABELS = new Map<string, string>(
  AUDIT_ACTION_GROUPS.flatMap((group) => group.actions.map(([value, label]) => [value, label])),
);

const AUDIT_RESOURCE_LABELS: Record<string, string> = {
  account: '账号',
  artifact: '能力文件',
  artifact_upload: '文件上传任务',
  capability: '能力',
  capability_draft: '能力草稿',
  capability_version: '能力版本',
  device: '设备',
  draft_revision: '草稿版本',
  invitation: '组织邀请',
  membership: '组织成员',
  organization: '组织',
  project: '项目',
  project_binding: '项目关联',
  publication: '发布申请',
  session: '登录会话',
  space: '空间',
};

function safeMetadata(metadata: Record<string, unknown>) {
  const blocked = /token|secret|password|content|absolute|path/i;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.test(key)));
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS.get(action) ?? '其他审计操作';
}

function auditResourceLabel(resourceType: string) {
  return AUDIT_RESOURCE_LABELS[resourceType] ?? '业务对象';
}

export function AuditPage({
  entries,
  onFilter,
  onLoadMore,
  hasMore,
}: {
  entries: AuditEntry[];
  onFilter: (action: string) => Promise<void> | void;
  onLoadMore: (action: string) => Promise<void> | void;
  hasMore: boolean;
}) {
  const [action, setAction] = useState('');
  return (
    <div className="page">
      <PageHeader
        eyebrow="IMMUTABLE AUDIT"
        title="审计日志"
        description="查看组织治理与能力生命周期的不可变操作证据。"
      />
      <Panel>
        <label className="audit-filter">
          审计动作
          <select
            aria-label="审计动作"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              void onFilter(event.target.value);
            }}
          >
            <option value="">全部动作</option>
            {AUDIT_ACTION_GROUPS.map((group) => (
              <optgroup label={group.label} key={group.label}>
                {group.actions.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {entries.length ? (
          <div className="audit-list">
            {entries.map((entry) => (
              <article className="governance-row audit-entry" key={entry.id}>
                <span className="audit-entry__summary">
                  <strong>{auditActionLabel(entry.action)}</strong>
                  <small>
                    {auditResourceLabel(entry.resourceType)} · {shortId(entry.resourceId)}
                  </small>
                </span>
                <span className="audit-entry__time">
                  <small>{entry.actorUserId ? `操作人 · ${shortId(entry.actorUserId)}` : '系统自动执行'}</small>
                  <time>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time>
                </span>
                <details className="audit-technical-details">
                  <summary>查看技术详情</summary>
                  <dl>
                    <div>
                      <dt>事件代码</dt>
                      <dd>{entry.action}</dd>
                    </div>
                    <div>
                      <dt>对象类型</dt>
                      <dd>{entry.resourceType}</dd>
                    </div>
                    <div>
                      <dt>对象 ID</dt>
                      <dd>{entry.resourceId}</dd>
                    </div>
                    {entry.actorUserId ? (
                      <div>
                        <dt>操作人 ID</dt>
                        <dd>{entry.actorUserId}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>附加信息</dt>
                      <dd>
                        <code className="audit-metadata">{JSON.stringify(safeMetadata(entry.metadata))}</code>
                      </dd>
                    </div>
                  </dl>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={<FileClock />} title="暂无审计事件" description="当前筛选条件下没有可显示的事件。" />
        )}
        {hasMore ? (
          <Button variant="secondary" onClick={() => void onLoadMore(action.trim())}>
            加载更多
          </Button>
        ) : null}
      </Panel>
    </div>
  );
}
