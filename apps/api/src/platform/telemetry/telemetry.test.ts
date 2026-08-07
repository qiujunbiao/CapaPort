import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics-registry.js';
import { redactLogValue, StructuredLogger } from './structured-logger.js';

describe('telemetry', () => {
  it('recursively redacts credentials, bearer tokens, emails, phone numbers, and absolute paths', () => {
    const result = redactLogValue({
      authorization: 'Bearer secret-token',
      password: 'secret',
      actor: 'owner@example.com',
      phone: '+8613812345678',
      localPath: '/Users/alice/secret/project',
      safe: 'publication.approved',
    });
    expect(result).toEqual({
      authorization: '[REDACTED]',
      password: '[REDACTED]',
      actor: '[REDACTED_IDENTITY]',
      phone: '[REDACTED]',
      localPath: '[REDACTED_PATH]',
      safe: 'publication.approved',
    });
  });

  it('emits structured JSON with correlation fields and no raw error stack', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((line) => lines.push(line), { service: 'api' });
    logger.error('request.failed', { requestId: 'request-1', error: new Error('token=secret') });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'error',
      event: 'request.failed',
      service: 'api',
      requestId: 'request-1',
      error: { name: 'Error', message: '[REDACTED]' },
    });
    expect(lines[0]).not.toContain('token=secret');
    expect(lines[0]).not.toContain('stack');
  });

  it('exports bounded Prometheus counters and gauges', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('agentdoor_http_requests_total', { method: 'GET', status: '200' });
    metrics.setGauge('agentdoor_outbox_pending', 7);
    expect(metrics.render()).toContain('agentdoor_http_requests_total{method="GET",status="200"} 1');
    expect(metrics.render()).toContain('agentdoor_outbox_pending 7');
    expect(() => metrics.increment('bad metric', {})).toThrow('Invalid metric name');
  });
});
