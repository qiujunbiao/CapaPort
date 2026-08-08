# CapaPort Desktop Governance Superset Design

## Goal

CapaPort Desktop must expose every organization governance capability available in the Web administration console while retaining its local-only discovery, authoring, installation, update, conflict-resolution, project binding, and diagnostics workflows. The product invariant is `Desktop capabilities ⊇ Web capabilities`.

## Product Boundary

Desktop remains the primary application. Web remains a browser-accessible administration surface, but it no longer owns any exclusive product capability. Both surfaces use the same cloud API, authorization rules, status vocabulary, and organization context.

The following Desktop-only capabilities remain unchanged:

- local Agent discovery for Codex, Claude Code, Cursor, and Gemini CLI;
- local package import and pre-upload security scanning;
- Skill, Prompt, and project-context authoring;
- local project-directory binding and context projection;
- signed install plans, installation, update, uninstall, backup, rollback, and conflict resolution;
- desktop updater, local diagnostics, credential storage, and offline queue recovery.

Desktop additionally gains every Web governance capability:

- organization overview and governance metrics;
- published capability market plus unpublished asset administration;
- complete review context and review decisions;
- capability metadata and version lifecycle management;
- organization members, invitations, and role changes;
- team and project spaces, review policies, memberships, and archival;
- organization security policy, sessions, and operational recovery;
- audit log and adoption analytics;
- organization/account export, ownership transfer, leave, closure, cancellation, and account deletion lifecycle.

## Information Architecture

The existing Desktop navigation is divided into two semantic groups without introducing another application shell:

### Workspace

- Home
- Capability Library
- Authoring
- Projects
- Publishing

### Organization Management

- Organization Overview
- Capability Assets
- Review Center
- Members and Invitations
- Spaces and Policies
- Security Center
- Audit Log
- Adoption Analytics
- Organization Settings

The existing Settings page continues to own local Agent paths, privacy, synchronization, diagnostics, and desktop updates. Organization Settings owns cloud organization/account lifecycle actions. Role-restricted navigation is hidden and server authorization remains authoritative.

## Capability Visibility Rules

Published and governance records are separate projections of the same capability data:

- Desktop Capability Library, Desktop Home available/recent lists, and Web Capability Market show only capabilities with a published or deprecated installable version.
- Draft, submitted, in-review, rejected, and changes-requested records appear only in Authoring, Capability Assets, Publishing, or Review Center.
- Organization Overview may count all governed assets, but labels must distinguish total assets, published capabilities, and pending reviews.
- Installation controls require an installable published version; a capability record alone never implies installability.

A shared predicate and tests enforce these rules on both surfaces.

## Review Workflow

Desktop Review Center reaches feature parity with Web and is the canonical owner/admin review experience. Selecting a publication loads in parallel:

- capability and target-space names;
- immutable candidate digest and semantic version;
- server security-scan report;
- structured added, modified, and removed paths versus the prior published version;
- existing review history when available.

Approve, request-changes, and reject actions require a reason of at least three characters. Owner and Admin users may review their own submissions when they hold review permission for the target space. The server remains the enforcement point for role, space access, digest consistency, and blocking findings.

## Governance Modules

Each governance module is a focused Desktop feature component backed by explicit `CloudClient` methods. Cloud-client methods keep Desktop's explicit session and organization arguments; UI components never construct authorization headers.

- Capability Assets supports metadata editing, version history, version comparison, deprecate, withdraw, and archive.
- Members supports invitations, revocation, organization-role changes, and removal.
- Spaces supports team/project creation, review-policy updates, membership roles, member removal, and archive.
- Security supports policy read/update, active sessions, session revocation, dead-letter inspection, and retry.
- Audit supports cursor pagination and action filtering.
- Analytics shows publication, installation, device, event, and daily adoption metrics.
- Organization Settings supports rename, identifiers, exports, ownership transfer, leave, closure/cancellation, and account deletion/cancellation.

Mutation handlers disable repeat submission, display server errors, and invalidate every affected query in `finally`-safe async flows. Destructive lifecycle actions require explicit confirmation text matching the server contract.

## Shared Contract and Drift Prevention

The product capability inventory is represented by stable identifiers in shared contracts. Web declares the identifiers it exposes; Desktop declares its full inventory. A contract test fails unless every Web identifier exists in Desktop. This protects the invariant when later Web features are added.

Cloud request/response payload types move to shared contracts when both surfaces use them. Surface-specific session handling stays within each app client. No Desktop component imports source code from `apps/web`, and no Web component imports from `apps/desktop`.

## State, Caching, and Errors

All organization-scoped query keys include the active organization ID. Organization switching clears or replaces every governance query before rendering the new organization. Successful mutations invalidate the smallest complete affected set; review approval invalidates publications, capabilities, versions, metrics, audit, and notifications.

Offline behavior is explicit:

- cached read-only governance pages may render with an offline status;
- governance mutations, review decisions, downloads, and installation plans are disabled offline;
- local authoring and scanning continue to work;
- server errors are shown as stable user-facing messages and never interpreted as empty organization state.

## Authorization

Desktop navigation mirrors Web role visibility:

- Owner and Admin: review, members, spaces, security management, audit, analytics, organization administration;
- Auditor: read-only security, audit, and analytics;
- Member: published market and authorized workspace operations;
- space roles continue to control team/project contribution and review actions.

Hiding a control is usability, not authorization. Every server mutation continues to validate organization membership, organization role, space permission, resource organization, and lifecycle state.

## Testing and Acceptance

Implementation follows test-first slices:

1. a shared parity test proves `Desktop capabilities ⊇ Web capabilities`;
2. visibility tests prove unpublished capabilities do not enter either market or Desktop Home;
3. review tests prove scan/diff context loads before an owner/admin decision and self-review is allowed for authorized roles;
4. each governance module has focused interaction tests for its reads, writes, pending state, errors, and role visibility;
5. cloud-client tests prove exact method, path, organization context, and request body;
6. Desktop end-to-end tests cover review-to-publication-to-install, membership/space governance, security/audit/analytics, and organization lifecycle confirmations;
7. existing API, Web, Desktop, CLI, adapter, container, and acceptance suites remain green;
8. the packaged signed Desktop application is installed and smoke-tested against the rebuilt local cloud stack.

## Delivery Sequence

The work ships as independently testable slices in this order:

1. shared capability inventory and published-visibility consistency;
2. complete Desktop Review Center;
3. Capability Assets and version lifecycle;
4. Members and Spaces governance;
5. Security, Audit, Analytics, and operations recovery;
6. Organization/account lifecycle and navigation completion;
7. full regression, container rebuild, signed Desktop bundle, installation, and runtime smoke tests.

No Web governance feature is removed. The result is one shared cloud governance model with Desktop as the functional superset and Web as the browser administration alternative.
