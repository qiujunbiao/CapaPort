import { PASSWORD_MIN_CODE_POINTS, PASSWORD_POLICY_HINT } from '@capaport/contracts/auth';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { CloudClient, SessionStore } from '../../app/types';
import { BrandLockup } from '../../components/brand';
import { Button, ErrorNotice } from '../../components/ui';

function passwordFeedback(password: string, busy: boolean): string {
  if (busy) return '正在检查密码安全性…';
  const remaining = PASSWORD_MIN_CODE_POINTS - Array.from(password).length;
  return remaining > 0 ? `还需输入 ${remaining} 个字符` : '提交后将检查密码安全性';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'fieldErrors' in error) {
    const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    const passwordError = fieldErrors?.password?.[0];
    if (passwordError) return passwordError;
  }
  return error instanceof Error ? error.message : '请求失败，请重试';
}

export function AuthScreen({ cloud, sessionStore }: { cloud: CloudClient; sessionStore: SessionStore }) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify' | 'recover' | 'recover-verify'>('login');
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [developmentCode, setDevelopmentCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const kind = target.includes('@') ? 'email' : 'phone';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'recover') {
        if (!cloud.startRecovery) throw new Error('当前服务未启用账号恢复');
        const challenge = await cloud.startRecovery({ kind, target });
        setChallengeId(challenge.challengeId);
        setCode(challenge.developmentCode ?? '');
        setDevelopmentCode(Boolean(challenge.developmentCode));
        setMode('recover-verify');
      } else if (mode === 'recover-verify') {
        if (!cloud.completeRecovery) throw new Error('当前服务未启用账号恢复');
        await cloud.completeRecovery({ challengeId, code, newPassword: password });
        setSuccess('密码已重置，请使用新密码登录。');
        setPassword('');
        setCode('');
        setMode('login');
      } else if (mode === 'login') {
        const tokens = await cloud.login({ kind, target, password, deviceName: 'CapaPort Desktop' });
        sessionStore.set(tokens);
      } else if (mode === 'register') {
        if (!cloud.register) throw new Error('当前服务未启用注册');
        const challenge = await cloud.register({ kind, target, password, displayName });
        setChallengeId(challenge.challengeId);
        setCode(challenge.developmentCode ?? '');
        setDevelopmentCode(Boolean(challenge.developmentCode));
        setMode('verify');
      } else {
        if (!cloud.verify) throw new Error('当前服务未启用验证');
        await cloud.verify({ challengeId, code });
        setMode('login');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <BrandLockup tone="dark" context="CAPABILITY REGISTRY" />
        <div className="auth-story__copy">
          <p className="eyebrow">LOCAL FIRST · GOVERNED SHARING</p>
          <h2>让每一次有效的 AI 工作，成为组织可复用的能力。</h2>
          <div className="auth-principle">
            <ShieldCheck aria-hidden />
            <span>
              <strong>上传前安全检查</strong>
              <small>密钥、令牌和隐私内容在本地阻断</small>
            </span>
          </div>
          <div className="auth-principle">
            <KeyRound aria-hidden />
            <span>
              <strong>组织分级治理</strong>
              <small>个人自由沉淀，组织发布必须审核</small>
            </span>
          </div>
        </div>
        <p className="registry-code">REGISTRY / AD-CORE-0001</p>
      </aside>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <p className="eyebrow">
            {mode === 'login' ? 'WELCOME BACK' : mode === 'register' ? 'CREATE ACCOUNT' : 'VERIFY IDENTITY'}
          </p>
          <h1>
            {mode === 'login'
              ? '进入 CapaPort'
              : mode === 'register'
                ? '创建你的账号'
                : mode === 'verify'
                  ? '验证邮箱或手机号'
                  : mode === 'recover'
                    ? '找回账号'
                    : '重置密码'}
          </h1>
          <p className="auth-intro">
            {mode === 'verify'
              ? '输入收到的 6 位验证码，验证后即可登录。'
              : '使用邮箱或手机号继续，企业 SSO 将在后续版本接入。'}
          </p>
          {error ? <ErrorNotice>{error}</ErrorNotice> : null}
          {success ? (
            <p className="success-message" role="status">
              {success}
            </p>
          ) : null}
          {(mode === 'verify' || mode === 'recover-verify') && developmentCode ? (
            <p className="success-message">仅本地开发：验证码已自动填入。</p>
          ) : null}
          {mode === 'register' ? (
            <label>
              姓名
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
          ) : null}
          {mode !== 'verify' && mode !== 'recover-verify' ? (
            <>
              <label>
                邮箱或手机号
                <input
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              {mode !== 'recover' ? (
                <label>
                  密码
                  <input
                    aria-label="密码"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'register' ? PASSWORD_MIN_CODE_POINTS : undefined}
                    required
                  />
                  {mode === 'register' ? (
                    <span className="password-guidance">
                      <small>{PASSWORD_POLICY_HINT}</small>
                      <small aria-live="polite">{passwordFeedback(password, busy)}</small>
                    </span>
                  ) : null}
                </label>
              ) : null}
            </>
          ) : (
            <>
              <label>
                验证码
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </label>
              {mode === 'recover-verify' ? (
                <label>
                  新密码
                  <input
                    aria-label="新密码"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_CODE_POINTS}
                    required
                  />
                  <span className="password-guidance">
                    <small>{PASSWORD_POLICY_HINT}</small>
                    <small aria-live="polite">{passwordFeedback(password, busy)}</small>
                  </span>
                </label>
              ) : null}
            </>
          )}
          <Button type="submit" busy={busy}>
            {mode === 'login'
              ? '登录'
              : mode === 'register'
                ? '注册并验证'
                : mode === 'recover'
                  ? '发送验证码'
                  : mode === 'recover-verify'
                    ? '完成重置'
                    : '完成验证'}
            <ArrowRight aria-hidden size={16} />
          </Button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
          </button>
          {mode === 'login' ? (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setMode('recover');
                setError('');
                setSuccess('');
              }}
            >
              忘记密码
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}
