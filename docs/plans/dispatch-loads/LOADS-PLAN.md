# Loads & Dispatch — Hardening Plan

**Goal:** take the Loads module from "substantially built, unproven, half-observable" to
switch-on-able — with the evidence to justify switching it on.

**Companions:** findings in `LOADS-AUDIT-2026-08-07.md`, decisions in
`LOADS-DECISIONS-2026-08-07.md`, spec in `docs/plans/drivers-app/DRIVER-APP-PLAN.md` §14, gate in
`docs/plans/drivers-app/RELEASE-GATE.md`.

**Sequencing principle, learned from the driver-app work:** restore truth before building on top of
it. L0 exists because we are about to modify a lifecycle whose behavioural proof is currently dead,
and Phase 9 already showed what building on unverified ground costs.

Each phase is independently shippable and ends green.

---

## L0 — Restore the truth (½ day) · **do first, blocks nothing else logically but everything practically**

0.1 Fix the stale migration filenames in `supabase/tests/load-lifecycle.test.mjs` and
    `duty-sessions.test.mjs` (`0083_driver_identity` → `0083_driver_rls_matrix`,
    `0084_driver_scoped_rls` → `0084_driver_rls_writes`, `0016_vehicle_fuel_level` →
    `0016_driver_samsara_idx`), plus whatever shim gaps surface behind them — expect the same class
    the RLS matrix had (storage columns, helper functions, roles, fixtures that predate a guard).
0.2 Extend `test:rls` to run **all four** matrices; update the `//test:rls` note to say four.
0.3 Record the real pass counts in the build-status doc. **Any assertion that fails is a finding** —
    triage it on its merits (as `0135`/`0136` were), never by weakening the assertion.
0.4 Add the Loads matrices to `RELEASE-GATE.md` Gate A.

**Exit:** four matrices, all green, all in CI, real numbers written down.

## L1 — Proof-of-work becomes visible (1–2 days) · D-L1

1.1 API: `dispatchLoads/queries.ts` joins `load_stop_photos` per stop; batch-sign with
    `createSignedUrls(..., 300)` exactly as `hazmatLoads.ts:190` does. Projection: slot,
    `captured_at`, uploader, URL.
1.2 Web: `LoadDetailPanel` renders a thumbnail row per stop beneath the required-slot pills, with a
    lightbox and the capture timestamp. An expected-but-absent photo reads as a gap, not a blank.
1.3 Handle the honest states: not yet uploaded (driver still offline), skipped-with-reason (show the
    reason — D21), and signing failure (say so; do not render a broken image).
1.4 Tests: service test that a signed URL is produced per photo and that a foreign org's load
    returns none; RLS matrix case that a driver cannot read another driver's stop photos.

**Exit:** dispatch opens a delivered load and sees the pictures the driver took; §14.12's
"appear on the dispatch side" is met.

## L2 — Exceptions that actually work (1–2 days) · D-L2, D-L8

2.1 `GET /api/dispatch/exceptions`: union of declines, aging `pending_approval`,
    `load_events.kind IN ('equipment_mismatch','amended')`, and duty sessions with
    `ended_reason='auto_timeout'`. Org-scoped, paginated, newest first, each row carrying its
    resolving action.
2.2 Web: the Exceptions tab reads that endpoint instead of client-side filtering. The **D48
    amendment banner** ("McLeod changed 2 fields on LD-20481 — review") renders the field diff the
    ingest already stores, with Apply / Dismiss.
2.3 Equipment-mismatch rows offer **Adopt** (write dispatch's plan to match what the driver is
    actually in) or dismiss — D47 stays flag-never-block.
2.4 `load_changed` producer per D-L8: on a released load, diff driver-visible fields (stops,
    appointments, addresses, equipment) on patch/amend, notify dedupe-keyed per load+change.
2.5 Tests: one service test per exception source; a producer test that an internal-only edit does
    **not** notify.

**Exit:** every exception the system records reaches a human, and a driver is told when their load
changes under them.

## L3 — Consolidation and coverage (1–2 days) · D-L4, D-L7

3.1 Delete `apps/web/src/composables/useDispatchLoads.ts` and the unrouted
    `DispatchAssignmentsPage.vue`, after diffing to confirm nothing live-side is lost.
3.2 Service tests for `dispatchLoads`: the transition matrix through the service (not just the
    shared contract), bulk partial-success `{succeeded, failed, outcomes[]}`, and the assertion that
    **every** mutation writes both an audit row and a `load_events` row.
3.3 Service tests for `driverLoads`: accept / decline / start / complete-stop, replay idempotency,
    and D46's two decline populations (owner-operator unassigns + clears `released_at`; company
    driver records the reason and keeps the assignment).
3.4 `dispatchContract` tests.
3.5 Route-auth: assert an `auditor` gets read-only and a `driver` is refused on `/api/dispatch`
    (§14.12 has this unchecked; the code is right, the proof is missing).

**Exit:** one data layer per concern; the dispatch engine has tests proportional to its blast radius.

## L4 — D57 rate limits and abuse safety · D-L5 · **DONE 2026-08-08**

`packages/shared/src/driverWriteLimits.ts` carries D57's four buckets and their numbers, so the API
that enforces them and the app that explains them cannot drift. `driverWriteBucket(method, path)`
resolves a request to a bucket and is pure — a route that silently stops matching is not an error, it
is an unlimited endpoint, which is the state this change exists to end. 30 assertions.

- **Per-minute** window: in memory, per API instance, keyed `bucket:sub`. Checked FIRST, so a runaway
  retry loop is refused without touching the database. The honest caveat is that with N instances the
  effective ceiling is N × the limit; irrelevant at one Railway service, and the daily cap behind it
  is exact regardless. If this ever runs multi-instance at scale, that map moves to Redis — not the
  counter table.
- **Daily caps**: `0149_driver_write_counters` + `bump_driver_write_counter`, which increments and
  judges in one statement. Doing that as SELECT-then-UPDATE in the API would be a lost-update bug
  that only appears under the traffic the cap exists to survive. RLS denies every client: a driver
  who could read their own counter could also delete it. Five matrix assertions pin that.
- **Two codes, because they mean different things.** `rate_limited` is "try again in a moment";
  `daily_cap_reached` is "that is today's maximum, talk to dispatch". Both `429 + Retry-After`, but
  one resets in seconds and the other at midnight UTC. Collapsing them would have the app tell a
  driver to wait a moment for something that will not clear for nine hours.
- **Mounted inside the routers, after their own `requireAuth`.** At app level it would run before
  authentication and have nothing to key on but an IP — exactly the failure D57 exists to prevent.
- **The cap check fails OPEN, loudly.** If the counter is unreachable the driver's shift does not
  stop: the per-minute window already bounds the damage, and refusing a completed stop to protect a
  bookkeeping quota loses real work.

**The client bug this exposed.** The outbox already treated 429 as transient — but the backoff curve
tops out at five minutes and `MAX_ATTEMPTS` is 8, so a daily-capped record burned through every
attempt in about twenty minutes and **dead-lettered**. A driver's completed stop would have landed in
*Needs attention* over a quota that clears at midnight. `outcomeAfterFailure` now never dead-letters a
429 and honours a server `Retry-After` (delta-seconds or HTTP date) over its own backoff.

**Exit met:** a depot behind one NAT cannot lock itself out, and a stolen token has a short runway.

**Left deliberately unlimited:** `/api/me/hazmat/*`. D57 did not size it, and inventing a number would
be worse than the named gap; it stays under the blanket `apiLimiter` until it has its own.

## L5 — Assignments completion · D-L6 · **BACKEND DONE 2026-08-08; history tab outstanding**

5.1 **The endpoint is built.** `GET /api/dispatch/assignments/history` — reads
    `driver_equipment_timeline` (0150), so "what counts as a holding" is the same rule the load detail
    page uses rather than a second answer to the same question. `from`/`to` are **required**, not
    defaulted: an unbounded attribution query over a hundred-truck fleet is a table scan, and a silent
    default answers a different question from the one asked. Filters by driver / vehicle / trailer,
    keyset paginated (offset paging skips rows on a table still being written), three name lookups per
    page rather than one per row. **Overlap, not containment** — a segment that started before the
    window and is still open belongs in it, and containment would hide exactly the long shift an
    investigation is chasing.

5.2 **The param drift is fixed, and it was a real race.** `POST /assignments/:driverId/end` closed
    "whatever this driver has open", but the board is a snapshot refetched every sixty seconds. A
    driver who signed off and checked into another truck inside that window had their **new** shift
    closed by a click on a stale row — silently, reported as success. Now
    `POST /assignments/:sessionId/end` → `end_duty_session_by_id` (0151), which closes the session
    dispatch actually saw, no-ops on one already closed, and 404s across tenants. It also closes the
    segments under the session, so the truck is genuinely released. `end_duty_session(p_driver, …)`
    stays for the driver app, which means "close MY open shift" and has no stale snapshot to be wrong
    about — two callers, two questions, two functions.

5.3 Five assertions in `duty-sessions.test.mjs`, including the stale-click race itself.

5.4 **The history tab is built** — a tab on Assignments, not a page: it is one more view of the same
    subject, not a second place to look for it. `FilterBar` with `DateRangeFilter` + driver as the
    primary dimensions, truck and trailer in `#more` with chips, `DataTable` with the shared badge
    vocabulary. Two departures from the contract's list recipe, both deliberate and both stated in
    the file:

    - **No search box.** The endpoint filters by driver, vehicle, trailer and date and has no text
      search. A search field over server-paginated rows would only match what happens to be loaded,
      which is worse than no search — the contract's own rule is never to ship a filter no query
      consumes.
    - **"Load more", not `TablePagination`.** Page numbers need a total, and the endpoint has none:
      a `count: exact` over the attribution table is the very scan the date range exists to avoid.
      The count reads "N segments loaded" rather than a fabricated total.

    Opens on the last seven days — the endpoint requires a range, and a stated default is better than
    either an empty screen or a silent unbounded query.

5.4a Two pieces of design debt cleared while in the file: the board's HOS badge map was another
    hand-rolled `rounded-full` fill with no ring, and the "Active drivers only" control was a raw
    `<input type=checkbox>`. Both now use the shared vocabulary. `useTrailers` was also **promoted**
    from `features/fleet/` to `composables/` — seven surfaces across four features read it, and
    `check-feature-boundaries`' own comment names promotion as the intended fix for that shape rather
    than another ALLOW-set entry.

5.5 *Deferred by D-L6:* equipment reassign and take-over resolution from the board.

**Exit:** an anomaly investigation can answer "who was in this truck at 14:20 on the 3rd" — over the
API today, from the UI when 5.4 lands.

## L6 — Switch-on (½ day + the device pass) · D-L9

6.1 Confirm the bar: L0 green, L1 shipped, L4 live, migrations applied.
6.2 Run the Loads rows of `RELEASE-GATE.md` Gate B on hardware: released load reaches the phone,
    accept/decline both populations, multi-stop advance, offline photo capture → visible in
    dispatch, exception appears, `load_changed` arrives.
6.3 Pilot: enable `tab.loads` for one or two drivers via a **per-driver override** (the control plane
    already supports exactly this), watch for a week.
6.4 Wide rollout once L2 and L8 are in and the pilot is quiet: flip the org-level `tab.loads` on.

**Exit:** Loads is on, with the evidence that justified turning it on.

---

## Order and effort

| Phase | What | Size | Gates switch-on? |
|---|---|---|---|
| L0 | Restore the four matrices | ½ d | **yes** |
| L1 | Photos visible to dispatch | 1–2 d | **yes** |
| L2 | Exceptions + `load_changed` | 1–2 d | wide rollout only |
| L3 | Consolidation + service tests | 1–2 d | no |
| L4 | D57 rate limits | **done** | **yes** |
| L5 | Assignments History | **backend done** | no |
| L6 | Pilot → wide | ½ d + device | — |

**Critical path to a pilot:** L0 → L1 → L4 → L6. Roughly three to four days of work.
L2/L3/L5 can run in parallel or after, and are required before wide rollout (L2) or simply
worth doing while nearby (L3, L5).

## Open questions for Miki

1. **Photo retention.** Freight claims can surface months later. Is there a retention requirement on
   `load-photos` (and a cost ceiling) that should shape L1's storage policy?
2. **Pilot drivers.** Which one or two drivers for L6.3, and who watches the week?
3. **Daily caps.** D57's numbers are ~10× realistic behaviour. Confirm they match how your busiest
   multi-stop day actually looks before they start returning 429s.
