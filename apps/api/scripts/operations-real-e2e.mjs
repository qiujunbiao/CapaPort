import { randomUUID } from 'node:crypto';

const api = process.env.CAPAPORT_API_URL ?? 'http://localhost:3210/api/v1';
const stamp = process.env.CAPAPORT_E2E_STAMP;
if (!stamp) throw new Error('CAPAPORT_E2E_STAMP is required and must match a publication E2E fixture.');

const password = `V7!qZ2#${stamp}Lm9@Xr4`;
const ownerEmail = `owner.publish.${stamp}@example.com`;
const reviewerEmail = `reviewer.publish.${stamp}@example.com`;

async function request(path, { token, organizationId, headers, expected = [200, 201, 202, 204], ...options } = {}) {
  const method = options.method ?? 'GET';
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(organizationId ? { 'x-organization-id': organizationId } : {}),
      ...(token && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'idempotency-key': randomUUID() } : {}),
      ...headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${text}`);
  }
  return { status: response.status, body };
}

async function login(target) {
  return (
    await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ kind: 'email', target, password, deviceName: 'Operations E2E' }),
    })
  ).body.accessToken;
}

const ownerToken = await login(ownerEmail);
const reviewerToken = await login(reviewerEmail);
const organizations = (await request('/organizations', { token: ownerToken })).body;
const organization = organizations.find((candidate) => candidate.slug === `publication-e2e-${stamp}`);
if (!organization) throw new Error('Publication E2E organization was not found.');
const organizationId = organization.id;

const ownerAudit = await request('/audit?limit=100', { token: ownerToken, organizationId });
if (ownerAudit.body.entries.length === 0) throw new Error('Owner audit feed is empty.');
const serializedAudit = JSON.stringify(ownerAudit.body);
if (serializedAudit.includes(ownerEmail) || serializedAudit.includes('/Users/')) {
  throw new Error('Audit response exposed a direct identity or absolute path.');
}
const reviewerAudit = await request('/audit', {
  token: reviewerToken,
  organizationId,
  expected: [403],
});
if (reviewerAudit.body.code !== 'ACCESS_DENIED') throw new Error('Member audit access was not denied.');

let ownerInbox;
let reviewerInbox;
for (let attempt = 0; attempt < 40; attempt += 1) {
  [ownerInbox, reviewerInbox] = await Promise.all([
    request('/notifications?limit=100', { token: ownerToken, organizationId }),
    request('/notifications?limit=100', { token: reviewerToken, organizationId }),
  ]);
  if (ownerInbox.body.notifications.length > 0 && reviewerInbox.body.notifications.length > 0) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (ownerInbox.body.notifications.length === 0 || reviewerInbox.body.notifications.length === 0) {
  throw new Error('Worker did not create both owner and reviewer notifications.');
}
const firstOwnerNotification = ownerInbox.body.notifications[0];
const marked = await request(`/notifications/${firstOwnerNotification.id}/read`, {
  token: ownerToken,
  organizationId,
  method: 'PATCH',
});
const markedAgain = await request(`/notifications/${firstOwnerNotification.id}/read`, {
  token: ownerToken,
  organizationId,
  method: 'PATCH',
});
if (!marked.body.readAt || marked.body.readAt !== markedAgain.body.readAt) {
  throw new Error('Notification read operation is not idempotent.');
}

await request('/analytics/events', {
  token: reviewerToken,
  organizationId,
  method: 'POST',
  body: JSON.stringify({
    eventName: 'capability.installed',
    agent: 'codex',
    outcome: 'success',
    source: 'desktop',
    durationBucket: '1s_10s',
  }),
});
for (const unsafePayload of [{ content: 'private source' }, { absolutePath: '/Users/private/project' }]) {
  const rejected = await request('/analytics/events', {
    token: reviewerToken,
    organizationId,
    method: 'POST',
    expected: [400],
    body: JSON.stringify({ eventName: 'agent.discovered', source: 'desktop', ...unsafePayload }),
  });
  if (rejected.body.code !== 'VALIDATION_ERROR') throw new Error('Unsafe analytics payload was not rejected.');
}

const metrics = await request('/analytics/metrics', { token: ownerToken, organizationId });
if ((metrics.body.productEvents['capability.installed'] ?? 0) < 1)
  throw new Error('Analytics metrics did not aggregate.');
const memberMetrics = await request('/analytics/metrics', {
  token: reviewerToken,
  organizationId,
  expected: [403],
});
if (memberMetrics.body.code !== 'ACCESS_DENIED') throw new Error('Member metrics access was not denied.');
await request('/notifications/dead-letters', { token: ownerToken, organizationId });
const memberDeadLetters = await request('/notifications/dead-letters', {
  token: reviewerToken,
  organizationId,
  expected: [403],
});
if (memberDeadLetters.body.code !== 'ACCESS_DENIED') throw new Error('Member dead-letter access was not denied.');

console.log(
  `operations-e2e=passed audit=${ownerAudit.body.entries.length} owner_notifications=${ownerInbox.body.notifications.length} ` +
    `reviewer_notifications=${reviewerInbox.body.notifications.length} event_minimization=400 metrics=1 governance=403`,
);
