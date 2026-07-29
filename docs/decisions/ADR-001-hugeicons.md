# ADR-001: HugeIcons as the single icon system

- **Status:** Accepted (2026-07-29)
- **Deciders:** Miki
- **Supersedes:** partially supersedes plan D40 (Material Symbols for the driver app) — see §Driver app below

## Context

FuelGuard's icon story was fragmented:

- **Dashboard (`apps/web`, Vue 3)** used `@heroicons/vue` 2.2.0 across 45 files and ~300 references. Two variants were in play: `/24/outline` (dominant) and `/20/solid` (small inline glyphs).
- **Driver app (`apps/driver`, retired/rebuilding)** — never actually shipped Lucide despite two planning-doc mentions. Prior decision D40 locked Material Symbols; that decision was made before HugeIcons was evaluated.
- **Admin app (`apps/admin`)** used no icons yet.

The Heroicons set is functional but visually generic. HugeIcons Stroke Rounded produces a more distinctive, on-brand look for a logistics/fuel product, and their free tier is unusually complete (5,400+ glyphs, MIT-licensed, unrestricted commercial use, no attribution required).

## Decision

1. Standardise on **HugeIcons Stroke Rounded, free tier** as the single icon system for every FuelGuard app.
2. Consume via `@hugeicons/vue` + `@hugeicons/core-free-icons` on the web side; when the driver app is rebuilt, use `@hugeicons/react-native` against the **same** `@hugeicons/core-free-icons` data package so one icon inventory serves both products.
3. Introduce an `AppIcon` wrapper component in `@fuelguard/ui` that preserves the existing Tailwind `size-* text-*` convention — icons continue to be styled with utility classes, not props.
4. Introduce an `@fuelguard/ui/icons` barrel that re-exports every icon we use under a stable local name. All feature code imports from the barrel; nothing imports from `@hugeicons/core-free-icons` directly.
5. Remove `@heroicons/vue` from the codebase entirely. No dual-icon-library period.

## Rationale

- **Legally clean.** HugeIcons free tier is MIT — no attribution requirement, unrestricted commercial use, no per-seat licensing.
- **Better fit.** Stroke Rounded feels less generic than Heroicons outline and aligns with a modern operational-tool aesthetic (JB Hunt, Samsara, Motive).
- **One system for two products.** The free-icons *data* package is framework-agnostic, so the same glyphs render identically on the Vue web app and a future React Native driver app. That is worth more than the marginal advantage Material Symbols has as a self-hosted variable font.
- **Barrel indirection is cheap and pays back.** Locking icon choice at one file means designers can swap a variant (`Truck01` → `TruckDelivery`) without touching feature code. It also gives us a one-file upgrade path to HugeIcons Pro (10 styles) if we ever need it.
- **Wrapper preserves the existing DX.** The old `<CheckCircleIcon class="size-5 text-success-500" />` becomes `<AppIcon :icon="CheckCircleIcon" class="size-5 text-success-500" />`. Zero conceptual change for anyone who wrote the pre-2026-07 code.

## Consequences

**Positive**

- One icon vocabulary across web, admin, and (future) driver — no "which package do I import from?" question.
- Visual refresh across the entire dashboard with no per-page redesign.
- Bundle-neutral (tree-shaken; each icon ~1 KB).
- Future variant swaps and Pro upgrades are one-file changes.

**Negative / trade-offs**

- **Small solid-glyph regression.** Heroicons `/20/solid` at very small sizes (e.g. `size-3.5`) was visually crisper than the free-tier stroke equivalent. Acceptable for v1; upgrade to HugeIcons Pro (Solid Rounded) is available if a specific glyph reads poorly.
- **6–8 icon variants need human eyeballs.** Several mappings in `packages/ui/src/icons.ts` are marked `// ⚠ verify` — the concept has multiple HugeIcons variants and the current pick is a reasonable default, not a designer's choice. See §Follow-ups.
- **Driver app plan D40 is superseded** for the icon layer (the plan's font/tokens strategy still stands).

## Driver app

D40 previously locked the driver app on Material Symbols. That decision was made before HugeIcons was on the table. This ADR supersedes D40 **for icons only**: when the driver app is rebuilt, use `@hugeicons/react-native` + `@hugeicons/core-free-icons`. All other D40 provisions (self-hosted variable typeface, hand-authored tokens, `lint:tokens`) stand unchanged.

Because the driver source doesn't exist at the time of this ADR, no code changes ship on that side today. When the driver rebuild starts, follow the same pattern:

```tsx
import { HugeiconsIcon } from "@hugeicons/react-native";
import { TruckIcon } from "@fuelguard/ui/icons";  // same barrel, RN-safe

<HugeiconsIcon icon={TruckIcon} color={theme.brand} size={20} />
```

The `@fuelguard/ui/icons` barrel is safe to import from React Native — it only re-exports data arrays.

## Migration

- One PR with everything: adds packages, adds `AppIcon`, adds barrel, codemods 45 files, removes `@heroicons/vue`. Reverting is a single `git revert`.
- Codemod lives at `apps/web/scripts/codemod-hugeicons.mjs` and is idempotent. Delete the script after the PR lands.
- Verify visual parity via the existing Playwright E2E snapshots on 3–4 key pages (Dashboard, Loads, Fuel Planning, Sidebar).

## Follow-ups

- 20-minute designer pass over the `// ⚠ verify` rows in `packages/ui/src/icons.ts`.
- Add an ESLint rule (or `docs/DESIGN-SYSTEM.md` note + review discipline) that bans imports of `@heroicons/*`, `lucide-*`, and `@hugeicons/core-free-icons` outside `packages/ui/src/icons.ts`.
- When the driver rebuild starts, thread `@hugeicons/react-native` through the same barrel.

## Sources

- [HugeIcons monorepo (MIT)](https://github.com/hugeicons/hugeicons)
- [@hugeicons/vue on npm](https://www.npmjs.com/package/@hugeicons/vue)
- [@hugeicons/core-free-icons on npm](https://www.npmjs.com/package/@hugeicons/core-free-icons)
- Prior plan: `docs/plans/drivers-app/DRIVER-APP-PLAN.md`, decisions D18 / D23 / D40
