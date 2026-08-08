const sensitiveKey = /(?:authorization|cookie|password|secret|token|pepper|credential|phone|private.?key)/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const absolutePathPattern = /^(?:\/(?:Users|home|private|var|etc|opt|srv|mnt|Volumes|tmp)\/|[A-Za-z]:\\)/;
const secretInMessagePattern = /(?:bearer\s+|token=|password=|secret=|api[_-]?key=)/i;

export type LogFields = Record<string, unknown>;

function redactString(value: string): string {
  if (emailPattern.test(value)) return '[REDACTED_IDENTITY]';
  if (absolutePathPattern.test(value)) return '[REDACTED_PATH]';
  if (secretInMessagePattern.test(value)) return '[REDACTED]';
  return value.length > 2_000 ? `${value.slice(0, 2_000)}...[TRUNCATED]` : value;
}

export function redactLogValue(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return key.toLowerCase().includes('path') ? '[REDACTED_PATH]' : '[REDACTED]';
  if (value instanceof Error) {
    return { name: value.name.slice(0, 80), message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactLogValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryValue, entryKey)]),
    );
  }
  if (typeof value === 'string') return redactString(value);
  return value;
}

export class StructuredLogger {
  constructor(
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly defaults: LogFields = {},
  ) {}

  info(event: string, fields: LogFields = {}): void {
    this.emit('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.emit('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.emit('error', event, fields);
  }

  child(defaults: LogFields): StructuredLogger {
    return new StructuredLogger(this.write, { ...this.defaults, ...defaults });
  }

  private emit(level: 'info' | 'warn' | 'error', event: string, fields: LogFields): void {
    this.write(
      JSON.stringify(
        redactLogValue({
          timestamp: new Date().toISOString(),
          level,
          event: event.slice(0, 120),
          ...this.defaults,
          ...fields,
        }),
      ),
    );
  }
}

export const platformLogger = new StructuredLogger(undefined, {
  service: process.env.CAPAPORT_SERVICE ?? 'api',
  environment: process.env.NODE_ENV ?? 'development',
  version: process.env.CAPAPORT_VERSION ?? 'development',
});
