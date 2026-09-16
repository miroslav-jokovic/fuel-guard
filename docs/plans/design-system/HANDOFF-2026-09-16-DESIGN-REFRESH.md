# Handoff — design refresh, 2026-09-16

**START HERE** for the comp-driven redesign. Read this, then
`docs/plans/design-system/DESIGN-REFRESH-2026-09.md` — and in that document read **§7, the dated
progress log at the END**, not the tables in §3. The tables say what a step IS; the log says what
actually happened to it, including three rulings that were corrected after being written down and
one whole step whose description was two-thirds wrong.

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
| — | Handoff document | #822 | `ca46a18` |
| **DR5** | Live map → full-bleed workspace: `meta.fullBleed`, floating panels, fleet dock | #823 | `96efd06` |
| **DR3** | Fuel spend becomes bars; MPG gains its terminal dot; washes halved | #824 | `7e7842c` |

Everything above is merged, gate-green, and was looked at in a browser. The visible result: violet
brand, 12px card radii, shadow-defined cards, a near-white rail, a greeting over a photograph, KPI
tiles that lead with their icon, a live map that fills the page with floating panels over it, and a
dashboard whose spend card is a bar chart.

---

## 2. What is next

Nothing is blocked. In rough order of value:

- **DR7 — roll the DR1–DR3 anatomy across the other pages.** The broadest remaining step and the one
  that makes the refresh look finished rather than partial: the dashboard now looks like comp (3)
  and the other ~60 pages do not. Scope it page by page, not all at once.
- **`OperatingMetricsWidget`'s 1280px truncation.** Genuinely pre-existing (unlike D-DR17's, which
  was a DR2 regression pretending to be pre-existing — see §4). Eight-up grid, no sparkline in it,
  so the D-DR17 fix does not apply. Small and self-contained.
- **D-DR8 — the dark basemap.** `explore.night` is one parameter, but the parameter is hardcoded
  server-side in `apps/api/src/modules/routing/routes/mapProxies.ts`, so this is an API change with
  its own deploy window. Satellite stays Q-DR2.
- **DR5's three follow-ups**, at the end of the plan's §7: `useTableColumns` onto `useDeviationSet`;
  the 28px of scroll a banner costs a full-bleed page; Fuel Planning as `fullBleed`'s second
  consumer.
- **DR2b — the delta pill.** ⚠ Still blocked on DATA, not on design: `useDashboard` runs eight
  range-scoped queries and never fetches a previous window, and "Active alerts" is current-state so
  it cannot have a delta even in principle. `DeltaPill.vue` and its helpers are drafted and waiting.
- **DR4b — the global ⌘K search.** A feature, not a style: there is no command palette, no global
  search component and no search endpoint anywhere in `apps/web`.

---

## 3. Open questions — the owner's, not the next session's

- **Q-DR1 — does the driver app take the brand hue rotation?** DR1 was web-only. The driver app's
  colours come from its own `apps/driver/src/theme/theme.roles.json`, and `lint:token-schema` pins
  only the 14 shared neutral roles, so the two can diverge with NO gate firing. Recommendation:
  rotate both. **It is identity — do not decide this for them.**
- **DR3's bars read heavier than the comp**, and that is a deliberate trade the owner may want to
  reverse. Both comps draw the spend bars violet and pastel; `--viz-spend` is emerald at full
  strength. Measured 2026-09-16: **the comp's own bars sit at 1.9:1 against white**, and our emerald
  lightened to the comp's tint ratio would sit at **1.66:1** — under the 3:1 this repo requires of a
  mark, and it is the only mark on that chart. Reversing it is one line in
  `SpendTrendWidget.vue`'s `backgroundColor` and means accepting a sub-2:1 mark.
- **Which hero plate?** `highway-dawn.webp` shipped as the dashboard's. `coast-mist.webp` sits
  closer to the new violet; `prairie-dusk.webp` is the warm one. All three measured ≥9.2:1 for
  `--ink` over the zone the greeting occupies.
- **Q-DR2** — is `satellite.day` in our HERE plan? Decides how much of comp (7)'s basemap switcher
  is real. `explore.night` is certain (one parameter on `mapProxies.ts`).
- **Q-DR3 — does the dashboard get comp (2)'s right rail?** D-DR0 says no for now because LM10's
  layout editor owns that decision. Revisit once DR7 has rolled the new anatomy out.

---

## 4. Traps this programme paid for — do not re-learn these

**⚠ A comp PNG is COUNTED, not looked at. A 1px stroke antialiases across two rows and lies twice.**
DR3 measured comp (3) and got two wrong answers from reading the image before counting pixels
settled both: its gridline looked half the weight of ours (9 vs 17 levels below white) until the two
adjacent rows summed to exactly `--ramp-neutral-100`, which is what we already use; and its MPG line
looked like it carried a dot on every point until a per-column dark-pixel count came back uniform at
1–3, with 4 only at the final point. **Reading the picture was wrong both times.** Recipe in §5.

**⚠ A comparison against `main` proves nothing once the change under test is in `main`.** The 1280px
KPI truncation was written up as a DR2 regression, withdrawn as "pre-existing" after building `main`
and seeing identical truncation, and was a DR2 regression all along — `main` had held DR2 since #819.
Rebuild at the commit BEFORE the change. Cost: two wrong conclusions stated to the owner.

**⚠ Measure the DOM, not a screenshot.** `scrollWidth - clientWidth` per label settled in one call
what two rounds of screenshots had not. `truncate` fails SILENTLY — nothing errors, nothing warns.

**⚠ A viewport breakpoint inside a small container inverts the decision. This bit twice.** D-DR17
(the KPI tile is 410px wide at a 900px viewport and 220px at 1280px, so "inline above `xl`" switches
the inline layout ON where it does not fit) and then `FilterBar` inside DR5's 288px floating panel,
whose `lg:w-64 lg:shrink-0` all fire on a 1512px screen and give it a horizontal scrollbar. ⚠ But
the live map's panel CORNERS genuinely are a viewport question, because the map is the viewport:
measured 193px of overlap at 390px, so below `sm` the panel layer is one scrolling column.

**⚠ `DataTable`'s scroll area is `max-h-[70vh]` — a VIEWPORT measurement.** Put it in any fixed
box shorter than that and every row past the box is clipped and unreachable, sticky header and all,
with nothing thrown and nothing warned. DR5 added a `fill` prop for exactly this.

**⚠ A ruling in a canonical plan can be wrong. D-DR6 was wrong twice.** First it said panels store a
position (no column exists); then it still said they use `user_dashboard_layout` at all, and they
cannot — `PUT /api/dashboard-layout` refuses any key outside `DASHBOARD_WIDGETS`, and
`check-surfaces.mjs` asserts in both directions that every entry names a real tab and a real
component. Read §4.1 of the plan before building on any of its rulings.

**⚠ A merge that was reported done may not have landed.** #818 was reported merged while
`state=OPEN, mergedAt=null` and `main` had not moved. Check three things: `gh pr view N --json
state,mergedAt,mergeCommit`, `gh api repos/.../commits/main`, and that the local tree has the files.
(`--json merged` is not a valid field.)

**⚠ The Playwright viewport resets between navigations.** Two "comparisons" were taken at different
widths and proved nothing. Resize immediately before measuring, and assert `window.innerWidth` in
the same call as the measurement.

**⚠ Sequencing invisible work first is a real cost.** DR1 + DR2 + DR6 merged with almost nothing
visible on screen — DR6 committed three images three PRs before anything displayed them. The owner
pushed back, correctly. If a step has no visible payoff, say so when proposing it.

**⚠ `git add -A` in this working tree sweeps up other sessions' files.** Two unrelated
`docs/Kowlage-Base/` docs landed in a commit and had to be pulled back out. Stage by path.

**⚠ `gh pr merge --delete-branch` checks out `main` under you.** The working tree changes mid-command
and the editor's diagnostics briefly report every new file as missing. That is the checkout, not a
broken merge — verify with the three checks above rather than reacting to it.

---

## 5. Recipes

**See the app** (`vite dev` is broken on this machine, `build` + `preview` is not):
```bash
cd apps/web && set -a && . ./.env && set +a && \
  VITE_DEV_BYPASS=true npx vite build && VITE_DEV_BYPASS=true npx vite preview --port 4173
```

⚠ **Dev-bypass renders the shell and nav with all-zero data.** The dashboard's charts are EMPTY
under it, and its data comes from PostgREST (`supabase.from`), not `/api/`. To see a chart you must
mock both:

```js
// The MCP browser has no page.route — use browser_run_code_unsafe.
await page.route('**/rest/v1/**', async (route) => {
  const table = /\/rest\/v1\/([a-z_]+)/.exec(route.request().url())?.[1] ?? '';
  // ⚠ Only answer the FIRST page, or fetchAllPaged loops forever on a mock that never shortens.
  const first = (route.request().headers()['range'] ?? '0-').startsWith('0-');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(table === 'fuel_transactions' && first ? rows : []) });
});
// Fleet MPG is an API route, and its envelope is { ok, data: { grain, periods, total } }.
// ⚠ `periods`, not `weeks`.
```

**Count a comp's pixels** (there is no PIL on this machine and Playwright blocks `file:`):
```bash
sips -s format bmp "docs/design examples/<comp>.png" --out /tmp/c.bmp
# then parse the 54-byte BMP header in plain Python: offset at 10, w/h at 18, bpp at 28.
# Rows are bottom-up unless height is negative; stride is ((w*3+3)//4)*4.
```
Remember the antialiasing rule in §4: a 1px line's ink is spread over two rows, so sum them before
concluding anything about a stroke's weight.

**Measure a layout defect** — resize, then read the DOM in the same call:
```js
[...document.querySelectorAll('dl.grid p.truncate')].map(p => ({
  text: p.textContent.trim(), short: p.scrollWidth - p.clientWidth,
}))
```

**Gates worth running before pushing UI work**, all from the repo root:
```
pnpm lint:ui-adoption   pnpm lint:ui-contrast   pnpm lint:comment-claims
pnpm lint:filesize      pnpm lint:funcsize      pnpm lint:template-integrity
pnpm lint:boundaries    pnpm lint:surfaces      pnpm lint:chart-colors
node apps/web/scripts/check-design-tokens.mjs
```
For token work add `lint:codegen`, `lint:tokens-parity`, `lint:token-schema`, `lint:token-gamut`.

⚠ **`lint:tokens` is an `apps/web` script, not a root one.** A bare `pnpm lint:tokens` from the root
fails with "Command not found" and reads as "this gate does not exist" — it does, it is
`check-design-tokens.mjs`. Use `--filter @silvicom/web`, or run the script directly as above.

⚠ **`lint:ui-adoption` counts EVERY raw `<button>` in pages and features, with zero tolerance**, and
requires a `PageHeader` on every routed page. DR5 made that second exemption derive from
`meta.fullBleed` rather than a hand-written list, so a new full-bleed page needs no gate edit.

**The `apple-design` skill** is installed at `.claude/skills/apple-design/` and is what D-DR9/D-DR10
lean on for DR5's translucent panels and interruptible motion. **The `dataviz` skill** is what DR3's
form question ("is this a bar or a line?") is answered from.
