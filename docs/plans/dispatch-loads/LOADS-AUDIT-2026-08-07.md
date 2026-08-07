# Loads & Dispatch — Deep Audit (2026-08-07)

**Scope:** the Loads module end to end — data model, lifecycle engine, driver surface, dispatch
surface, TMS ingest, and the tests that are supposed to hold it up.
**Method:** every claim below was verified against code on the connected checkout at commit
`822d988`. The spec is §14 of `docs/plans/drivers-app/DRIVER-APP-PLAN.md` (decisions D45–D50) and
its §14.12 exit criteria. **Ledger entries were not treated as evidence** — the driver-app Phase 9
gate proved they can overstate (0086's "three F4 leaks closed" was one of three), so each item was
re-derived from the source.

---

## 1. Verdict

The Loads module is **substantially built and architecturally sound**. The state machine, its
database-level enforcement, the driver flow and the TMS ingest are real, careful work. What is
missing is not the core flow — it is the **operational envelope**: seeing the evidence drivers
produce, surfacing the exceptions the system already records, executable proof that the lifecycle
works, and the abuse limits the plan itself declared a pre-launch blocker.

Reframed for the decision actually on the table (`tab.loads` is currently OFF for the org): the
blocker to switching Loads on is **not missing screens**. It is F1, F3 and F5 below.

---

## 2. What is built (verified)

| Package | State | Evidence |
|---|---|---|
| **3A** duty sessions | ✅ complete | `0086`, 4 SECURITY DEFINER RPCs, `dutyContract.ts`, `/api/me/{equipment,shift}` + 3 writes, `dutySessionSweeper` in `schedulers.ts` |
| **3B** lifecycle & approval | ✅ complete | `0087`: 8-state model, `loads_status_guard` (legal-pair map + approval checklist + release gate), **append-only `load_events` enforced by trigger** (not just RLS), 4 driver RPCs, driver-visibility predicate on all three scopes; shared `loadsLifecycle.ts` (26 tests) + `loadsContract.ts` (16 tests) |
| **3C** driver app | ✅ complete | list (Upcoming/Current/Previous), detail with accept/decline/start, stop capture with photo slots + skip reasons; outbox kinds `load_accept`/`load_decline`/`load_start`/`load_stop`; **D46** two-population decline copy wired; **D47** mismatch flag; **D44.3** trailer prompt present on load detail |
| **3D** dispatch | ◐ ~70% | 10 endpoints (`/loads` CRUD, per-transition submit·approve·release·reject·cancel, `assign`, `bulk`, `events`, `assignments`), Loads queue with 6 tabs + live `approvalChecklist()`, load editor with stops + **required-photo slot builder**, `LoadDetailPanel` timeline, assignments board |
| **3E** TMS ingest | ✅ complete | `tmsLoadIngest.ts` + `POST /api/tms/loads`; lands in `pending_approval`; idempotent on `(org, provider, external_id)`; amendments become `amended` events, never overwrites; 13 tests incl. the undefined-vs-null bug the tests caught |

Role gating on `/api/dispatch` correctly uses `rolesThatCanView('dispatch')` /
`rolesThatManage('dispatch')` — auditor read-only, driver excluded. (Correct in code; untested — see F7.)

---

## 3. Findings

### F1 — Proof-of-work photos are write-only. Dispatch cannot see them. **(highest impact)**

Drivers capture required photos per stop; they upload to the `load-photos` bucket and land in
`load_stop_photos`. Then nothing. Verified:

- `load_stop_photos` is read in exactly one place server-side — `services/driverLoads.ts:97`, for the
  driver's own load view.
- The dispatch query (`services/dispatchLoads/queries.ts`) selects `load_stops` and **never joins
  photos**.
- `apps/web` contains **zero** references to `load_stop_photos` or the `load-photos` bucket.
- `LoadDetailPanel.vue` renders `stop.required_photos` — the *slots that were required*, not the
  images that were captured.

§14.12 requires: *"A stop's required photos … appear on the dispatch side."* Unmet. The entire
purpose of proof-of-work capture is that the office can inspect it in a dispute; today the photos are
a write-only archive. **The pattern to copy already exists in this codebase** —
`services/hazmatLoads.ts:190` serves hazmat documents via `createSignedUrls(..., 300)`.

### F2 — Three of five exception classes are recorded and never shown

`isException()` (web) covers only **declines** and **loads aging in `pending_approval`**. §14.9
specifies five sources. Verified absent from `apps/web` entirely (zero grep hits):

| Exception | Written where | Surfaced? |
|---|---|---|
| Decline (D46) | `loads.declined_at` | ✅ |
| Aging `pending_approval` | derived | ✅ |
| **Equipment mismatch (D47)** | `load_events.kind='equipment_mismatch'` | ❌ never displayed |
| **TMS amendment (D48)** | `load_events.kind='amended'` | ❌ no banner, no tab |
| **Auto-closed shift (D44.5)** | `ended_reason='auto_timeout'` | ❌ never displayed |

The D48 design explicitly promises dispatch a review banner ("*McLeod changed 2 fields on LD-20481*").
The event is written; no human ever sees it. An amendment silently applied is precisely the failure
D48 was written to prevent.

### F3 — The Loads behavioural test suites are dead. Same rot Phase 9 found. **(blocking)**

There are **four** offline matrices; Phase 9 repaired and wired two. The other two — both belonging
to Loads — abort before their first assertion on stale migration filenames:

```
load-lifecycle.test.mjs  → ENOENT 0083_driver_identity.sql        (real: 0083_driver_rls_matrix.sql)
duty-sessions.test.mjs   → ENOENT 0016_vehicle_fuel_level.sql     (real: 0016_driver_samsara_idx.sql)
                           + the same two 0083/0084 stale names
```

`test:rls` runs only `rls.test.mjs` + `hazmat_rls.test.mjs`. So the ledger's **"lifecycle behaviour
matrix 42/42"** and **"duty behaviour matrix 20/20"** — the primary evidence that the Loads state
machine and the duty model behave correctly — **have not executed in months and do not execute
today.** The Loads lifecycle currently has no runnable behavioural proof at all.

### F4 — Duplicated, divergent dispatch code and an orphaned page

- `useDispatchLoads.ts` exists **twice**: `composables/` (238 lines) and `features/dispatch/`
  (261 lines). Contents have drifted (different exports: `AssignmentRow`/`LoadStop` vs
  `AssignLoadRequest`/`LoadEventKind`; different doc comments; `isException` bodies differ).
- `DispatchAssignmentsPage.vue` (160 lines) is **not routed and not imported anywhere** — dead — and
  is the *only* consumer of the `composables/` copy.
- The routed `AssignmentsPage.vue` uses a **third** file, `features/dispatch/useAssignments.ts`.

Net: two assignments implementations, one dead page, one effectively dead composable that a future
reader will not be able to tell is dead. This is how a bug fix gets applied to the wrong copy.

### F5 — D57 driver write rate limits were never built **(plan's own pre-launch blocker)**

D57 and task T11 both state this must land *before 3C ships*, with per-endpoint buckets keyed on the
JWT **`sub`, never IP**, because drivers share carrier NAT. Verified: there is no `meLimiter`, no
`keyGenerator`, and no `sub`-keyed limiting anywhere in `app.ts` or the middleware. Driver writes sit
under the blanket `apiLimiter` (600 / 15 min, **IP-keyed**). One depot behind one NAT can lock its
own drivers out; a stolen token has a very wide runway.

### F6 — Assignments is half of its specification

Built: the live board (driver, on/off duty, truck, trailer, since, current load) and end-a-stuck-shift.
Missing:
- **History tab** — duty segments for a driver / vehicle / trailer over a date range. §14.9 calls this
  "the attribution audit trail the detection engine's evidence panels can cite", so its absence has
  downstream consequences beyond dispatch.
- **Equipment reassign / take-over conflict resolution** from the board. The API exposes only
  `POST /assignments/:driverId/end`; the spec called for `/assignments/:sessionId/{end,equipment}`
  (note also the param drift: `driverId` vs `sessionId`).

### F7 — The dispatch engine has no service-level tests

| Suite | State |
|---|---|
| `loadsLifecycle.test.ts` (shared) | ✅ 26 |
| `loadsContract.test.ts` (shared) | ✅ 16 |
| `tmsLoadIngest.test.ts` (api) | ✅ 13 |
| `stop-capture-model.test.ts` (driver) | ✅ 9 |
| **`dispatchLoads` service** | ❌ none |
| **`driverLoads` service** | ❌ none |
| **`dispatchContract`** | ❌ none |

The approve / release / reject / cancel / assign / bulk orchestration — including the partial-success
contract of bulk and the audit + event writes — is entirely untested at the service layer. Combined
with F3, the most safety-critical part of Loads has the least coverage.

### F8 — `load_changed` has no producer

D53 defines the category and the driver app renders it, but nothing emits it. Verified: `release` →
`load_offered`, `cancel` → `load_canceled`, and no path emits `load_changed`. A load edited or
amended after release is silently different on the driver's phone — the exact failure mode that
motivated notifications in the first place.

---

## 4. What this means for switching Loads on

`tab.loads` is OFF for the org (D-PM1). The honest gate to flipping it ON:

**Must fix first:** F3 (no executable proof the lifecycle works), F5 (a NAT lockout or token abuse
in production), F1 (photos invisible makes the flow's central artifact useless to the office).
**Should fix before wide rollout:** F2, F8 (silent divergence between what dispatch knows and what
the driver sees), F7.
**Housekeeping, do it while nearby:** F4, F6.
