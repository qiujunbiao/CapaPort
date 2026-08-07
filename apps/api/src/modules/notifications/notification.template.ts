export type NotificationTemplate = {
  type: string;
  title: string;
  body: string;
  data: { aggregateId: string };
};

const messages: Record<string, { title: string; body: string }> = {
  'publication.submitted': {
    title: 'Capability review requested',
    body: 'A capability publication is ready for independent review.',
  },
  'publication.changes_requested': {
    title: 'Changes requested',
    body: 'A reviewer requested changes to your capability publication.',
  },
  'publication.rejected': {
    title: 'Publication rejected',
    body: 'A capability publication was rejected by a reviewer.',
  },
  'publication.withdrawn': {
    title: 'Publication withdrawn',
    body: 'A capability publication was withdrawn.',
  },
  'capability.version.published': {
    title: 'Capability published',
    body: 'A capability version is now available in its target space.',
  },
  'capability.version.deprecated': {
    title: 'Capability version deprecated',
    body: 'An installed capability version has been deprecated.',
  },
  'capability.version.withdrawn': {
    title: 'Capability version withdrawn',
    body: 'An installed capability version was withdrawn and should be removed.',
  },
  'device.revoked': {
    title: 'Device access revoked',
    body: 'A device can no longer download organization capabilities.',
  },
};

export function notificationForEvent(event: {
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}): NotificationTemplate {
  const message = messages[event.eventType] ?? {
    title: 'Agentdoor activity',
    body: 'There is new activity in your organization.',
  };
  return { type: event.eventType, ...message, data: { aggregateId: event.aggregateId } };
}
