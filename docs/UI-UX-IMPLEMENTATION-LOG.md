# FuelGuard UI/UX implementation log

## Slice 1 — verified foundations and reversible prototype

**Date:** August 11, 2026

**Scope:** Phase 0 evidence tooling and the color/sidebar decision prototype
**Production visual impact:** none

### Implemented

- Added `pnpm audit:ui`, backed by `scripts/ui-system-inventory.mjs`, to reproduce the page, component, typography, radius, raw-control, and table inventory from current Vue source.
- Captured the current page-by-page adoption baseline in `docs/UI-COMPONENT-ADOPTION.md`.
- Added `pnpm lint:ui-contrast`, backed by `scripts/check-ui-contrast.mjs`, with 22 required semantic pairs.
- Added the contrast gate to `.github/workflows/ci.yml`.
- Added isolated `--prototype-*` values to the web stylesheet. Existing production roles are unchanged.
- Added a development-only `/__design-system` lab containing dashboard priorities, a unified data workspace, representative statuses, and a settings form.
- Added A/B controls for graphite versus gold primary actions and light versus graphite sidebars.
- Kept the lab out of normal production routing and verified that its JavaScript/CSS chunks are absent from a default production build.

### Rendered verification

The lab was inspected at 1280×720, 900×720, and 390×844.

- No horizontal document overflow at 390px.
- The mobile layout hides the sidebar and reduces the KPI strip to one column.
- The 900px prototype initially collapsed text navigation into unclear initials. It was corrected to retain a compact 192px labeled rail until the mobile breakpoint.
- The selected control exposes a computed `2px solid` focus outline using `--prototype-focus`.
- No browser console errors or warnings were emitted.
- Both primary-action candidates meet text contrast. In the rendered comparison, the gold CTA is visually close to the warning/attention family; graphite preserves gold as a more distinctive identity accent. This is an observed design risk, not a substitute for stakeholder/user approval.
- Both sidebar candidates are readable. The light rail produces a quieter continuous workspace; the graphite rail produces stronger navigation separation. The preferred tradeoff remains a decision gate.

### Automated verification

- ESLint: pass.
- Prettier: pass.
- File-size budget: pass.
- Web token lint: pass.
- Shared-token parity: 197 declarations, pass.
- Prototype contrast: 22/22 pairs pass.
- Web typecheck: pass.
- Web unit tests: 17 files and 127 tests pass.
- Web production build: pass.
- Production-bundle lab exclusion: pass.
- Git whitespace validation: pass.

### Deliberately not changed

- No production semantic token was repointed.
- No existing `brand-*`, caution, warning, sidebar, component, or page styling was globally changed.
- No font was added or replaced.
- No representative-user preference or fatigue result is claimed.

### Decisions required before Slice 2

1. Primary action: graphite (recommended) or gold.
2. Sidebar: light or graphite.
3. Typography: retain Hanken Grotesk (recommended for the first migration) or separately evaluate/licence Switzer.

After these decisions, Slice 2 can promote the selected values into canonical semantic roles and migrate the shared Button, Input, focus, and control-border contracts without guessing.

## Slices 2–6 — production migration and closure audit

**Date:** August 11, 2026
**Scope:** canonical tokens, shared primitives, page/shell migration, enforcement, and release-candidate verification

### Decisions promoted to production

- The supplied warm-gold family is the identity accent; graphite is the primary action. Warning, danger, success, information, focus, and selection remain separate semantic roles.
- The light navigation rail and Hanken Grotesk were selected through the approved implementation path. Hanken is backed by repository font files; no unverified Switzer dependency was introduced.
- Radius is role-based (`detail`, `control`, `surface`, `overlay`, `dialog`) rather than one global rounded value. Ordinary surfaces are flat/bordered; shadow remains for overlays and explicit emphasis.

### Foundations and shared components

- `packages/ui/src/tokens.css` is the only shared token source. Web and admin import it; CI rejects mirrored declarations or consumer overrides.
- `@silvicom/ui` now owns Button, IconButton, Surface/Card, TextField/Input, NumberField, TextArea, Checkbox, RadioGroup, Switch, Select, Combobox, SearchField, DateField, DateTimeField, DateRangePicker, InputGroup, FormField, Badge, Table, and PageHeader.
- The web-local Button, Card, Input, Checkbox, Switch, Select, Combobox, SearchInput, and FormField clones were removed after imports moved.
- Form/date/select inconsistencies were migrated to the shared implementations. Filter and date clear controls are siblings rather than nested interactive elements; combobox/filter keyboard contracts cover arrows, Home/End, Enter/Space, Escape, and Tab.
- Vue accessibility linting and an axe-core primitive smoke test are part of the repository gate.

### Shell, pages, and density

- The shell uses one light sidebar account menu and one content-level PageHeader; duplicate account actions were removed.
- Forty-nine of 56 web pages use PageHeader. The seven exact exceptions are four authentication pages, the public placard tool, an embedded non-routed drawer form, and an unrouted placeholder; the inventory gate rejects any additional exception.
- Dashboard priority is four hero KPIs plus one compact secondary metric strip. Settings uses sectioned, flat navigation. Transactions, Drivers, Vehicles, and Trailers use one integrated DataWorkspace surface.
- All seven formerly visible web-local tables and all three admin tables use the shared table wrapper. The three remaining raw web tables are intentionally screen-reader-only chart fallbacks.
- Admin uses the shared font, token layer, PageHeader, Table, Badge, and responsive light-rail shell.

### Machine-verified closure

- UI adoption: 56 web pages, six admin pages, 49 PageHeader adopters, zero raw page/feature controls, zero visible raw web tables, zero raw admin tables, zero deprecated `text-ink-subtle`, and three documented chart fallbacks.
- Contrast: all 20 shipped semantic pairs pass; ordinary text ranges from 4.72:1 to 17.84:1, control boundaries pass 3:1, and focus passes 4.88:1 or better on shipped backgrounds.
- Charts: critical/high/medium/low colors pass white contrast and automated protan, deutan, and tritan separation thresholds.
- Static checks: ESLint including Vue accessibility, file-size, function-size, token lint, token ownership, UI adoption, typecheck, and `git diff --check` pass.
- Tests: all workspace unit suites pass (including 135 web tests and the axe smoke), and all four behavioral matrices pass: duty sessions 25/25, hazmat RLS 38/38, load lifecycle 61/61, and tenant RLS 375/375.
- Builds: the complete monorepo production build passes; web and admin emit the repository-backed Hanken fonts. The design-system lab is absent from the default production bundle.
- Rendered lab checks passed at 1280×720, 900×720, 390×844, and a 640×360 reflow approximation: no horizontal overflow, clipped controls, duplicate IDs, nested interactive elements, or console warnings/errors were found. The 390px minimum rendered control height was 32px and primary controls remain 36px.

### Operational validation not simulated

The code implementation has no unresolved repository blocker. Representative all-day user testing with production-like data—scan time, missed alerts, task errors, and perceived fatigue—is a post-deployment product validation activity and is not represented as an automated result. Forced-colors and reduced-motion rules are shipped and statically verified; this environment did not expose active forced-colors emulation, so an assistive-technology workstation walkthrough remains a release-operations check rather than a hidden pass claim.
