export function DoorMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`door-brand ${compact ? 'door-brand--compact' : ''}`} role="img" aria-label="Agentdoor">
      <span className="door-mark" aria-hidden>
        <i />
        <b />
        <em />
        <u />
      </span>
      {compact ? null : (
        <span>
          AGENTDOOR<small>CAPABILITY REGISTRY</small>
        </span>
      )}
    </div>
  );
}
