import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

export function Button({
  className = '',
  variant = 'primary',
  busy,
  children,
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet'; busy?: boolean }
>) {
  return (
    <button
      type="button"
      className={`button button--${variant} ${className}`}
      disabled={props.disabled || busy}
      {...props}
    >
      {busy ? '处理中…' : children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function Status({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'good' | 'warn' | 'bad' | 'neutral' }>) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

export function ErrorNotice({ children, onRetry }: PropsWithChildren<{ onRetry?: () => void }>) {
  return (
    <div className="error-notice" role="alert">
      <span>{children}</span>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark">AD / 00</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingBlock({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span />
      <span />
      <span />
      <b>{label}</b>
    </div>
  );
}
