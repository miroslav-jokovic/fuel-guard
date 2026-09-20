# Handoff — dashboard template v2 → design system, 2026-09-20

**Read this, then `DASHBOARD-TEMPLATE-V2.md` beside it.** That plan is the decision log (D-DT1…
D-DT19, port plan T1–T13, open questions Q-DT1…Q-DT6); this file is only "where the work stopped".

---

## State

**Tranche 1 is MERGED TO MAIN.** PR #920, commit `6974947`, merge commit `3d4999f`, 2026-09-20.
All eight CI jobs green. Start from `main`; there is no outstanding branch.

> ⚠ This section said "Committed: NO. Pushed: NO. No PR." when the file was written, and was
> committed inside the very PR that made it false. A handoff that describes its own branch state
> is stale the moment it merges — describe what is IN MAIN, and let `git log` carry the rest.

The working tree at the time also carried unrelated untracked files (`docs/Kowlage-Base/`, the
`docs/design examples/*.png`, a modification to `docs/plans/mcleod/mail.md`). They were
deliberately left out of the commit and are **still uncommitted** — they are the user's, not this
work's.

What landed:

```
new   packages/ui/src/components/AppIconChip.vue
new   packages/ui/src/components/AppIconChip.test.ts
new   packages/ui/src/raw-imports.d.ts
mod   packages/ui/src/index.ts
mod   apps/web/src/components/ui/StatCard.vue            274 → 262 lines
mod   apps/web/src/components/ui/StatCard.test.ts
mod   apps/web/src/composables/useFindingsSummary.ts
mod   apps/web/src/features/dashboard/widgets/KpiHeroWidget.vue
mod   apps/web/src/features/dashboard/widgets/OperatingMetricsWidget.vue
mod   apps/web/src/pages/MaintenanceHomePage.vue
mod   apps/web/scripts/check-design-tokens.mjs
new   docs/plans/design-system/DASHBOARD-TEMPLATE-V2.md
new   docs/plans/design-system/prototypes/dashboard-v2.html
new   docs/plans/design-system/HANDOFF-2026-09-20-DASHBOARD-TEMPLATE.md   (this file)
```

## The artifact

`prototypes/dashboard-v2.html` — an interactive prototype of the whole redesign, built against the
product's own token sheet. **Serve from the REPO ROOT** or the tokens and fonts 404:

```bash
npx http-server -p 8080 .
open http://localhost:8080/docs/plans/design-system/prototypes/dashboard-v2.html
```

The one console 404 (`…/tailwindcss`) is expected — the token sheet's first line is a bare
specifier. It carries a light/dark toggle; both schemes and 1440/860 are verified.

---

## Done

**F1 — the chip tone vocabulary is closed.** `StatCard.tone` was an open Tailwind class string with
22 pairs hand-written across 5 files. `AppIconChip` now owns one map; seven tone NAMES identical to
`AppBadge`'s. **Deliberately a no-op on screen** — every class is the pair the call sites were
passing — so the restyle that follows is a few lines in one map instead of an edit to 22 places.

**F3 — `lint:tokens` now validates gradient stops.** `from|via|to` were in `UTIL_PREFIX` for the
banned-hue rule but missing from the unknown-colour-role rule, so `from-brand-900` passed clean.

Two corrections made along the way, both worth not re-deriving:

- `ReconcileTab`'s `tone` is **not** a chip — it is a local `Bucket` type carrying a `ring-*` class
  and 700/800 steps. An early count included it wrongly.
- The chip was drawn in **three** places, not one: StatCard's two branches plus
  `OperatingMetricsWidget`, which hand-rolled the span. All three now render `AppIconChip`.
- Two tiles ("Idle waste", "Declined attempts") were the only chips pairing caution-**700** with
  caution-50 against 20 others on 600. Folding them into the closed tone normalises them to 600 —
  **the one real pixel change in the refactor**, commented at both sites.

## Next, in order

| # | Work | Notes |
|---|---|---|
| **F2** | De-duplicate the well+pill recipe shared by `AppTabs` and `AppSegmentedControl`, then de-grey it **once** | Both render `rounded-surface bg-surface-muted p-*` + `bg-surface text-ink shadow-card`. Their semantics differ legitimately (tablist vs radiogroup — both files argue it well); only the LOOK should be shared. Target treatment is D-DT16 §4.2b: brand-tinted ground, brand text/icon/count on the selected tab |
| **F4** | A named elevation for the chip's coloured glow, then the gradient restyle (D-DT17 §4.2b) | `ELEVATION_ROLES` is `card\|card-raised\|overlay\|dialog\|sticky-edge`; `shadow-[…]` fails by design. ⚠ **Dark mode needs different ramp steps** — the dark ramps are non-monotonic (dark `success-400` is L 79%, `success-300` is 48%): light wants 500→700, dark wants roughly 300→200, or white-on-chip fails 3:1. Add the stops as role tokens in `packages/tokens/src/roles.{light,dark}.json`, then `pnpm gen:tokens` and **commit the regenerated `tokens.generated.css`** (`lint:codegen`) |
| **T4/T10** | `AppTabs` sliding pill — one element, `transform`+`width`, critically-damped spring | The prototype has a working 30-line spring. **Acceptance criterion: `AppTabs.test.ts` keeps passing untouched** — its roving tabindex / arrow-key contract is the whole reason the component exists |
| **T12** | The page backdrop (D-DT18/19) | ⚠ The layer must belong to **`AppShell`**, not the page: it sits behind bands the page renders, and `AppShell` owns the gutter the bleed negates. `meta.fullBleed` routes (the live map) must NOT get one |
| **T5/T6** | Trend readout + nice axis steps in `lib/chartTheme.ts` | T6 also affects `FleetTrendChart` — check the finance snapshots |

## Traps — read before starting

- **Q-DT6 (biggest).** `lint:tokens` scans `apps/web/src` **only**, so every primitive in
  `packages/ui/src` is unlinted for tokens; and its class-only rules read `class="…"` one **line**
  at a time, so multi-line `:class="[…]"` arrays — which most primitives use — are invisible to the
  radius/elevation/text-size/stacking/colour rules. Both were found by feeding the linter a
  violation. **If you "fix a gate" and it doesn't fire, check it can see your probe before
  concluding the rule is broken** — that mistake was made here once.
- **Q-DT5.** `@hugeicons/core-free-icons` ships 13,556 exports and **zero** duotone/solid variants.
  The prototype's glyphs are hand-drawn and must not be pasted into `packages/ui/src/icons.ts`.
  Recommendation: a curated ~16-glyph duotone set behind `AppIcon`, not a Pro licence.
- **Q-DT4 (blocker for the delta pill).** `useDashboard` never fetches a previous window, so three
  of the four KPI deltas have no data behind them, and "Active alerts" is current state and can
  never have one. That is DR2b, still queued. **Do not derive a delta from the sparkline's series** —
  different window, a figure that looks right and is not.
- `pnpm --filter @silvicom/web build` fails locally on missing `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`. Verified identical on a stashed clean tree — environment, not code.
  `vue-tsc` (the half that matters) passes.
- `.impeccable/config.json` is **gitignored**. It holds a `layout-transition = *` ignore scoped to
  the prototype file (a regex false positive on `stroke-width`). Won't travel; re-add if needed.
  ⚠ `ignore-value` only matches rules in `hook-lib.mjs`'s `directValueRules`; for anything else the
  value-scoped form silently never fires and you need `--file` with `*`.

## Gates

Locally: `lint:tokens` · `lint:ui-adoption` · `lint:filesize` · `lint:boundaries` ·
`lint:comment-claims` · ESLint · `vue-tsc` on web + ui + admin · web tests 2081 · ui tests 95.
In CI, all eight jobs on run 35533388327: `gates`, `typecheck-build`, `test-api`, `test-web`,
`test-packages`, `matrices`, `native-android`, `build`.

⚠ **`lint:comment-claims` failed on the first commit attempt and is worth knowing about.** The new
`raw-imports.d.ts` named `AppIconChip.test.ts` without quoting a test title, and the gate did not
fire until the file was `git add`ed — untracked files are invisible to it. Fixed by citing the real
title. **`git add` a new file BEFORE running the gates**, or a gate you believe you have satisfied
has simply not looked.

⚠ `pnpm --filter @silvicom/web build` fails locally on missing `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY`; CI's `typecheck-build` is the job that proves the build, and it passed.

⚠ `pnpm lint` is **not** the gate set (`lint:boundaries` and `lint:filesize` fail CI independently),
and `lint:tokens` is an `apps/web` script — `pnpm --filter @silvicom/web lint:tokens`, never a bare
root call.

## House rule that shaped this work

Every claim in the plan and in the new code comments is measured, and tests were proven to fail by
mutation before being trusted (three mutants on `AppIconChip.test.ts`: add a badge tone → red,
drift one value → red, change the default → red). Keep that standard: `cp` bytes back to revert a
mutation — `git checkout --` restores nothing on an untracked path and discards new tests.
