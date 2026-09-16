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
| **DR5** | Live map → full-bleed workspace: `meta.fullBleed`, floating panels, fleet dock | #823 | `96efd06` |
| **DR3** | Fuel spend becomes bars; MPG gains its terminal dot; the washes halved | #824 | `7e7842c` |
| **DR7a** | Operating-metrics strip: the chip it always carried, a grid its captions fit in | #826 | `5512601` |
| **D-DR8** | The live map's basemap follows the reader's colour scheme | #827 | `2a00371` |
| **DR7b** | `RiskList` takes `ChartCard`'s header — the dashboard's last hand-rolled panel | #828 | *see `git log`* |

Everything above is merged, gate-green, and was looked at in a browser. The visible result: violet
brand, 12px card radii, shadow-defined cards, a near-white rail, a greeting over a photograph, and
KPI tiles that lead with their icon.

---

## 2. What is next

**DR7 was measured and it is NOT ~60 pages of work** — the plan's §3 row sizes it by the wrong unit.
83 route records → **77 page components**, of which **67 already render `PageHeader`** and the other
ten are each already gate-exempt for a reason that survives this programme. DR1 is tokens, so it
reached all 77 the moment #818 merged. What is left is four specific things touching ~12 pages, and
the full measurement is in the plan's §7.

**The owner narrowed DR7 to the Dashboard and the Dispatch live map on 2026-09-16, and both are now
finished.** The dashboard has no hand-rolled tile or panel chrome left, and the live map's one
remaining DR item (D-DR8) shipped. **Q-DR1 is RULED: the driver app takes no change** — so
`apps/driver/src/theme/theme.roles.json` stays where it is, and a later step that rotates it is
changing identity and should say so rather than treating it as a leftover.

Queued, each its own step, in rough order of value:

- **DR7e — the two MPG detail charts are outside the chart theme's OPTIONS layer entirely.**
  `DriverDetailPage` and `VehicleDetailPage` take `viz.brand` and `areaFill`, so DR3's wash
  recalibration reached them for free, but they build `options: { responsive, maintainAspectRatio }`
  and get no `trendOptions`: no themed gridline, no tick font, no inverse-surface tooltip,
  `pointRadius: 0` and no terminal dot. **This is DR3's one real miss**, and the only item in the
  DR7 group with a visible payoff rather than a de-duplication.
- **DR7d — `ChartCard` is trapped in `features/dashboard/`**; the three charts outside that feature
  each hand-roll its header. ⚠ It is also MISNAMED — what it owns is "a titled panel on the
  dashboard grid", not "a chart" (DR7b, §7). Do not read the name as a reason to write a fifth header.
- **DR7c — the KPI tile still has three sources of truth outside the dashboard.** `StatCard` (38 call
  sites, only two files using `size="hero"`), `features/fueling/FuelStatTile.vue` (a near-copy with
  one consumer) and **19 files hand-rolling ~47 `<dl>` tiles**. ⚠ Most already match `StatCard`'s
  `kpi` anatomy by coincidence, so this is de-dup and **not** a visible change — do not budget it as
  a redesign.
- **DR7f — `StatCard` has no `valueTone`.** `CoveragePage` and `IdlingPage` colour the VALUE by
  threshold and `tone`/`subTone`/`muted` cannot express it, so neither can convert without the
  variant. DR5's `DataTable fill` reasoning: the `:class` at the call site is the sign.
- **`RouteMapGL` (Fuel Planning) does not follow the colour scheme.** One line and the same
  `basemapStyleFor` call D-DR8 added — left out of #827 on purpose as a second consumer.
- **DR5's three follow-ups**, at the end of the plan's §7: `useTableColumns` onto `useDeviationSet`;
  the 28px of scroll a banner costs a full-bleed page; Fuel Planning as `fullBleed`'s second consumer.
- **DR2b — the delta pill.** ⚠ Still blocked on DATA, not design: `useDashboard` runs eight
  range-scoped queries and never fetches a previous window, and "Active alerts" is current-state so it
  cannot have a delta even in principle. `DeltaPill.vue` and its helpers are drafted and waiting.
- **DR4b — the global ⌘K search.** A feature, not a style: no command palette, no global search
  component and no search endpoint anywhere in `apps/web`.
- **Q-DR2 — is `satellite.day` in our HERE plan?** Still open, and now the ONLY basemap question:
  `explore.night` was confirmed by fetching a real tile (200, genuinely dark) while building D-DR8.
- **Q-DR4 — should the operating-metrics strip stay a strip?** Raised by DR7a. It is the one dashboard
  surface that is not a card, which is either the point of it or the last thing left to convert.


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
