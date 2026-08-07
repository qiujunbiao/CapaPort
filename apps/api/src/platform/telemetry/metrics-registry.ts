type Labels = Record<string, string>;

const metricNamePattern = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const labelNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function encodeLabels(labels: Labels): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return '';
  for (const [name] of entries) {
    if (!labelNamePattern.test(name)) throw new Error(`Invalid metric label: ${name}`);
  }
  return `{${entries.map(([name, value]) => `${name}="${value.replace(/[\\"\n]/g, '_').slice(0, 80)}"`).join(',')}}`;
}

export class MetricsRegistry {
  private readonly values = new Map<
    string,
    { name: string; labels: Labels; value: number; type: 'counter' | 'gauge' }
  >();

  increment(name: string, labels: Labels, amount = 1): void {
    this.assertName(name);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Counter increment must be finite and non-negative.');
    const suffix = encodeLabels(labels);
    const key = `${name}${suffix}`;
    const existing = this.values.get(key);
    this.values.set(key, { name, labels, value: (existing?.value ?? 0) + amount, type: 'counter' });
  }

  setGauge(name: string, value: number, labels: Labels = {}): void {
    this.assertName(name);
    if (!Number.isFinite(value)) throw new Error('Gauge value must be finite.');
    const suffix = encodeLabels(labels);
    this.values.set(`${name}${suffix}`, { name, labels, value, type: 'gauge' });
  }

  render(): string {
    const grouped = new Map<string, Array<{ labels: Labels; value: number; type: 'counter' | 'gauge' }>>();
    for (const value of this.values.values()) {
      const group = grouped.get(value.name) ?? [];
      group.push(value);
      grouped.set(value.name, group);
    }
    const lines: string[] = [];
    for (const [name, entries] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`# TYPE ${name} ${entries[0]?.type ?? 'gauge'}`);
      for (const entry of entries.sort((left, right) =>
        encodeLabels(left.labels).localeCompare(encodeLabels(right.labels)),
      )) {
        lines.push(`${name}${encodeLabels(entry.labels)} ${entry.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private assertName(name: string): void {
    if (!metricNamePattern.test(name)) throw new Error(`Invalid metric name: ${name}`);
  }
}

export const platformMetrics = new MetricsRegistry();
