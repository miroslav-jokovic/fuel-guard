# Handoff — design refresh, 2026-09-16

**START HERE** for the comp-driven redesign. Read this, then
`docs/plans/design-system/DESIGN-REFRESH-2026-09.md` — and in that document read **§7, the dated
progress log at the END**, not the tables in §3. The tables say what a step IS; the log says what
actually happened to it, including two rulings that were corrected after being written down.

⚠ This file will go stale the moment the next step lands. It is a pointer and a list of traps, not a
status board. Where it names a position, `git log` and the plan's §7 outrank it.

---

## 1. What shipped, and where `main` is

| step | what | PR | `main` after |
|---|---|---|---|
| **DR1** | Brand hue +21°, shape ladder doubled, `elevation-card` second layer, sidebar lifted above canvas | #818 | `8275964` |
| **DR6** | Three hero plates in `apps/web/public/hero/` | #818 | `8275964` |
| **DR2** | `StatCard` hero anatomy — chip left at `size-10`, `font-bold` value, opt-in inline spark | #819 | `f7b6ad2` |
| **DR4** | Section chevron moved right; dashboard greeting + hero band; actions moved to top of band | #820 | `c8fd02d` |
| **D-DR17** | Inline spark wraps instead of squeezing the label (fixes a DR2 regression) | #821 | `6104de9` |

Everything above is merged, gate-green, and was looked at in a browser. The visible result: violet
brand, 12px card radii, shadow-defined cards, a near-white rail, a greeting over a photograph, and
KPI tiles that lead with their icon.

---

## 2. What is next

**DR5 — the live map becomes a workspace.** Largest remaining piece; the plan's §4 carries its
rulings. Two of them were CORRECTED before any code was written, and the corrections are the
important part:

- **D-DR5 (amended).** Do NOT add `layout: "canvas"` to `meta.layout`. That field already means
  *which shell entirely* — `auth`, `public`, `apply`, `lab`, `shop` each REPLACE `AppShell`
  (`apps/web/src/lib/layout.ts`, `resolveLayout`). The live map still wants the sidebar and top bar.
  Use a separate `meta.fullBleed` read INSIDE `AppShell`; its outlet is
  `<main class="py-6"><div class="w-full px-4 sm:px-6 lg:px-8">` (`AppShell.vue:370`).
- **D-DR6 (half wrong as written).** `StoredDashboardLayout` holds `widgetKeys` + `hiddenKeys` only
  — **no position field**, and migration 0343 has no column for one. Open/closed reuses perfectly;
  placement does not. Give panels FIXED corners (which comp (7) draws anyway) so only open/closed
  persists and no migration is needed.

Also queued, each its own step: **DR2b** (delta pill + the previous-period query it needs — the
dashboard has NO period comparison today), **DR3** (chart gradients), **DR4b** (global ⌘K search —
a feature; no palette, component or endpoint exists), **DR7** (roll the anatomy across other pages),
and **`OperatingMetricsWidget`'s 1280px truncation** (genuinely pre-existing, eight-up grid).

---

## 3. Open questions — the owner's, not the next session's

- **Q-DR1 — does the driver app take the brand hue rotation?** DR1 was web-only. The driver app's
  colours come from its own `apps/driver/src/theme/theme.roles.json`, and `lint:token-schema` pins
  only the 14 shared neutral roles, so the two can diverge with NO gate firing. Recommendation:
  rotate both. **It is identity — do not decide this for them.**
- **Which hero plate?** `highway-dawn.webp` shipped as the dashboard's. `coast-mist.webp` sits
  closer to the new violet; `prairie-dusk.webp` is the warm one. All three measured ≥9.2:1 for
  `--ink` over the zone the greeting occupies.
- **Q-DR2** — is `satellite.day` in our HERE plan? Decides how much of comp (7)'s basemap switcher
  is real. `explore.night` is certain (one parameter on `mapProxies.ts`).
- **DR5 storage naming** — `livemap.*` keys in `user_dashboard_layout` need no migration and fit the
  existing namespace (`dispatch.live-map`), but make the table's NAME overstate its scope. Renaming
  is the four-step dance. Recommendation: reuse and accept the naming debt.

---

## 4. Traps this session paid for — do not re-learn these

**⚠ A comparison against `main` proves nothing once the change under test is in `main`.** The 1280px
truncation was written up as a DR2 regression, withdrawn as "pre-existing" after building `main` and
seeing identical truncation, and was a DR2 regression all along — `main` had held DR2 since #819.
Rebuild at the commit BEFORE the change. Cost: two wrong conclusions stated to the owner.

**⚠ Measure the DOM, not a screenshot.** `scrollWidth - clientWidth` per label settled in one call
what two rounds of screenshots had not. `truncate` fails SILENTLY — nothing errors, nothing warns.

**⚠ A merge that was reported done may not have landed.** #818 was reported merged while
`state=OPEN, mergedAt=null` and `main` had not moved. Check three things: `gh pr view N --json
state,mergedAt,mergeCommit`, `gh api repos/.../commits/main`, and `git branch -r --contains <sha>`.
(`--json merged` is not a valid field.)

**⚠ The Playwright viewport resets between navigations.** Two "comparisons" were taken at different
widths and proved nothing. Resize immediately before measuring, and assert `window.innerWidth` in
the same call as the measurement.

**⚠ Sequencing invisible work first is a real cost.** DR1 + DR2 + DR6 merged with almost nothing
visible on screen — DR6 committed three images three PRs before anything displayed them. The owner
pushed back, correctly. If a step has no visible payoff, say so when proposing it.

**⚠ `git add -A` in this working tree sweeps up other sessions' files.** Two unrelated
`docs/Kowlage-Base/` docs landed in a commit and had to be pulled back out.

---

## 5. Recipes

**See the app** (`vite dev` is broken on this machine, `build` + `preview` is not):
```bash
cd apps/web && set -a && . ./.env && set +a && \
  VITE_DEV_BYPASS=true npx vite build && VITE_DEV_BYPASS=true npx vite preview --port 4173
```
Dev-bypass renders the shell and nav with **all-zero data** — no sparklines, no values, and the
fleet report never leaves "Loading the overview…". Do not conclude a widget is missing from it.

**Measure a layout defect** — resize, then read the DOM in the same call:
```js
[...document.querySelectorAll('dl.grid p.truncate')].map(p => ({
  text: p.textContent.trim(), short: p.scrollWidth - p.clientWidth,
}))
```

**Gates worth running before pushing UI work**, all from the repo root:
```
pnpm lint:ui-adoption   pnpm lint:ui-contrast   pnpm lint:comment-claims
pnpm lint:filesize      pnpm lint:template-integrity
pnpm --filter @silvicom/web lint:tokens     # ← note the filter
```
For token work add `lint:codegen`, `lint:tokens-parity`, `lint:token-schema`, `lint:token-gamut`,
`lint:chart-colors` (those five ARE root scripts).

⚠ **`lint:tokens` is an `apps/web` script, not a root one.** A bare `pnpm lint:tokens` from the root
fails with "Command not found" and reads as "this gate does not exist" — it does, it is
`check-design-tokens.mjs`, and `apps/web/CLAUDE.md` is right about it. Use the `--filter`, or run
`node apps/web/scripts/check-design-tokens.mjs` directly.

**The `apple-design` skill** is installed at `.claude/skills/apple-design/` and is what D-DR9/D-DR10
lean on for DR5's translucent panels and interruptible motion.
