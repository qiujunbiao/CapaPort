import { describe, expect, it } from 'vitest';
import { notificationForEvent } from './notification.template.js';

describe('notification templates', () => {
  it('uses deterministic product copy without embedding event payload content', () => {
    const notification = notificationForEvent({
      eventType: 'publication.changes_requested',
      aggregateId: 'publication-1',
      payload: { reason: 'private review content', absolutePath: '/Users/private/project' },
    });
    expect(notification).toEqual({
      type: 'publication.changes_requested',
      title: 'Changes requested',
      body: 'A reviewer requested changes to your capability publication.',
      data: { aggregateId: 'publication-1' },
    });
    expect(JSON.stringify(notification)).not.toMatch(/private review content|\/Users\/private/);
  });
});
