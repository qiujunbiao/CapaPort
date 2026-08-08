# CapaPort Logo Brand System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Portal Flow logo across Desktop, Web, favicons, installers, and the packaged macOS client from one deterministic SVG source.

**Architecture:** Canonical editable assets live in `brand/`; applications consume generated copies through small `BrandMark` and `BrandLockup` React components. Tauri CLI generates the platform icon matrix from one 1024×1024 SVG, and acceptance tests enforce required files, references, accessibility, and absence of the former placeholder marks.

**Tech Stack:** SVG, React 19, TypeScript 7, Vite 8, Vitest 4, Tauri 2, Rust, macOS bundle tooling

## Global Constraints

- Use Portal Flow: an open port outline plus three capability paths converging into one outbound path.
- Use `#15171D`, `#F7F4ED`, `#FF6426`, `#FF8A32`, and `#181A20`; small and high-contrast variants are monochrome.
- Keep `CAPAPORT` in the existing DM Mono stack, weight 600, letter spacing `0.12em`.
- All platform icons derive from `brand/capaport-app-icon.svg`; no AI bitmap is a canonical asset.
- Preserve at least 16% icon safety space and keep the logo recognizable at 16px.
- Remove `DoorMark`, `.door-mark`, and Lucide `DoorOpen` from runtime branding.
- Do not change product behavior, navigation, protocol names, package names, or application identifiers.

---

## File Structure

- `brand/*.svg`: canonical mark, monochrome mark, horizontal lockups, and application icon.
- `brand/README.md`: color, spacing, minimum-size, and regeneration contract.
- `scripts/sync-brand-assets.ts`: copies canonical SVGs and generated raster outputs into application public directories without changing their content.
- `tests/acceptance/brand-assets.spec.ts`: repository-level brand and platform-asset contract.
- `apps/web/src/components/brand.tsx`: Web `BrandMark` and `BrandLockup` interface.
- `apps/desktop/src/components/brand.tsx`: Desktop `BrandMark` and `BrandLockup` interface.
- `apps/{web,desktop}/public/brand/*`: generated application-facing files.
- `apps/desktop/src-tauri/icons/*`: Tauri-generated platform icon matrix.

### Task 1: Canonical Logo Sources and Asset Contract

**Files:**
- Create: `brand/capaport-mark.svg`
- Create: `brand/capaport-mark-mono.svg`
- Create: `brand/capaport-lockup-dark.svg`
- Create: `brand/capaport-lockup-light.svg`
- Create: `brand/capaport-app-icon.svg`
- Create: `brand/README.md`
- Create: `tests/acceptance/brand-assets.spec.ts`

**Interfaces:**
- Produces: canonical SVG files with `viewBox`, `role="img"`, and a `title` containing `CapaPort`.
- Produces: an app-icon SVG with a 1024×1024 view box and no external resources.

- [ ] **Step 1: Write the failing asset contract**

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const canonical = [
  'brand/capaport-mark.svg',
  'brand/capaport-mark-mono.svg',
  'brand/capaport-lockup-dark.svg',
  'brand/capaport-lockup-light.svg',
  'brand/capaport-app-icon.svg',
];

describe('CapaPort brand assets', () => {
  it.each(canonical)('%s is a standalone accessible SVG', async (path) => {
    const svg = await readFile(path, 'utf8');
    expect(svg).toMatch(/<svg[^>]+viewBox=/);
    expect(svg).toContain('<title>CapaPort');
    expect(svg).not.toMatch(/(?:href|src)=["']https?:/);
  });

  it('keeps the application icon on a 1024 square master', async () => {
    const svg = await readFile('brand/capaport-app-icon.svg', 'utf8');
    expect(svg).toContain('viewBox="0 0 1024 1024"');
    expect(svg).toContain('#15171D');
    expect(svg).toContain('#FF6426');
  });
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `pnpm vitest run tests/acceptance/brand-assets.spec.ts`

Expected: FAIL because the canonical files do not exist.

- [ ] **Step 3: Create the vector system**

Use one shared geometry: a rounded open port frame centered in the canvas and three orange input lines that merge into one right-facing output. Keep the outer app-icon background at `x=32 y=32 width=960 height=960 rx=216`; keep all mark geometry inside `x=168..856 y=168..856`. Build the lockups from the same geometry plus the exact text `CAPAPORT`; do not embed raster data, external fonts, filters, or shadows.

- [ ] **Step 4: Document usage constraints**

Record the exact palette, 16px minimum mark size, 16% app-icon safe zone, `0.28×` lockup gap, monochrome usage, prohibited transformations, and this regeneration command:

```bash
pnpm --dir apps/desktop exec tauri icon ../../brand/capaport-app-icon.svg --output src-tauri/icons
```

- [ ] **Step 5: Run the contract and verify GREEN**

Run: `pnpm vitest run tests/acceptance/brand-assets.spec.ts`

Expected: PASS.

### Task 2: Generated Brand Asset Pipeline

**Files:**
- Create: `scripts/sync-brand-assets.ts`
- Modify: `package.json`
- Create: `brand/generated/capaport-icon-180.png`
- Create: `brand/generated/capaport-icon-192.png`
- Create: `brand/generated/capaport-icon-512.png`
- Create: `apps/web/public/brand/*`
- Create: `apps/desktop/public/brand/*`
- Modify: `tests/acceptance/brand-assets.spec.ts`

**Interfaces:**
- Produces: `pnpm brand:assets`, a deterministic command that copies canonical SVGs and selected Tauri PNGs.
- Produces: `/brand/capaport-mark.svg`, `/brand/capaport-lockup-dark.svg`, `/brand/capaport-lockup-light.svg`, `/brand/favicon.svg`, `/brand/apple-touch-icon.png`, `/brand/icon-192.png`, and `/brand/icon-512.png` in both applications.

- [ ] **Step 1: Extend the failing contract**

Add an assertion that both public directories contain the seven required files and that each copied SVG is byte-for-byte equal to its canonical source.

- [ ] **Step 2: Run the contract and verify RED**

Run: `pnpm vitest run tests/acceptance/brand-assets.spec.ts`

Expected: FAIL with missing public brand files.

- [ ] **Step 3: Implement the sync command**

Implement `scripts/sync-brand-assets.ts` with `mkdir`, `copyFile`, and a small destination map. Copy `capaport-mark.svg` as both the normal mark and `favicon.svg`; copy both lockups; copy committed 180×180, 192×192, and 512×512 files from `brand/generated/` to the corresponding Web names. Throw a path-specific error when a source is absent.

Add this root script:

```json
"brand:assets": "tsx scripts/sync-brand-assets.ts"
```

- [ ] **Step 4: Generate and verify assets**

Run: `pnpm brand:assets && pnpm vitest run tests/acceptance/brand-assets.spec.ts`

Expected: both commands exit 0 and the asset contract passes.

### Task 3: Web Brand Components and Metadata

**Files:**
- Create: `apps/web/src/components/brand.tsx`
- Create: `apps/web/src/components/brand.test.tsx`
- Modify: `apps/web/src/features/auth/auth-page.tsx`
- Modify: `apps/web/src/app/web-app.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: `BrandMark({ tone?: 'dark' | 'light'; compact?: boolean })`.
- Produces: `BrandLockup({ tone?: 'dark' | 'light'; context?: string; compact?: boolean })`.

- [ ] **Step 1: Write failing component tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, BrandMark } from './brand';

describe('web brand', () => {
  it('renders an accessible lockup with optional context', () => {
    render(<BrandLockup tone="dark" context="CONTROL PLANE" />);
    expect(screen.getByRole('img', { name: 'CapaPort' })).toBeInTheDocument();
    expect(screen.getByText('CAPAPORT')).toBeInTheDocument();
    expect(screen.getByText('CONTROL PLANE')).toBeInTheDocument();
  });

  it('keeps a decorative compact mark out of the accessibility tree', () => {
    const { container } = render(<BrandMark compact />);
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @capaport/web test -- src/components/brand.test.tsx`

Expected: FAIL because `./brand` does not exist.

- [ ] **Step 3: Implement and integrate the components**

Render canonical SVGs through `<img>` elements and keep the text fallback in markup. Replace all three Lucide `DoorOpen` brand usages. Use `BrandLockup` on auth/setup/sidebar full states and `BrandMark` only for compact states. Remove the orange placeholder square styling while retaining existing layout sizes.

- [ ] **Step 4: Add Web metadata**

Add `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, and `manifest.webmanifest` references to `apps/web/index.html`; set the theme color to `#15171D`.

- [ ] **Step 5: Verify Web**

Run: `pnpm --filter @capaport/web test && pnpm --filter @capaport/web build`

Expected: PASS and `apps/web/dist/brand/` contains the published brand assets.

### Task 4: Desktop Brand Components and Metadata

**Files:**
- Modify: `apps/desktop/src/components/brand.tsx`
- Create: `apps/desktop/src/components/brand.test.tsx`
- Modify: `apps/desktop/src/features/auth/auth-screen.tsx`
- Modify: `apps/desktop/src/features/auth/organization-onboarding.tsx`
- Modify: `apps/desktop/src/app/desktop-app.tsx`
- Modify: `apps/desktop/src/styles.css`
- Modify: `apps/desktop/index.html`

**Interfaces:**
- Produces: the same `BrandMark` and `BrandLockup` props as Web, so visual behavior remains consistent even though each app owns its runtime component.

- [ ] **Step 1: Write failing Desktop tests**

Mirror the Web component contract and add assertions that compact rendering omits the visible wordmark while normal rendering exposes `role="img"` with `aria-label="CapaPort"`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @capaport/desktop test -- src/components/brand.test.tsx`

Expected: FAIL because the legacy `DoorMark` does not provide the new interface.

- [ ] **Step 3: Implement and replace legacy branding**

Replace `DoorMark` with `BrandLockup`, update all imports, replace `.door-brand`/`.door-mark` CSS with `.brand-lockup`/`.brand-mark`, and preserve sidebar expanded/collapsed dimensions. Use the light lockup on dark authentication and sidebar surfaces.

- [ ] **Step 4: Add Desktop metadata**

Add favicon and touch-icon references to `apps/desktop/index.html` and set theme color to `#15171D`.

- [ ] **Step 5: Verify Desktop UI**

Run: `pnpm --filter @capaport/desktop test && pnpm --filter @capaport/desktop build && pnpm --filter @capaport/desktop test:e2e`

Expected: all tests and build pass; the E2E suite retains existing product-flow behavior.

### Task 5: Tauri Platform and Web Raster Icons

**Files:**
- Replace/Create: `apps/desktop/src-tauri/icons/*`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `tests/acceptance/brand-assets.spec.ts`

**Interfaces:**
- Produces: Tauri icon files for macOS, Windows, Linux, and store packaging.
- Produces: an explicit `bundle.icon` list for the release pipeline.

- [ ] **Step 1: Extend the failing platform contract**

Assert the existence and non-zero size of `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, `Square30x30Logo.png`, `Square310x310Logo.png`, and `StoreLogo.png`. Assert `tauri.conf.json` references the three PNGs, `.icns`, and `.ico`.

- [ ] **Step 2: Generate the complete icon matrix**

Run:

```bash
pnpm --dir apps/desktop exec tauri icon ../../brand/capaport-app-icon.svg --output src-tauri/icons
```

Expected: Tauri reports generated PNG, ICNS, ICO, and Windows Store files.

- [ ] **Step 3: Configure bundle icons explicitly**

Set:

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

- [ ] **Step 4: Generate Web raster icons and resync**

Run:

```bash
sips -z 180 180 apps/desktop/src-tauri/icons/icon.png --out brand/generated/capaport-icon-180.png
sips -z 192 192 apps/desktop/src-tauri/icons/icon.png --out brand/generated/capaport-icon-192.png
sips -z 512 512 apps/desktop/src-tauri/icons/icon.png --out brand/generated/capaport-icon-512.png
pnpm brand:assets
```

Expected: the three generated PNGs have their declared dimensions and alpha; both applications receive all three.

- [ ] **Step 5: Verify the asset matrix**

Run: `pnpm vitest run tests/acceptance/brand-assets.spec.ts && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: PASS.

### Task 6: Documentation, Full Verification, macOS Packaging, and Push

**Files:**
- Modify: `README.md`
- Modify: `brand/README.md`
- Generated: `apps/desktop/src-tauri/target/release/bundle/macos/CapaPort.app`
- Generated: `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`

**Interfaces:**
- Produces: a locally installable macOS CapaPort app and DMG with the new icon.
- Produces: a GitHub `main` commit containing all source and generated brand assets; build outputs remain untracked.

- [ ] **Step 1: Add repository lockup and generation instructions**

Put `brand/capaport-lockup-light.svg` at the README top with `alt="CapaPort"`; document `pnpm brand:assets` and the Tauri icon generation command in `brand/README.md`.

- [ ] **Step 2: Run residual and format checks**

Run:

```bash
rg -n 'DoorMark|door-mark|<DoorOpen' apps/web apps/desktop --glob '!**/dist/**'
pnpm format:check
git diff --check
```

Expected: the residual scan has no matches; formatting and diff checks pass.

- [ ] **Step 3: Run full release verification**

Run: `pnpm release:verify`

Expected: exit 0 across brand, migrations, lint, typecheck, tests, security gate, builds, SDK drift, stack smoke, acceptance, and E2E.

- [ ] **Step 4: Build the local macOS client**

Run: `pnpm --dir apps/desktop exec tauri build --bundles app,dmg`

Expected: a `CapaPort.app` and CapaPort DMG are emitted under the target release bundle directory.

- [ ] **Step 5: Inspect packaged identity**

Run `plutil -p` on `CapaPort.app/Contents/Info.plist`, confirm `CFBundleDisplayName` is `CapaPort`, confirm `CFBundleIconFile` resolves to an existing ICNS under `Contents/Resources`, and render that ICNS to PNG with `sips` for visual inspection.

- [ ] **Step 6: Commit and push**

Stage only source, tests, documentation, generated public assets, and Tauri icons. Exclude `.superpowers/`, `dist/`, `target/`, `.app`, and `.dmg`. Run cached diff checks, commit with `feat: ship CapaPort logo brand system`, push `main`, and verify local HEAD equals `git ls-remote origin refs/heads/main`.
