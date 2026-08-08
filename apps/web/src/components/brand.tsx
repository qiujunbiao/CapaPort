type BrandTone = 'dark' | 'light';

export interface BrandMarkProps {
  tone?: BrandTone;
  decorative?: boolean;
  className?: string;
}

export interface BrandLockupProps {
  tone?: BrandTone;
  context?: string;
  compact?: boolean;
  className?: string;
}

export function BrandMark({ tone = 'dark', decorative = false, className = '' }: BrandMarkProps) {
  const source = tone === 'dark' ? '/brand/capaport-mark.svg' : '/brand/capaport-mark-mono.svg';
  return (
    <img
      className={`brand-mark brand-mark--${tone} ${className}`.trim()}
      src={source}
      alt={decorative ? '' : 'CapaPort'}
      aria-hidden={decorative || undefined}
    />
  );
}

export function BrandLockup({ tone = 'dark', context, compact = false, className = '' }: BrandLockupProps) {
  return (
    <div
      className={`brand-lockup brand-lockup--${tone} ${compact ? 'brand-lockup--compact' : ''} ${className}`.trim()}
      role="img"
      aria-label="CapaPort"
    >
      <BrandMark tone={tone} decorative />
      {compact ? null : (
        <span className="brand-wordmark" aria-hidden="true">
          <strong>CAPAPORT</strong>
          {context ? <small>{context}</small> : null}
        </span>
      )}
    </div>
  );
}
