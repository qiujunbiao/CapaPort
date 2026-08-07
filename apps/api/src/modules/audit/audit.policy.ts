const sensitiveKey = /(authorization|businesscontent|content|cookie|email|password|path|phone|secret|target|token)/i;
const absolutePath = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|var|etc|opt|srv|mnt|Volumes)\/)/;

export function redactAuditMetadata(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[redacted]';
  if (typeof value === 'string') return absolutePath.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map((item) => redactAuditMetadata(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactAuditMetadata(childValue, childKey)]),
    );
  }
  return value;
}
