import { ArrowRight, Building2, MailCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { CloudClient, Session } from '../../app/types';
import { DoorMark } from '../../components/brand';
import { Button, ErrorNotice } from '../../components/ui';

export function OrganizationOnboarding({
  cloud,
  session,
  onReady,
}: {
  cloud: CloudClient;
  session: Session;
  onReady: (organizationId: string) => void;
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        if (!cloud.createOrganization) throw new Error('当前服务未启用组织创建');
        const organization = await cloud.createOrganization(session, { name, slug });
        onReady(organization.id);
      } else {
        if (!cloud.acceptInvitation) throw new Error('当前服务未启用邀请加入');
        const result = await cloud.acceptInvitation(session, token);
        if (result.status !== 'accepted' || !result.organizationId) throw new Error('邀请已失效或不匹配当前账号');
        onReady(result.organizationId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '组织设置失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-layout">
      <DoorMark />
      <section className="onboarding-card">
        <p className="eyebrow">ORGANIZATION SETUP</p>
        <h1>建立共享边界</h1>
        <p>创建新组织，或通过邀请加入已有组织。个人空间会自动创建。</p>
        <div className="onboarding-tabs">
          <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>
            <Building2 />
            创建组织
          </button>
          <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>
            <MailCheck />
            接受邀请
          </button>
        </div>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
        <form onSubmit={submit}>
          {mode === 'create' ? (
            <>
              <label>
                组织名称
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSlug(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, ''),
                    );
                  }}
                  required
                />
              </label>
              <label>
                组织标识
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  pattern="[a-z0-9][a-z0-9-]{1,62}"
                  required
                />
                <small>仅支持小写字母、数字和连字符</small>
              </label>
            </>
          ) : (
            <label>
              邀请令牌
              <input value={token} onChange={(event) => setToken(event.target.value)} required />
              <small>粘贴邀请邮件或短信中的令牌</small>
            </label>
          )}
          <Button type="submit" busy={busy}>
            {mode === 'create' ? '创建并进入' : '加入组织'}
            <ArrowRight size={16} />
          </Button>
        </form>
      </section>
    </main>
  );
}
