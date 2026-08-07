import { extractArchive, hashPackage } from '../../../packages/capability-kit/dist/index.js';

const api = process.env.AGENTDOOR_API_URL ?? 'http://localhost:3210/api/v1';
const stamp = process.env.AGENTDOOR_E2E_STAMP;
if (!stamp) throw new Error('AGENTDOOR_E2E_STAMP must match a publication E2E fixture.');
const password = `V7!qZ2#${stamp}Lm9@Xr4`;

async function request(path, { token, headers, expected = [200, 201, 202, 204], ...options } = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ kind: 'email', target, password, deviceName: 'Distribution E2E' }),
  });
  const organizations = (await request('/organizations', { token: result.body.accessToken })).body;
  const organization = organizations.find((candidate) => candidate.slug === `publication-e2e-${stamp}`);
  if (!organization) throw new Error(`Organization fixture ${stamp} is unavailable.`);
  await request(`/organizations/${organization.id}/switch`, { token: result.body.accessToken, method: 'POST' });
  return { token: result.body.accessToken, organization };
}

const owner = await login(`owner.publish.${stamp}@example.com`);
const reviewer = await login(`reviewer.publish.${stamp}@example.com`);
const capabilities = (
  await request(`/capabilities?query=${encodeURIComponent(`publication-e2e-${stamp}`)}`, { token: owner.token })
).body;
const capability = capabilities.find((candidate) => candidate.slug === `publication-e2e-${stamp}`);
if (!capability) throw new Error('Capability fixture is unavailable.');
const versions = (await request(`/capabilities/${capability.id}/versions`, { token: owner.token })).body;
const current = versions.find((version) => version.version === '1.1.0' && version.status === 'published');
const available = versions.find((version) => version.version === '2.0.0' && version.status === 'published');
if (!current || !available || current.spaceId !== available.spaceId) {
  throw new Error('Expected team-space update fixtures are unavailable.');
}

const hardwareSerial = await request('/devices', {
  token: owner.token,
  method: 'POST',
  expected: [400],
  body: JSON.stringify({
    name: 'Unsafe Device',
    platform: 'macos',
    appVersion: '1.0.0',
    supportedAgents: ['codex'],
    hardwareSerial: 'must-never-be-collected',
  }),
});
if (hardwareSerial.body.code !== 'VALIDATION_ERROR') throw new Error('Hardware identifier was accepted.');

const ownerDevice = (
  await request('/devices', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({
      name: 'Owner Mac',
      platform: 'macos',
      appVersion: '1.0.0',
      supportedAgents: ['codex', 'claude-code'],
    }),
  })
).body;
const reviewerDevice = (
  await request('/devices', {
    token: reviewer.token,
    method: 'POST',
    body: JSON.stringify({ name: 'Reviewer PC', platform: 'windows', appVersion: '1.0.0', supportedAgents: ['codex'] }),
  })
).body;

const incompatible = await request('/distribution/install-plans', {
  token: owner.token,
  method: 'POST',
  expected: [409],
  body: JSON.stringify({
    deviceId: ownerDevice.id,
    capabilityId: capability.id,
    versionId: current.id,
    agent: 'cursor',
  }),
});
if (incompatible.body.code !== 'DISTRIBUTION_INCOMPATIBLE') throw new Error('Incompatible Agent was accepted.');

const foreignDevice = await request('/distribution/install-plans', {
  token: reviewer.token,
  method: 'POST',
  expected: [403],
  body: JSON.stringify({
    deviceId: ownerDevice.id,
    capabilityId: capability.id,
    versionId: current.id,
    agent: 'codex',
  }),
});
if (foreignDevice.body.code !== 'ACCESS_DENIED') throw new Error('Foreign device ownership was disclosed.');
const privateVersion = await request('/distribution/install-plans', {
  token: reviewer.token,
  method: 'POST',
  expected: [403],
  body: JSON.stringify({
    deviceId: reviewerDevice.id,
    capabilityId: capability.id,
    versionId: current.id,
    agent: 'codex',
  }),
});
if (privateVersion.body.code !== 'ACCESS_DENIED') throw new Error('Private team version was disclosed.');

const plan = (
  await request('/distribution/install-plans', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({
      deviceId: ownerDevice.id,
      capabilityId: capability.id,
      versionId: current.id,
      agent: 'codex',
    }),
  })
).body;
const signedUrl = new URL(plan.download.url);
if (plan.download.expiresIn !== 120 || signedUrl.searchParams.get('X-Amz-Expires') !== '120') {
  throw new Error('Download authorization is not short-lived.');
}
const download = await fetch(plan.download.url);
if (!download.ok) throw new Error(`Signed download failed: ${download.status}`);
const bytes = new Uint8Array(await download.arrayBuffer());
const digest = await hashPackage(extractArchive(bytes));
if (digest !== plan.digest) throw new Error('Downloaded artifact digest does not match the install plan.');
if (plan.adapter !== 'codex' || !plan.permissions) throw new Error('Install plan omitted adapter or permissions.');

const reportBody = {
  deviceId: ownerDevice.id,
  capabilityId: capability.id,
  versionId: current.id,
  agent: 'codex',
  outcome: 'installed',
};
const reports = await Promise.all(
  [1, 2].map(() =>
    request('/installations', {
      token: owner.token,
      headers: { 'idempotency-key': `install-${stamp}` },
      method: 'POST',
      body: JSON.stringify(reportBody),
    }),
  ),
);
const installation = reports[0].body;
if (new Set(reports.map((report) => report.body.id)).size !== 1) {
  throw new Error('Concurrent installation idempotency created a duplicate.');
}
const conflict = await request('/installations', {
  token: owner.token,
  headers: { 'idempotency-key': `install-${stamp}` },
  method: 'POST',
  expected: [409],
  body: JSON.stringify({ ...reportBody, outcome: 'uninstalled' }),
});
if (conflict.body.code !== 'IDEMPOTENCY_KEY_CONFLICT') throw new Error('Idempotency payload conflict was accepted.');

const installations = (await request('/installations', { token: owner.token })).body;
if (installations.filter((candidate) => candidate.id === installation.id).length !== 1) {
  throw new Error('Installation list is not idempotent.');
}
const update = (await request(`/installations/${installation.id}/update-check`, { token: owner.token })).body;
if (update.action !== 'update' || update.availableVersionId !== available.id) {
  throw new Error(`Update resolution failed: ${JSON.stringify(update)}`);
}

await request(`/capabilities/${capability.id}/versions/${current.id}/withdraw`, {
  token: owner.token,
  method: 'POST',
});
const removal = (await request(`/installations/${installation.id}/update-check`, { token: owner.token })).body;
if (removal.action !== 'remove' || removal.reason !== 'withdrawn') {
  throw new Error('Withdrawn installation did not produce a removal notice.');
}

await request(`/devices/${ownerDevice.id}`, { token: owner.token, method: 'DELETE' });
const revoked = await request('/distribution/install-plans', {
  token: owner.token,
  method: 'POST',
  expected: [403],
  body: JSON.stringify({
    deviceId: ownerDevice.id,
    capabilityId: capability.id,
    versionId: available.id,
    agent: 'codex',
  }),
});
if (revoked.body.code !== 'ACCESS_DENIED') throw new Error('Revoked device received an install plan.');

console.log(
  `distribution-e2e=passed device_owner=403 private_version=403 incompatible=409 signed_ttl=${plan.download.expiresIn} ` +
    `digest=verified idempotent=true update=${update.action} withdrawal=${removal.action} hardware_serial=400 revoked=403`,
);
