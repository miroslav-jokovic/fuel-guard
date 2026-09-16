# Handoff — the live map, 2026-09-15 (evening)

**Start here for LM8.** This supersedes §1 of `docs/HANDOFF-2026-09-15.md` for the map thread. That
document's §5 (McLeod) is still current and still the blocker it describes; everything it says about
LM4 being "next" is done.

`main` is at **`26b2b42`**. Four PRs merged this session — **#806 (LM4)**, **#807 (LM5)**,
**#808 (LM6)**, **#809 (LM7)**. Migration **0342** is applied to production.

**Everything before LM8 is finished.** The map now has a collector filling it, a definition of what a
truck is doing, an endpoint that serves the board, and the plumbing to draw it. LM8 is the step that
draws it.

---

## 1. What is true in production right now

Measured 2026-09-16 01:24 UTC, not recalled:

| | |
|---|---|
| `vehicle_positions` rows | **199** |
| cursor advancing | yes — `samsara_feed_cursors.updated_at` is current to the second |
| fresh inside the 15-minute bound | **145** |
| past it (would render `offline`) | **54** |
| retired vehicles carrying a position | **28** |
| `loads` | **0** |

The collector has run continuously since #806 merged. A sample marker, for a sense of what the data
looks like: unit 670, 60.3 mph, heading 16°, Marion County OR, fix **2 seconds old**.

`GET /api/livemap/positions` assembles all 199 into a board in ~1.0 s **measured from a laptop** —
see §3, this is the one number still owed.

---

## 2. LM8, and the four things the plan does not know yet

The step is written at `docs/plans/livemap/LIVE-MAP-PLAN.md` §5 LM8. It is accurate except where this
section corrects it.

### 2a. The dispatcher filter cannot be built

LM8 lists filters "dispatcher, state, load status". **There is no dispatcher data and no loads.**
`tms_dispatchers` does not exist in the database — it is downstream of the McLeod
`VIEW CHANGE TRACKING` grant, still refused — and `loads` has 0 rows until LM12. So of the three
filters, only **state** has anything to filter on today.

Build the state filter. Leave the other two out rather than shipping two permanently-empty dropdowns;
an empty filter teaches a dispatcher the page is broken. They arrive with LM12 and the grant.

### 2b. The bounds come from the API — do not re-declare them

`GET /api/livemap/positions` returns `bounds: { stoppedSpeedMph, engineOnBoundSeconds,
offlineBoundSeconds }` precisely so a legend does not need a second copy of the numbers. A component
that hard-codes "offline after 15 minutes" is telling the user something the response can already
prove, and will be wrong the day the bound is retuned. Render the legend off `board.bounds`.

Likewise the state is already computed server-side. `deriveVehicleState` exists in
`@silvicom/shared` for the cases the map needs it locally (interpolation between polls), but the
board's `state` field is authoritative — do not recompute it in a component and risk disagreeing with
the same server that drew the last frame.

### 2c. Two things a real dispatcher will see on day one, and neither is a bug

- **54 of 199 trucks render `offline`.** That is the truth (D-LM10: a map that draws a 17-day-old
  position the same as a 2-second-old one is lying about one of them), but a fifth of the board being
  grey on first sight needs to *look* deliberate. The per-truck age is in `ageSeconds`; show it.
- **28 of the 199 are `retired` vehicles.** ⚠ **The board does NOT filter by vehicle status** —
  `readFleetIdentities` returns every vehicle and the board includes any with a position. This is an
  **open question, not a decided behaviour** (see §5 Q-LM8a). It was noticed at LM6 and deliberately
  not settled there, because "should a decommissioned truck appear on the live map" is a product
  question, and guessing it inside a reader function is how a filter nobody can find gets written.

### 2d. The surface is not in `apps/web/src`

The sidebar is generated from `NAV_SURFACES` in `packages/shared/src/surfaces.ts` — nav paths are not
in the web app. LM8 needs three edits and they are easy to miss:

1. `packages/shared/src/surfaces.ts` — `{ key: "dispatch.live-map", label: "Live map",
   path: "/live-map", group: "dispatch", gate: section("dispatch"), module: "dispatch" }`, next to
   `dispatch.fuel-planning` on line 161.
2. `apps/web/src/lib/navIcons.ts` — the icon, in the `Record<key, Icon>` (line 72 is the neighbour).
   ⚠ Never import from `@hugeicons/core-free-icons` directly; add to `packages/ui/src/icons.ts` first.
3. `apps/web/src/router/__snapshots__/routeTable.test.ts.snap` — regenerate the committed snapshot.

`gate: section("dispatch")` and not `manage(...)`: the API gates on `dispatch: view`, and an auditor
holds it. A surface stricter than its endpoint would hide a page from somebody the API will answer.

---

## 3. The one measurement still owed

**Re-measure board assembly time in Railway before the map depends on it.**

~1.0 s is from a laptop over three sequential round trips to Supabase. The API runs beside the
database in Railway, so the real figure should be far lower — but it has not been taken, and LM8 is
specified to poll every 5 seconds (D-LM8). If it is not comfortably under that, the three reads in
`liveMapBoard.ts` are independent and can go concurrent; the sequential choice is recorded there with
its reasoning, so changing it is editing a decision rather than excavating one.

Cheapest way to take it: LM6 is deployed, so time the endpoint from the browser's own network panel
on the first LM8 build, or curl it with a real token.

---

## 4. Traps, all met and paid for this session

**Verification traps — these cost the most time:**

1. **Every `vite preview` server serves the one `apps/web/dist`.** Three were running on 4173–4175
   serving the same bundle. An A/B "by port" proves nothing; the tree must be **rebuilt between
   arms**. One measurement here was invalidated exactly that way before it was caught.
2. **The web error boundary swallows the cause and logs nothing** — not to `console.error`, not to
   `pageerror`. A `PlanResult` fixture missing `status` yields "Something went wrong" with an empty
   console, because `PlanStatusBanner` does `META[props.status]`. **The way out is not to defeat the
   boundary.** Run the *same* fixture against the pre-change tree: if it fails identically, the fault
   is the fixture. That comparison is cheaper than any debugging and is the first thing to reach for.
3. ✅ **`vite build` locally is NOT broken** — correcting `docs/HANDOFF-2026-09-15.md` §6, which
   records it as unresolved env setup. `vite.config.ts` reads `process.env.VITE_SUPABASE_*` directly
   rather than Vite's `loadEnv`, so the bare `build` script fails even though `apps/web/.env` defines
   them. **`pnpm --filter @silvicom/web preview:local` loads the file itself and works.** The local
   browser loop is available today, for LM8 and for the #803 dashboard nobody has looked at.
4. **Dev-bypass API mocks are raw JSON** — `route.fulfill` the bare body, never `{ok, data}`. Combined
   with (2), a wrapped body gives a blank page and no clue.

**Test traps:**

5. **`supabaseRecorder` records filters without applying them.** A flat fixture answers every query
   with every row, so an assertion on *results* cannot pin a `WHERE` clause — dropping LM6's
   live-status filter entirely left every assembly test green. Two tests in
   `liveMapBoard.test.ts` read the recorded predicates directly for that reason.
6. **Mutate before believing a suite.** Three mutants survived first drafts this session and each was
   a real gap: a `Number.isFinite` guard that changes no outcome (LM5, kept and documented as
   defensive), tenant scope read from a payload no fixture ever populated (LM4's matrix), and a hue
   passed in degrees where 25 and 250 *radians* wrap to angles with the same dominant channel (LM7).
   "The red channel dominates for a red hue" reads like an assertion and is not one.

---

## 5. Open questions

- **`Q-LM8a` — should the live map draw RETIRED trucks?** 28 of 199 today. Candidates: (a) the board
  filters to `status = 'active'`, (b) the map filters and the endpoint stays complete, (c) draw them,
  distinctly styled, because a retired truck still sitting in a yard is a thing a dispatcher may want
  to see. **Recommendation: (a)** — the endpoint is the dispatcher's board, not an inventory, and a
  reader that returns fewer rows is easier to widen later than a map filter is to discover. Whichever
  is chosen, it is one predicate in `readFleetIdentities` or one `filter` expression in the layer, and
  it should be a comment citing this question either way.
- **`Q-LM-F2`** (from the earlier handoff, still open) — is a DATABASE boundary on money wanted, or is
  the product boundary the real requirement? `ftxn_select` has no section check. Scoped as **LM-F2**.
- **`Q-LM-T1`** (still open) — what does a `driver` see at `/`? They match no dashboard tab and get an
  empty state. Safe, not an answer.
- **`Q-SAM`** (not filed) — breadcrumb trails. If ever wanted, that is a NEW table and a new decision,
  never a widening of `vehicle_positions`; 0341's header says so explicitly.

---

## 6. What is blocked, and on whom

**McLeod's `VIEW CHANGE TRACKING` grant**, still refused on all seven dispatch tables, with the review
package sent and awaiting the carrier's IT (`docs/mcleod-review/`, and §5 of the earlier handoff).

It blocks, transitively: the `mine` scope on the live map (D-LM3), the dispatcher filter (§2a), LM1b /
LM3 / LM11, and MC0. D-LM18 already rules that the board ships **fleet-wide** because of it, and the
tempting substitute is measured and rejected — `tractor.dispatcher` agrees with the load's actual
dispatcher on only **56%** of the live board.

Nothing in LM8 waits on it. The board says `scope: "all"` and carries `scopeReason` in plain words,
and that banner must be rendered: a dispatcher who believes they are seeing only their own trucks will
read an empty column as "nothing of mine is late".

---

## 7. Where the decisions are written down

Each step's reasoning is appended to `docs/plans/livemap/LIVE-MAP-PLAN.md` as a dated log entry — LM4,
LM5, LM6 and LM7 each have one, and they carry the deviations and the measurements rather than this
document. Read those before changing any of:

- the 5-second cadence and the separate cursor row (LM4 — sharing one silently starves the fuel tier);
- the 3 mph / 30 s / 15 min thresholds (LM5 — all three measured on the real fleet, with the
  distributions that make them robust rather than tuned);
- the reads-through-owners shape and why `livemap` owns no table (LM6);
- `onBeforeTeardown` and why it exists at all (LM7 — Vue unmount hooks run in registration order).
