import { ArrowRight, DoorOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { WebClient, WebSessionStore } from '../../app/types';
import { Button, ErrorNotice } from '../../components/ui';

export function AuthPage({ client, sessionStore }: { client: WebClient; sessionStore: WebSessionStore }) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const kind = target.includes('@') ? 'email' : 'phone';

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        const challenge = await client.register({ kind, target, password, displayName });
        setChallengeId(challenge.challengeId);
        setMode('verify');
      } else if (mode === 'verify') {
        await client.verify({ challengeId, code });
        setMode('login');
      } else {
        const tokens = await client.login({ kind, target, password, deviceName: 'Agentdoor Web Console' });
        sessionStore.set(tokens);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand-lockup">
          <span>
            <DoorOpen />
          </span>
          <strong>AGENTDOOR</strong>
        </div>
        <div>
          <p className="eyebrow">ORGANIZATION CAPABILITY GOVERNANCE</p>
          <h1>
            把个人 AI 能力
            <br />
            变成组织资产。
          </h1>
          <p>发现、沉淀、审核、安装与更新，统一治理 Skill、Prompt 和项目上下文包。</p>
        </div>
        <ul>
          <li>
            <ShieldCheck />
            组织级权限与审计
          </li>
          <li>
            <ShieldCheck />
            上传前敏感信息检测
          </li>
          <li>
            <ShieldCheck />多 Agent 安装与更新
          </li>
        </ul>
      </section>
      <section className="auth-card">
        <p className="eyebrow">ADMIN CONSOLE / ACCESS</p>
        <h2>{mode === 'login' ? '登录管理后台' : mode === 'register' ? '创建账号' : '验证账号'}</h2>
        <p className="auth-card__intro">
          {mode === 'verify' ? '输入发送到注册身份的验证码。' : '使用邮箱或手机号进入你的组织。'}
        </p>
        {error ? <ErrorNotice>{error}</ErrorNotice> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === 'register' ? (
            <label>
              显示名称
              <input
                aria-label="显示名称"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          ) : null}
          {mode !== 'verify' ? (
            <>
              <label>
                邮箱或手机号
                <input
                  aria-label="邮箱或手机号"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                密码
                <input
                  aria-label="密码"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={12}
                  required
                />
              </label>
            </>
          ) : (
            <label>
              验证码
              <input
                aria-label="验证码"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                required
              />
            </label>
          )}
          <Button busy={busy} type="submit">
            {mode === 'login' ? '登录' : mode === 'register' ? '注册并验证' : '完成验证'}
            <ArrowRight size={16} />
          </Button>
        </form>
        <button type="button" className="text-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '没有账号？创建账号' : '返回登录'}
        </button>
      </section>
    </main>
  );
}
