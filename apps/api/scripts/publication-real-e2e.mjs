import { createHash, randomUUID } from 'node:crypto';
import { buildArchive } from '../../../packages/capability-kit/dist/index.js';

const api = process.env.CAPAPORT_API_URL ?? 'http://localhost:3210/api/v1';
const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const stamp = process.env.CAPAPORT_E2E_STAMP ?? `${Date.now()}`;
const password = `V7!qZ2#${stamp}Lm9@Xr4`;
const ownerEmail = `owner.publish.${stamp}@example.com`;
const reviewerEmail = `reviewer.publish.${stamp}@example.com`;

async function request(path, { token, headers, expected = [200, 201, 202, 204], ...options } = {}) {
  const method = options.method ?? 'GET';
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

async function latestMail(target, subjectPrefix) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${mailpit}/api/v1/messages`);
    const mailbox = await response.json();
    const message = mailbox.messages.find(
      (candidate) =>
        candidate.To.some((recipient) => recipient.Address === target) && candidate.Subject.startsWith(subjectPrefix),
    );
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Mail not delivered to ${target}: ${subjectPrefix}`);
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${api}/health/ready`);
      if (response.ok) return;
    } catch {
      // Container startup can briefly reset connections while the Nest graph initializes.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('CapaPort API did not become ready.');
}

async function register(target, displayName) {
  const registration = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ kind: 'email', target, password, displayName }),
  });
  const message = await latestMail(target, 'CapaPort security code:');
  const code = message.Subject.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`Verification code missing for ${target}`);
  await request('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId: registration.body.challengeId, code }),
  });
  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ kind: 'email', target, password, deviceName: 'Publication E2E' }),
  });
  const me = await request('/auth/me', { token: login.body.accessToken });
  return { token: login.body.accessToken, userId: me.body.id };
}

function packageArchive(slug, readme, includePrompt = false) {
  const encoder = new TextEncoder();
  const manifest = `schemaVersion: capaport.io/v1alpha1
kind: CapabilityPackage
metadata:
  slug: ${slug}
  name: Publication E2E
  description: Verifies governed publication behavior
  tags: [e2e, governance]
spec:
  components:
    - type: skill
      path: skills/release
${includePrompt ? '    - type: prompt\n      path: prompts/release.md\n' : ''}  compatibility:
    agents: [claude-code]
  permissions:
    filesystem: read-project
    network: none
  entrypoints:
    default: skills/release/SKILL.md
  dependencies: []
`;
  const files = [
    { path: 'capaport.yaml', content: encoder.encode(manifest) },
    { path: 'README.md', content: encoder.encode(readme) },
    { path: 'skills/release/SKILL.md', content: encoder.encode('Run release checks safely.') },
  ];
  if (includePrompt) files.push({ path: 'prompts/release.md', content: encoder.encode('Summarize release risks.') });
  return buildArchive(files);
}

async function upload(token, spaceId, bytes, fileName) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const plan = await request('/artifacts/uploads', {
    token,
    method: 'POST',
    body: JSON.stringify({
      spaceId,
      fileName,
      contentType: 'application/zip',
      sizeBytes: bytes.byteLength,
      sha256,
    }),
  });
  const put = await fetch(plan.body.url, {
    method: 'PUT',
    headers: plan.body.headers,
    body: bytes,
  });
  if (!put.ok) throw new Error(`Artifact PUT failed: ${put.status}`);
  return (await request(`/artifacts/uploads/${plan.body.uploadId}/confirm`, { token, method: 'POST' })).body.artifactId;
}

await waitForApi();
const owner = await register(ownerEmail, 'Publication Owner');
const reviewer = await register(reviewerEmail, 'Publication Reviewer');
const organization = (
  await request('/organizations', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({ name: `Publication E2E ${stamp}`, slug: `publication-e2e-${stamp}` }),
  })
).body;
const ownerSpaces = (await request('/spaces', { token: owner.token })).body;
const personalSpace = ownerSpaces.find((space) => space.type === 'personal');
const organizationSpace = ownerSpaces.find((space) => space.type === 'organization');
if (!personalSpace || !organizationSpace) throw new Error('System spaces were not provisioned.');

await request(`/organizations/${organization.id}/invitations`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ kind: 'email', target: reviewerEmail, role: 'member' }),
});
const invitationMail = await latestMail(reviewerEmail, 'Join ');
const invitationToken = invitationMail.Snippet.match(/token=([^\s]+)/)?.[1];
if (!invitationToken) throw new Error('Invitation token missing.');
await request('/organizations/invitations/accept', {
  token: reviewer.token,
  method: 'POST',
  body: JSON.stringify({ token: invitationToken }),
});

await request(`/spaces/${organizationSpace.id}/members`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ userId: owner.userId, role: 'contributor' }),
});
await request(`/spaces/${organizationSpace.id}/members`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ userId: reviewer.userId, role: 'reviewer' }),
});

const created = (
  await request('/capabilities', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({
      spaceId: personalSpace.id,
      slug: `publication-e2e-${stamp}`,
      name: 'Publication E2E',
      description: 'Governed publication integration fixture',
      tags: ['e2e', 'governance'],
      compatibility: ['claude-code'],
    }),
  })
).body;
const capabilityId = created.capability.id;
const draftId = created.draft.id;
const firstArtifact = await upload(
  owner.token,
  personalSpace.id,
  packageArchive(created.capability.slug, 'First governed release.'),
  'publication-v1.zip',
);
await request(`/capabilities/${capabilityId}/drafts/${draftId}/revisions`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ artifactId: firstArtifact }),
});

const submission = (
  await request(`/capabilities/${capabilityId}/publications`, {
    token: owner.token,
    headers: { 'idempotency-key': `organization-submit-${stamp}` },
    method: 'POST',
    body: JSON.stringify({ draftId, targetSpaceId: organizationSpace.id, version: '1.0.0' }),
  })
).body;
if (submission.status !== 'in_review' || !submission.reviewRequired) {
  throw new Error('Organization publication did not require review.');
}
const replay = (
  await request(`/capabilities/${capabilityId}/publications`, {
    token: owner.token,
    headers: { 'idempotency-key': `organization-submit-${stamp}` },
    method: 'POST',
    body: JSON.stringify({ draftId, targetSpaceId: organizationSpace.id, version: '1.0.0' }),
  })
).body;
if (replay.id !== submission.id) throw new Error('Idempotent submission created a duplicate.');

const selfReview = await request(`/publications/${submission.id}/approve`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ reason: 'Organization owner approved the publication' }),
});
if (selfReview.body.status !== 'published' || !selfReview.body.publishedVersionId) {
  throw new Error('Organization owner could not approve their own publication.');
}
const organizationVersionId = selfReview.body.publishedVersionId;
const scanReport = (await request(`/publications/${submission.id}/scan-report`, { token: reviewer.token })).body;
if (scanReport.blocked) throw new Error('Published candidate scan report was blocked.');

const reviewerSearch = (
  await request(`/capabilities?query=${encodeURIComponent(created.capability.slug)}`, { token: reviewer.token })
).body;
if (!reviewerSearch.some((capability) => capability.id === capabilityId)) {
  throw new Error('Published capability was not visible through its target organization space.');
}

const teamSpace = (
  await request('/spaces', {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({ type: 'team', name: 'Direct Team', slug: `direct-team-${stamp}`, reviewPolicy: 'direct' }),
  })
).body;
await request(`/spaces/${teamSpace.id}/members`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ userId: owner.userId, role: 'contributor' }),
});
const secondDraft = (await request(`/capabilities/${capabilityId}/drafts`, { token: owner.token, method: 'POST' }))
  .body;
const secondArtifact = await upload(
  owner.token,
  personalSpace.id,
  packageArchive(created.capability.slug, 'Second release with a prompt.', true),
  'publication-v2.zip',
);
await request(`/capabilities/${capabilityId}/drafts/${secondDraft.id}/revisions`, {
  token: owner.token,
  method: 'POST',
  body: JSON.stringify({ artifactId: secondArtifact }),
});
const direct = (
  await request(`/capabilities/${capabilityId}/publications`, {
    token: owner.token,
    headers: { 'idempotency-key': `team-submit-${stamp}` },
    method: 'POST',
    body: JSON.stringify({ draftId: secondDraft.id, targetSpaceId: teamSpace.id, version: '1.1.0' }),
  })
).body;
if (direct.status !== 'published' || direct.reviewRequired) throw new Error('Direct team publication did not publish.');

const packageDiff = (
  await request(
    `/capabilities/${capabilityId}/versions/${direct.publishedVersionId}/diff?against=${organizationVersionId}`,
    {
      token: owner.token,
    },
  )
).body;
if (!packageDiff.added.includes('prompts/release.md') || packageDiff.recommendedChange !== 'major') {
  throw new Error(`Unexpected package diff: ${JSON.stringify(packageDiff)}`);
}

const promotion = (
  await request(`/capabilities/${capabilityId}/promotions`, {
    token: owner.token,
    headers: { 'idempotency-key': `promotion-${stamp}` },
    method: 'POST',
    body: JSON.stringify({ sourceVersionId: organizationVersionId, targetSpaceId: teamSpace.id, version: '2.0.0' }),
  })
).body;
if (promotion.status !== 'published' || !promotion.publishedVersionId) throw new Error('Version promotion failed.');

const deprecated = (
  await request(`/capabilities/${capabilityId}/versions/${organizationVersionId}/deprecate`, {
    token: owner.token,
    method: 'POST',
  })
).body;
if (deprecated.status !== 'deprecated') throw new Error('Version deprecation failed.');
const withdrawn = (
  await request(`/capabilities/${capabilityId}/versions/${organizationVersionId}/withdraw`, {
    token: owner.token,
    method: 'POST',
  })
).body;
if (withdrawn.status !== 'withdrawn') throw new Error('Version withdrawal failed.');
const archived = (
  await request(`/capabilities/${capabilityId}/versions/${organizationVersionId}/archive`, {
    token: owner.token,
    method: 'POST',
  })
).body;
if (archived.status !== 'archived') throw new Error('Version archival failed.');

async function submitAdditionalDraft(version, key) {
  const draft = (await request(`/capabilities/${capabilityId}/drafts`, { token: owner.token, method: 'POST' })).body;
  await request(`/capabilities/${capabilityId}/drafts/${draft.id}/revisions`, {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({ artifactId: secondArtifact }),
  });
  const publication = (
    await request(`/capabilities/${capabilityId}/publications`, {
      token: owner.token,
      headers: { 'idempotency-key': `${key}-${stamp}` },
      method: 'POST',
      body: JSON.stringify({ draftId: draft.id, targetSpaceId: organizationSpace.id, version }),
    })
  ).body;
  return { draft, publication };
}

const changesFixture = await submitAdditionalDraft('3.0.0', 'changes');
const changesRequested = (
  await request(`/publications/${changesFixture.publication.id}/request-changes`, {
    token: reviewer.token,
    method: 'POST',
    body: JSON.stringify({ reason: 'Add a rollback section' }),
  })
).body;
if (changesRequested.status !== 'changes_requested') throw new Error('Request-changes transition failed.');
const changedRevision = (
  await request(`/capabilities/${capabilityId}/drafts/${changesFixture.draft.id}/revisions`, {
    token: owner.token,
    method: 'POST',
    body: JSON.stringify({ artifactId: firstArtifact }),
  })
).body;
if (changedRevision.sequence < 2) throw new Error('Changes-requested draft did not accept a new immutable revision.');
const resubmission = (
  await request(`/capabilities/${capabilityId}/publications`, {
    token: owner.token,
    headers: { 'idempotency-key': `changes-resubmit-${stamp}` },
    method: 'POST',
    body: JSON.stringify({ draftId: changesFixture.draft.id, targetSpaceId: organizationSpace.id, version: '3.0.0' }),
  })
).body;
if (resubmission.status !== 'in_review' || resubmission.id === changesFixture.publication.id) {
  throw new Error('Changes-requested draft was not resubmitted as a new review candidate.');
}
const resubmittedApproval = (
  await request(`/publications/${resubmission.id}/approve`, {
    token: reviewer.token,
    method: 'POST',
    body: JSON.stringify({ reason: 'Requested changes were addressed' }),
  })
).body;
if (resubmittedApproval.status !== 'published') throw new Error('Resubmitted changes were not publishable.');

const frozenEdit = await request(`/capabilities/${capabilityId}/drafts/${changesFixture.draft.id}/revisions`, {
  token: owner.token,
  method: 'POST',
  expected: [409],
  body: JSON.stringify({ artifactId: secondArtifact }),
});
if (frozenEdit.body.code !== 'CAPABILITY_DRAFT_FROZEN') {
  throw new Error('A published resubmission allowed its frozen draft to be edited.');
}

const rejectFixture = await submitAdditionalDraft('4.0.0', 'reject');
const rejected = (
  await request(`/publications/${rejectFixture.publication.id}/reject`, {
    token: reviewer.token,
    method: 'POST',
    body: JSON.stringify({ reason: 'Package violates team policy' }),
  })
).body;
if (rejected.status !== 'rejected') throw new Error('Publication rejection failed.');

const withdrawFixture = await submitAdditionalDraft('5.0.0', 'withdraw');
const publicationWithdrawn = (
  await request(`/publications/${withdrawFixture.publication.id}/withdraw`, {
    token: owner.token,
    method: 'POST',
  })
).body;
if (publicationWithdrawn.status !== 'withdrawn') throw new Error('Publication withdrawal failed.');

const resolvedPublications = (
  await request(`/publications?targetSpaceId=${organizationSpace.id}&limit=20`, { token: reviewer.token })
).body;
for (const expectedStatus of ['published', 'changes_requested', 'rejected', 'withdrawn']) {
  if (!resolvedPublications.some((publication) => publication.status === expectedStatus)) {
    throw new Error(`Publication list omitted ${expectedStatus}.`);
  }
}

console.log(
  `publication-e2e=passed publication=${submission.id} published_version=${organizationVersionId} ` +
    `org_review=true owner_self_review=allowed search_visible=true direct_team=true diff=${packageDiff.recommendedChange} ` +
    `promotion=true lifecycle=${deprecated.status}->${withdrawn.status}->${archived.status} ` +
    `review_outcomes=${changesRequested.status},${rejected.status},${publicationWithdrawn.status} ` +
    `changes_resubmitted=${resubmittedApproval.status} frozen_draft=409`,
);
