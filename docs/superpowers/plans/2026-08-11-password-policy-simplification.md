# Simplified Password Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CapaPort's composition-heavy password rules with an 8-character, context-aware policy, Google Password Defense leak blocking, atomic recovery completion, and actionable Chinese guidance in Web and Desktop.

**Architecture:** Keep the API authoritative. A synchronous local policy rejects short or obviously guessable passwords, an injected `PasswordRiskChecker` performs Google's privacy-preserving credential leak check, and recovery uses a two-phase challenge authorization followed by an atomic consume/password-update transaction. Web and Desktop show shared policy copy and map server field errors without duplicating the security algorithm.

**Tech Stack:** TypeScript 7, NestJS 11, Vitest 4, React 19, Zod 4, `@zxcvbn-ts/core@4.1.2`, `@zxcvbn-ts/language-common@4.1.3`, `recaptcha-password-check-helpers@1.0.3`, `@google-cloud/recaptcha-enterprise@7.0.0`, PostgreSQL/Drizzle, pnpm/Turbo.

## Global Constraints

- Passwords contain 8-256 Unicode code points; do not trim, truncate, or require uppercase, lowercase, number, or symbol classes.
- Reject zxcvbn scores 0 and 1; accept scores 2-4. Supply normalized identity, display name, and `CapaPort` as user inputs.
- Never log or persist plaintext passwords, Google helper material, encrypted match prefixes, or returned candidates.
- Production registration and recovery fail closed when Google Password Defense is unavailable; use a 500 ms assessment timeout.
- Existing passwords remain valid at login. Apply the new policy only to registration and password reset.
- Recovery must not consume a valid verification challenge until local policy, Google leak checking, hashing, and final transactional validation can succeed.
- Web and Desktop must show the exact Chinese policy hint and prefer `fieldErrors.password[0]` over a generic error message.
- Do not silently enable the development risk checker in production.

---

### Task 1: Shared copy and deterministic local password policy

**Files:**
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/auth.test.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/modules/identity/identity.policy.ts`
- Modify: `apps/api/src/modules/identity/identity.policy.test.ts`

**Interfaces:**
- Produces: `PASSWORD_MIN_CODE_POINTS = 8`, `PASSWORD_MAX_CODE_POINTS = 256`, `PASSWORD_POLICY_HINT` from `@capaport/contracts/auth`.
- Produces: `validatePasswordStrength(password: string, context?: { identity?: string; displayName?: string }): void`.
- Throws: `AUTH_PASSWORD_TOO_SHORT`, `AUTH_PASSWORD_TOO_LONG`, or `AUTH_PASSWORD_TOO_SIMPLE`, each with Chinese `fieldErrors.password`.

- [x] **Step 1: Write failing contract and policy tests**

Add assertions that `Array.from(password).length` governs length, that eight-character nontrivial passwords and Unicode pass without composition rules, and that common/context-derived passwords fail:

```ts
expect(() => validatePasswordStrength('Ab1!xyz')).toThrowError(expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SHORT' }));
expect(() => validatePasswordStrength('river-stone-82')).not.toThrow();
expect(() => validatePasswordStrength('纯中文口令足够长而且随机')).not.toThrow();
expect(() => validatePasswordStrength('password', { identity: 'person@example.com' })).toThrowError(
  expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SIMPLE' }),
);
expect(() => validatePasswordStrength('person2026', { identity: 'person@example.com' })).toThrowError(
  expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SIMPLE' }),
);
```

Assert exported hint text is exactly:

```ts
'密码至少 8 个字符，可使用字母、数字和符号。请勿使用常见、容易猜测或已泄露的密码。'
```

- [x] **Step 2: Run tests and verify the new expectations fail**

Run:

```bash
pnpm --filter @capaport/contracts test -- src/auth.test.ts
pnpm --filter @capaport/api test -- src/modules/identity/identity.policy.test.ts
```

Expected: failures because the constants, 8-code-point rule, Chinese errors, and zxcvbn checks do not exist.

- [x] **Step 3: Add pinned strength dependencies**

Run:

```bash
pnpm --filter @capaport/api add @zxcvbn-ts/core@4.1.2 @zxcvbn-ts/language-common@4.1.3
```

- [x] **Step 4: Implement shared constants and local policy**

Export constants from `packages/contracts/src/auth.ts`. Configure zxcvbn once at module load using the common dictionary and adjacency graphs. Analyze the original password, count length with `Array.from`, and pass context values as `userInputs` after removing empty entries.

Use stable Chinese errors:

```ts
throw new AppError('AUTH_PASSWORD_TOO_SHORT', '密码至少需要 8 个字符。', 400, {
  password: ['密码至少需要 8 个字符。'],
});
```

Use equivalent `AUTH_PASSWORD_TOO_LONG` and `AUTH_PASSWORD_TOO_SIMPLE` errors. Do not mutate the password before hashing.

- [x] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm --filter @capaport/contracts test -- src/auth.test.ts
pnpm --filter @capaport/api test -- src/modules/identity/identity.policy.test.ts
pnpm --filter @capaport/api typecheck
git diff --check
```

Expected: all pass.

Commit:

```bash
git add packages/contracts/src/auth.ts packages/contracts/src/auth.test.ts apps/api/package.json pnpm-lock.yaml apps/api/src/modules/identity/identity.policy.ts apps/api/src/modules/identity/identity.policy.test.ts
git commit -m "feat(auth): simplify local password policy"
```

### Task 2: Google Password Defense adapter and production configuration

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/config/config.ts`
- Modify: `apps/api/src/config/config.test.ts`
- Create: `apps/api/src/modules/identity/password-risk-checker.ts`
- Create: `apps/api/src/modules/identity/password-risk-checker.test.ts`
- Modify: `apps/api/src/modules/identity/identity.module.ts`

**Interfaces:**
- Produces: `PASSWORD_RISK_CHECKER` symbol.
- Produces: `PasswordRiskChecker.check(identity: string, password: string): Promise<'safe' | 'compromised'>`.
- Produces: `GooglePasswordRiskChecker` and `DevelopmentPasswordRiskChecker`.
- Configures: `auth.passwordRisk: { mode: 'google'; projectId: string; timeoutMs: 500 } | { mode: 'development'; timeoutMs: 500 }`.

- [x] **Step 1: Write failing config and adapter tests**

Cover:

```ts
expect(() => parseConfig(productionWithoutGoogleProject)).toThrow(/GOOGLE_CLOUD_PROJECT/);
expect(parseConfig(testEnvironment)).toMatchObject({ auth: { passwordRisk: { mode: 'development', timeoutMs: 500 } } });
```

Mock the Google client and helper so adapter tests assert:

- helper request bytes are base64 encoded into `privatePasswordLeakVerification`;
- the returned fields are verified locally;
- a verified match returns `compromised`;
- a 500 ms timeout or provider error becomes `PasswordRiskCheckUnavailableError`;
- errors and serialized objects never contain the test password.

- [x] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @capaport/api test -- src/config/config.test.ts src/modules/identity/password-risk-checker.test.ts
```

Expected: failures because config and checker do not exist.

- [x] **Step 3: Add pinned Google dependencies**

Run:

```bash
pnpm --filter @capaport/api add recaptcha-password-check-helpers@1.0.3 @google-cloud/recaptcha-enterprise@7.0.0
```

- [x] **Step 4: Implement config and injected adapters**

Add environment parsing:

```ts
PASSWORD_RISK_MODE: z.enum(['google', 'development']).optional(),
GOOGLE_CLOUD_PROJECT: z.string().trim().min(1).optional(),
PASSWORD_RISK_TIMEOUT_MS: z.coerce.number().int().min(100).max(5_000).default(500),
```

Default to `google` in production and `development` elsewhere. Reject production `development` mode and reject `google` mode without a project ID.

Use `PasswordCheckVerification.create(identity, password)`, create an assessment through `RecaptchaEnterpriseServiceClient`, and call `verification.verify(...)` locally. Wrap all provider/timeout failures in a password-free `PasswordRiskCheckUnavailableError`.

Register the checker with a Nest factory provider selected from `AppConfig`; inject the symbol into `IdentityService` in Task 4.

- [x] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm --filter @capaport/api test -- src/config/config.test.ts src/modules/identity/password-risk-checker.test.ts
pnpm --filter @capaport/api typecheck
git diff --check
```

Commit:

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/config/config.ts apps/api/src/config/config.test.ts apps/api/src/modules/identity/password-risk-checker.ts apps/api/src/modules/identity/password-risk-checker.test.ts apps/api/src/modules/identity/identity.module.ts
git commit -m "feat(auth): add Google password risk checker"
```

### Task 3: Two-phase and atomic password recovery

**Files:**
- Modify: `apps/api/src/modules/identity/identity.repository.ts`
- Modify: `apps/api/src/modules/identity/verification.service.ts`
- Modify: `apps/api/src/modules/identity/verification.service.test.ts`
- Modify: `apps/api/src/modules/identity/identity.service.ts`
- Modify: `apps/api/src/modules/identity/identity.service.test.ts`

**Interfaces:**
- Produces: `VerificationService.authorizeRecovery(challengeId: string, code: string): Promise<{ challengeId: string; codeDigest: string; userId: string; kind: IdentityKind; target: string }>` without consuming a valid challenge.
- Produces: `IdentityDataStore.completePasswordRecovery(input: { challengeId: string; codeDigest: string; userId: string; passwordHash: string; now: Date }): Promise<void>`.
- Removes service dependence on `consumeRecovery` for password reset.

- [x] **Step 1: Write failing recovery tests**

Add tests proving:

- correct recovery code returns server-stored `target` without setting `consumed_at`;
- incorrect code increments attempts;
- `completePasswordRecovery` locks and rechecks challenge ID, purpose, digest, expiry, attempts, consumed state, and user ID;
- one transaction marks the challenge consumed, updates the hash, revokes sessions, and revokes refresh tokens;
- a failed password risk check leaves the challenge unconsumed and reusable;
- concurrent completion allows only one success.

- [x] **Step 2: Run focused tests and verify they fail**

Run:

```bash
pnpm --filter @capaport/api test -- src/modules/identity/verification.service.test.ts src/modules/identity/identity.service.test.ts
```

Expected: failures because `authorizeRecovery` and `completePasswordRecovery` do not exist.

- [x] **Step 3: Implement non-consuming authorization and atomic completion**

Add a repository challenge inspection path that uses `SELECT ... FOR UPDATE`, preserves the current invalid-attempt behavior, and commits without setting `consumed_at` for a correct code. Return the HMAC `codeDigest` only inside the service boundary.

Implement `completePasswordRecovery` as one PostgreSQL transaction. Re-read the challenge with `FOR UPDATE`, compare every invariant, then mark it consumed, update the user password, revoke sessions, and revoke refresh tokens before commit. Map stale/used challenges to existing stable verification errors.

- [x] **Step 4: Run focused tests and commit**

Run:

```bash
pnpm --filter @capaport/api test -- src/modules/identity/verification.service.test.ts src/modules/identity/identity.service.test.ts
pnpm --filter @capaport/api typecheck
git diff --check
```

Commit:

```bash
git add apps/api/src/modules/identity/identity.repository.ts apps/api/src/modules/identity/verification.service.ts apps/api/src/modules/identity/verification.service.test.ts apps/api/src/modules/identity/identity.service.ts apps/api/src/modules/identity/identity.service.test.ts
git commit -m "fix(auth): make password recovery completion atomic"
```

### Task 4: Enforce local and Google checks in identity flows

**Files:**
- Modify: `apps/api/src/modules/identity/identity.service.ts`
- Modify: `apps/api/src/modules/identity/identity.service.test.ts`
- Modify: `apps/api/src/modules/identity/identity.module.ts`
- Modify: `apps/api/tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `validatePasswordStrength`, `PASSWORD_RISK_CHECKER`, `authorizeRecovery`, and `completePasswordRecovery`.
- Produces stable field errors: `AUTH_PASSWORD_COMPROMISED` and `AUTH_PASSWORD_RISK_CHECK_UNAVAILABLE`.

- [x] **Step 1: Write failing orchestration tests**

For registration, assert call order local policy → Google checker → Argon2 hash → repository create. On weak, compromised, or unavailable outcomes, assert hash/create/delivery are not called.

For recovery, assert authorize challenge → contextual local policy → Google checker → Argon2 hash → atomic completion. On a checker failure, assert atomic completion is not called and the same challenge can be retried.

Assert compromised and unavailable mappings:

```ts
{ code: 'AUTH_PASSWORD_COMPROMISED', statusCode: 400, fieldErrors: { password: ['该密码曾出现在数据泄露中，请勿继续使用。'] } }
{ code: 'AUTH_PASSWORD_RISK_CHECK_UNAVAILABLE', statusCode: 503, fieldErrors: { password: ['暂时无法完成密码安全检查，请稍后重试。'] } }
```

- [x] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @capaport/api test -- src/modules/identity/identity.service.test.ts tests/e2e/auth.spec.ts
```

- [x] **Step 3: Implement orchestration and Chinese error envelopes**

Inject `PasswordRiskChecker`. Add a private method that calls local policy with normalized identity/display name, then translates checker outcomes/errors into `AppError`. Do not catch unrelated errors.

Keep login unchanged. Registration and reset must both use the same private policy method.

- [x] **Step 4: Run API identity and e2e tests and commit**

Run:

```bash
pnpm --filter @capaport/api test -- src/modules/identity/identity.policy.test.ts src/modules/identity/password-risk-checker.test.ts src/modules/identity/verification.service.test.ts src/modules/identity/identity.service.test.ts tests/e2e/auth.spec.ts
pnpm --filter @capaport/api typecheck
git diff --check
```

Commit:

```bash
git add apps/api/src/modules/identity/identity.service.ts apps/api/src/modules/identity/identity.service.test.ts apps/api/src/modules/identity/identity.module.ts apps/api/tests/e2e/auth.spec.ts
git commit -m "feat(auth): enforce password risk policy"
```

### Task 5: Web/Desktop guidance, deployment configuration, and end-to-end verification

**Files:**
- Create: `apps/web/src/features/auth/auth-page.test.tsx`
- Modify: `apps/web/src/features/auth/auth-page.tsx`
- Create: `apps/desktop/src/features/auth/auth-screen.test.tsx`
- Modify: `apps/desktop/src/features/auth/auth-screen.tsx`
- Modify: `infra/compose/compose.yaml`
- Modify: `infra/compose/compose.production.yaml`
- Modify: `infra/docker/entrypoint.sh`
- Modify: `docs/admin-guide/setup.md`
- Modify: `docs/admin-guide/security.md`
- Modify: `docs/runbooks/deploy.md`
- Modify: `docs/superpowers/plans/2026-08-11-password-policy-simplification.md`

**Interfaces:**
- Consumes: `PASSWORD_MIN_CODE_POINTS` and `PASSWORD_POLICY_HINT`.
- Web consumes `CapaPortSdkError.fieldErrors`; Desktop consumes `CloudError.fieldErrors`.
- Production consumes `PASSWORD_RISK_MODE=google`, `GOOGLE_CLOUD_PROJECT`, and ADC through `GOOGLE_APPLICATION_CREDENTIALS`.

- [x] **Step 1: Write failing Web and Desktop tests**

For both clients assert:

- registration and recovery-reset show the exact static policy hint;
- fewer than eight Unicode code points shows `还需输入 N 个字符`;
- eight or more shows `提交后将检查密码安全性`;
- submit shows `正在检查密码安全性…` and prevents duplicate submission;
- `fieldErrors.password[0]` is displayed instead of generic English text;
- login mode does not show new-password guidance.

- [x] **Step 2: Run UI tests and verify they fail**

Run:

```bash
pnpm --filter @capaport/web test -- src/features/auth/auth-page.test.tsx
pnpm --filter @capaport/desktop test -- src/features/auth/auth-screen.test.tsx
```

- [x] **Step 3: Implement shared copy consumption and field error mapping**

Import shared constants from `@capaport/contracts/auth`. Count with `Array.from(password).length`. Render the policy and live status near new-password fields with `aria-live="polite"`. Preserve existing `autocomplete="new-password"`, paste, and password-manager behavior.

Map errors with a narrow helper:

```ts
function passwordFieldError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('fieldErrors' in error)) return undefined;
  const fieldErrors = error.fieldErrors as Record<string, string[]> | undefined;
  return fieldErrors?.password?.[0];
}
```

Use `passwordFieldError(caught) ?? caught.message` in both auth components.

- [x] **Step 4: Add development and production deployment configuration**

Set `PASSWORD_RISK_MODE: development` in local compose. In production require:

```yaml
PASSWORD_RISK_MODE: google
GOOGLE_CLOUD_PROJECT: ${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}
GOOGLE_APPLICATION_CREDENTIALS: /run/secrets/google_application_credentials
```

Add the `google_application_credentials` Compose secret and entrypoint support only where required. Document billing, API enablement, ADC secret permissions, the 500 ms fail-closed behavior, and a deployment smoke test that exercises a mocked checker outside production and configuration validation in production.

- [x] **Step 5: Run focused and repository-wide verification**

Run:

```bash
pnpm --filter @capaport/web test -- src/features/auth/auth-page.test.tsx
pnpm --filter @capaport/desktop test -- src/features/auth/auth-screen.test.tsx
pnpm --filter @capaport/api test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm security:gate
pnpm sdk:check
git diff --check
```

Expected: every command exits 0. If Docker is available and production credentials are not required by local compose, also run:

```bash
pnpm stack:smoke
pnpm acceptance
```

- [x] **Step 6: Mark plan complete and commit**

Mark all completed checkboxes in this plan, then run:

```bash
git add apps/web/src/features/auth/auth-page.tsx apps/web/src/features/auth/auth-page.test.tsx apps/desktop/src/features/auth/auth-screen.tsx apps/desktop/src/features/auth/auth-screen.test.tsx infra/compose/compose.yaml infra/compose/compose.production.yaml infra/docker/entrypoint.sh docs/admin-guide/setup.md docs/admin-guide/security.md docs/runbooks/deploy.md docs/superpowers/plans/2026-08-11-password-policy-simplification.md
git commit -m "feat(auth): explain password security requirements"
```

## Final Integration

- [x] Rebase or fast-forward the implementation branch onto the latest `main` without dropping the design commit.
- [x] Re-run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm security:gate`, and `git diff --check` on the integrated result.
- [x] Merge with `--ff-only`, push `main`, and verify `git rev-parse HEAD` equals `git ls-remote origin refs/heads/main`.
