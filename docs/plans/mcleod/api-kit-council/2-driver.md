# Council round 2 — driver experience and load data path (lens: is v2 better than today?)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `4876449c7` (branch `claude/mcleod-api-kit-build-plan`,
clean). Inputs: `AUDIT-2026-11-20-API-KIT-SPECS.md` §2 + §5, `api-kit-specs/A-driver-loads.md`,
`B-data-fixes.md`, `api-kit-audit/A.md`, `B.md`, `X.md`, `docs/plans/drivers-app/RELEASE-GATE.md`.
Every claim I rely on was re-read at file:line; round-1 claims I could not confirm are marked.

---

## Part 1 — TODAY, precisely

**Who sees a McLeod load.** `loads_driver_scope` (`supabase/migrations/0371_load_driver_scope_reads_dispatch.sql:64-74`)
= `driver_id = auth_driver_id()` AND status in `offered, accepted, in_transit, delivered, canceled` AND (manual OR
`id in auth_dispatched_load_ids()`), the helper being "the load's newest `load_dispatches` row (sent_at, id) names
the caller" (`0371:37-56`). The API restates it for the service role: `loadsDispatchedTo` + `.eq("driver_id")` +
`.in("status", DRIVER_VISIBLE_STATUSES)` + `.or(source.neq.tms,id.in.(…))` (`apps/api/src/modules/loads/driverLoads.ts:85-132`;
`packages/shared/src/loadsLifecycle.ts:23-29`). McLeod `P` with no departed stop projects to `approved`
(`packages/shared/src/mcleodLoadProjection.ts:136-142`), which is NOT in the set. So a McLeod load reaches its
driver only **after a 360 Dispatch press AND after McLeod has a `D` stop** — i.e. after the dispatcher has already
cleared the pickup in McLeod. The co-driver never sees it (`co_driver_id` read by no policy). There is no history
window: a delivered/canceled load stays listed for ever.

**What the taps do.** Every action is an outbox record (`apps/driver/src/features/loads/useLoads.ts:146-255`), id =
`Crypto.randomUUID()` (`apps/driver/src/data/outbox.ts:47-49`), drained by `driver_complete_stop` etc.
(`0141_driver_load_rpc_contract.sql:264-400`). `assert_driver_load` checks only `driver_id = p_driver`
(`0141:80-86`) — the live hole (an undispatched McLeod load can be acted on by id). Stop actions require load
status `accepted|in_transit` (`0141:304-306`); same-status replay is a silent no-op (`0141:310-312`); a different
outcome on a finished stop is DL003 (`0141:313-315`). Arrive/Complete set `arrived_at` (fabricated on a
Complete-from-pending, `0141:342`), the first worked stop moves `accepted→in_transit`, the last moves the load to
`delivered` + `completed_at` (`0141:364-399`) — and the next sweep writes McLeod's `status` back
(`mirrorLoads.ts:54-77`, `:202`), so a McLeod load bounces Previous→Current in the app. Photos are uploaded to
Storage first (own folder only, `0085:298-304`), then the POST (`apps/driver/src/data/handlers.ts:126-156`).
The stop screen offers "Complete stop" (primary), "Mark arrived" (pending only) and "Skip stop" for **every**
stop status (`apps/driver/app/loads/[id]/stop/[stopId].tsx:150-190`, no status guard).

**Outbox.** Serial engine; `claimNext` = oldest DUE `pending|failed` record by `created_at` (`outbox.ts:95-110`),
restating the tested-but-unused pure `pickNext` (`apps/driver/src/data/policy.ts:55-62`). When NetInfo says offline
`runSync` returns without claiming anything (`apps/driver/src/data/sync.ts:175-178`; `src/lib/connectivity.ts:14-16`),
so in true airplane mode nothing burns an attempt and order is kept. When the phone is "connected" but requests
time out (a dock with one bar), a failure is transient → `failed` with backoff 2 s…5 min (`policy.ts:26-39`), the
pass stops (`sync.ts:191`), and the next pass takes the oldest *due* record — a younger record can overtake.
After `MAX_ATTEMPTS = 8` transient failures the record is `dead` (`policy.ts:24, 99-101`); any 4xx is `dead` at
once ("Needs attention", `FailedSyncList`). 429 and device-limit never dead-letter (`policy.ts:94-97, 164-171`).
A 200 marks `done` and deletes the staged photo files (`sync.ts:131-133`). A successful action returns
`{ load: null }` with 200 when the load is no longer visible (`apps/api/src/modules/driver-app/routes/me.ts`
`runLoadMutation`, `driverLoads.ts:221`) — not a dead-letter.

**What the sweep overwrites.** `applyMirroredLoads` rewrites `status, driver_id, co_driver_id, vehicle_id,
trailer_id, …` on every projected change (`mirrorLoads.ts:54-77`, `:190-205`); the agent re-posts a movement
whenever its hash changes, and the hash covers the stops incl. `eta` (`tools/mcleod-agent/agent.mjs:891`), and
the relink pass re-projects without any McLeod change (`dispatchProjection.ts:125-166`). Stops:
`delete … where status='pending'` then `upsert(…, onConflict: "load_id,seq")` (`mirrorLoads.ts:102-128`), so a
pending stop gets a new `load_stops.id` on (almost) every ETA update, and a **worked** stop (kept) is UPDATED
with whatever McLeod stop now sits at its `seq` (`...s` spread, `mirrorLoads.ts:113-124`) — after a re-sequence
the driver's evidence row silently carries another stop's name and address. `seq` is McLeod's
`movement_sequence`, which counts the non-drawn stop types too (`mcleodLoadProjection.ts:207-209`), and is
CHECK-constrained to 1..50 (`0085:123`, re-stated `0423:101-102`).

**Delivery to phones.** The self-hosted OTA lane and APK page were **retired 2026-10-22** (`d313fa8a1`,
deleting `.github/workflows/driver-ota.yml` and `driver-android.yml`). The only lane is `driver-store.yml`
(tag `driver-v*` → EAS → Play internal / TestFlight), whose header says "NOTHING BELOW HAS EVER RUN. There is no
EAS project yet" (`.github/workflows/driver-store.yml:12-15`). v1 §2: the app "has never run on a real phone
and is in neither store" (`MCLEOD-API-KIT-PLAN.md:106-108`). **Net: today no driver uses the app at all.**

---

## Part 2 — PLANNED (v2 = spec A as corrected by AUDIT §2 and ruled by §5)

- **S0** (`A-driver-loads.md:41-147`): `load_stops.mcleod_stop_id` + unique `(load_id, mcleod_stop_id)`; the
  mirror writes stops only through `apply_mcleod_load_stops` (claim by seq → delete pending stops McLeod no longer
  has → upsert by McLeod id, never touching `status, arrived_at, completed_at, skip_reason`); a
  `unique_violation` arm DEFERS the whole load until S0c drops `idx_load_stops_load_seq`. Legacy `/api/tms/loads`
  answers 410.
- **N1–N3** (`A:151-472`, ruled O-3): one SQL predicate `driver_visible_load_ids(org, driver)` — seat-holder
  (`driver_id` or `co_driver_id`) AND (tms: status `approved|in_transit|delivered|canceled` AND current dispatch
  names a seat-holder; manual: 0087's set). Policies, `assert_driver_load` and the API all call it. On tms loads
  stop actions are evidence only (load status untouched, no fabricated arrival); Accept/Decline/Start refused
  (DL013/DL014); "Got it" = `load_events.acknowledged`, per seat, per dispatch, not a gate. App phase derived
  from stop state + `isStopBehindTruck` (McLeod `D` counts as behind).
- **N7** (`A:475-527`, AUDIT §2.4): action id = outbox record id = the primary event's `load_events.id`;
  dedupe right after the driver-in-org check, before visibility, key (org, load, stop, action id); `claimNext`
  FIFO per stop (AUDIT §2.2).
- **MK3** (AUDIT §2.1/2.2, O-4): Complete only → one `clearStop` (arrival = driver's Arrive tap, departure =
  Complete tap, `isReportable=false`), enqueued inside `driver_complete_stop` via the one pipeline; pre-write
  check — stop exists, not already cleared, ids unchanged, dispatched driver unchanged — any difference =
  `conflict`; minute-precision exact match.
- **B** (`B-data-fixes.md:118-160`, `:391-402`): PU # (`P8`/`PU` after V1), BOL #, per-stop references, McLeod
  actuals on the driver contract, `.nullable().default(null)` for every new driver field (D-MKN4.6).
- **O-5**: evidence for a load re-dispatched away is stored, shown to the office as an exception, never sent.

---

## Part 3 — Findings

### DR-1 [OK] — Today's visibility, the live hole and the stop churn are as the round-1 audit says
- Evidence: Part 1 above (`0371:37-102`, `driverLoads.ts:85-132`, `mcleodLoadProjection.ts:136-142`,
  `0141:80-86`, `mirrorLoads.ts:102-128`, `agent.mjs:891`). A-1, A-2, A-5, A-9 hold.
- Strengthening fact for C1: churn is driven by **ETA updates** (the movement hash covers `eta`), not only
  by dispatcher edits, so on a live board a pending stop's id changes many times a day. Add to v2's C1 text:
  "every McLeod ETA recompute re-posts the movement (`agent.mjs:891`) and re-creates its pending stops".

### DR-2 [IMPROVE] — S0 also fixes a silent corruption of driver evidence that v2 does not name or test
- Evidence: a worked stop is kept, then `upsert(onConflict: load_id,seq)` overwrites its projected columns with
  the McLeod stop now at that `seq` (`mirrorLoads.ts:113-124`). After a re-sequence, the driver's
  `arrived_at/completed_at`/photos sit on a row whose `name, address_line, appointment_*, external_status,
  actual_*` describe a different stop.
- Fix text (S0a matrix `supabase/tests/load-stops-mcleod-identity.test.mjs`): add title "a worked stop keeps its
  own McLeod stop's address after a re-sequence, never its sequence-neighbour's"; and say in S0's "Why" that this
  is a defect today, so the release note can say what changes for an office reader.

### DR-3 [WRONG] — The driver half of v2 is planned on delivery lanes that no longer exist
- Spec says: "C-A2 driver app … — OTA/APK lanes ⟶ production" (`A-driver-loads.md:738`); B: "the API release and
  the OTA may land in either order" (`B-data-fixes.md:147-149`).
- Evidence: OTA + APK lanes deleted 2026-10-22 (`git show d313fa8a1`: −`driver-ota.yml`, −`driver-android.yml`);
  only `driver-store.yml` remains and has never run, no EAS project (`driver-store.yml:12-15`); app in neither
  store, Apple account Individual is "the open launch blocker" (`RELEASE-GATE.md:132`); sign-off table empty
  (`RELEASE-GATE.md:184-189`). X.md §6.1 already flagged "real phone / stores / Approve and run — not placed".
- Consequences v2 must state: (1) no driver gets N1–N3/N7/C-K3 until a store build containing them is approved
  and installed — every "better for drivers" claim is conditional on that; (2) store adoption cannot be forced or
  rolled back in minutes, so the app must tolerate an older or a rolled-back API (DR-4); (3) C-A3 needs measured
  adoption (DR-19).
- Fix text (v2 rollout): replace "OTA/APK lanes ⟶ production" with "a `driver-v*` store build cut from a commit
  already in production (DR-4), promoted from Play internal / TestFlight; prerequisite: RELEASE-GATE P2.3 (EAS
  project, keystore, APNs, ASC record) and the Apple Organization conversion. The FIRST store release must carry
  C-A2, so no installed build ever shows an `approved` McLeod load with the pre-C-A2 UI (`loadStatus.ts:13,18`
  labels it 'Accepted' and `[id].tsx` offers no footer action)." In B, "the OTA" → "the store build".

### DR-4 [BLOCKER] — A store build tagged on main can require an API that production does not serve yet
- Evidence: the release train keeps production behind main by design (repo `CLAUDE.md` "Production trails main BY
  DESIGN"); `driver-store.yml` builds from any `driver-v*` tag after `require-ci-green` (`:25`), with no check that
  the commit is in production; spec A makes `loadSchema.source` **required** (`A:239-241`) and adds
  `acknowledged_at` (`A:426`). An app built from main with C-A2 against a production API without C-A1 fails
  zod on every load → the Loads tab is an error screen (`useLoads.ts:58-66`). The same happens on a production
  `release.yml` rollback past C-A1 — and a store app cannot be hot-fixed.
- Fix text: (a) `driver-store.yml` gains a step `git merge-base --is-ancestor "$GITHUB_SHA" origin/production ||
  { echo "::error::cut driver builds only from a commit production already serves"; exit 1; }` (state it in the
  workflow header and in `RELEASE-GATE.md`); (b) X 1.14 is ruled for B's rule: every field the app newly reads is
  `.nullable().default(…)` — `source: z.enum(["manual","tms"]).default("manual")` (a pre-C-A1 API serves only
  tms loads already `in_transit`, which the manual flow handles exactly as today), `acknowledged_at:
  z.string().nullable().default(null)`, `mcleod_write: … .nullable().default(null)`. Test (`apps/driver`
  `tests/` or `loadsContract.test.ts`): "a load from an API without source/acknowledged_at still parses".

### DR-5 [REGRESSION] — Between S0b and S0c a re-sequenced or extended movement is frozen for driver and office
- Spec says: the `unique_violation` arm "adds the load id to `deferred` … and leaves that load's stops as they
  were" (`A:97-102`); S0c is "≥ one release after S0b" (`A:138`).
- Evidence: `idx_load_stops_load_seq` is unique and non-deferrable (`0085:162-163`); `seq` = McLeod's
  `movement_sequence`, which counts non-drawn stops too (`mcleodLoadProjection.ts:207-209`), so inserting ANY
  stop type mid-movement shifts every later PU/SO by one → collision → deferral; a swap (dispatcher re-orders two
  stops) collides whatever the order. While deferred, nothing on that load updates — not the new stop, not
  appointment changes, not McLeod's actual times. Today those updates arrive (with churned ids). A-27's
  worked-removed/same-seq collision defers it **forever** until S0c. The window is at least one release night and
  depends on the owner approving the release PR.
- Fix text (preferred): S0a widens the CHECK to admit a scratch band used only inside one transaction:
  `alter table load_stops drop constraint if exists load_stops_seq_check; alter table load_stops add constraint
  load_stops_seq_check check ((seq between 1 and 50) or (seq between 101 and 150));` (old code writes 1..50, so the
  widening is safe either side of the deploy). `apply_mcleod_load_stops` per load: (1) claim; (2)
  `update load_stops set seq = seq + 100 where load_id = $l and mcleod_stop_id = any($incoming)`; (3) for a worked
  stop McLeod removed, also move it to the band (it then sorts last and stops blocking McLeod's stop at its old
  seq); (4) upsert final seqs. No exception arm, no deferral; S0c only restores `check (seq between 1 and 50)`
  after re-numbering kept-removed rows, or keeps the band and documents it. If v2 keeps the arm instead, it must
  (i) still update every non-`seq` column of the load's matched stops and insert non-colliding new stops on
  deferral, (ii) state the window in the release note. Matrix titles: "a stop inserted mid-movement shifts the
  later stops in one apply, ids unchanged"; "two stops swapped by dispatch are applied in one call"; "a worked stop
  McLeod removed no longer blocks the stop McLeod put at its sequence".

### DR-6 [GAP] — A pending stop McLeod removed is hard-deleted, so a driver's queued action on it is lost
- Spec says: S0 step 3 deletes pending stops not in the incoming set (`A:87-90`).
- Evidence: the driver's queued Arrive/Complete then hits DL005 (`0141:298-303`) → 404 (`driverLoads.ts:43`) →
  `dead` (`policy.ts:42-46, 99-101`); photos already uploaded to Storage (`handlers.ts:141-143`) have no row.
  Realistic cases: dispatcher drops a stop while the driver is offline at it; a McLeod split/relay moves the
  SO stop to a new movement (the raw stop PK is `(org_id, company_id, stop_id)` with a mutable `movement_id`,
  `0364:116, 145` — A-2), so the old load loses it and a NEW 360 load (needing its own Dispatch press) gains it.
  O-5's principle ("evidence … is stored and shown to the office") is not met for this path.
- Fix text (new open question for v2, recommendation (a)): (a) soft-remove: new column
  `load_stops.mcleod_removed_at timestamptz` (two-merge rule: column, then readers); the RPC stamps it instead of
  deleting; `driver_visible_load_ids`-based reads and the board filter it out; `driver_complete_stop` accepts
  evidence on it, flags the event `payload.stop_removed_by_mcleod = true`, enqueues no write, and it is an office
  exception. Cost: every `load_stops` reader (14 `.from("load_stops")` call sites, grep) gains the filter. (b) keep
  delete; DL005 on a tms load becomes 410 `stop_removed` and the app records the evidence on the load as an
  orphan `load_events` row. Matrix titles: "evidence for a stop McLeod removed is stored and flagged, never
  DL005"; "a stop that moved to another movement is removed from the first load and created on the second".

### DR-7 [GAP] — O-5 is ruled but its predicate is not written; the co-driver and a McLeod repower are not covered
- Evidence: AUDIT §2.4 moves the dedupe before visibility, which saves only REPLAYS (an event with that id
  exists). A first-time action queued offline and delivered after the load left the driver still meets the new
  `assert_driver_load` (`A:220-224`) → DL002 → 404 → `dead`. "Re-dispatched away" happens two ways, and only one
  is a 360 act: (1) the office sends a new dispatch; (2) McLeod repowers the movement, the sweep rewrites
  `driver_id/co_driver_id` (`mirrorLoads.ts:62-63`), and the current dispatch then names a non-seat → the load is
  visible to NOBODY. A co-driver is never named by a dispatch (dispatch names one driver, `0370`), and seat
  history is not kept (the mirror overwrites seats), so "was ever dispatched to me" refuses a co-driver.
- Fix text (v2 §O-5 implementation): for stop actions on `source='tms'`, after the dedupe and when the visibility
  check fails, admit the action iff `exists (select 1 from load_dispatches d where d.org_id=p_org and
  d.load_id=p_load and d.driver_id=p_driver) or exists (select 1 from load_events e where e.org_id=p_org and
  e.load_id=p_load and e.actor_role='driver' and e.payload->>'driver_id'=p_driver::text)` (needs A-15's
  `driver_id` in every driver event payload, incl. `acknowledged`); write the event with
  `payload.after_reassignment = true`; enqueue NO McLeod request (`mcleod_write: 'reassigned'`); add
  `EXCEPTION_KINDS += 'evidence_after_reassignment'` read from those events (`exceptions.ts:33` pattern).
  Residual case stated, not hidden: a co-driver who never tapped Got it or anything, whose first action is
  queued offline across a reassignment, is still refused (DL002 → Needs attention). Matrix titles
  (`driver-load-actions.test.mjs`): "evidence from a driver the load was re-dispatched away from is stored and
  flagged"; "…after a McLeod repower changed the seats"; "…from the co-driver who had acknowledged it"; "such
  evidence enqueues no McLeod write"; "a driver never dispatched this load is still refused (DL002)".

### DR-8 [WRONG] — "Already cleared in McLeod" is recorded as `conflict`, which makes the commonest real case an exception
- Spec/AUDIT says: pre-write check "its status is not already cleared … Any difference is recorded as
  `conflict`" and exact minute match (AUDIT §2.2); spec A had "D with our departure (±1 min) → confirmed,
  D with other times → conflict" (`A:672-674`).
- Evidence: today the ONLY way a McLeod stop becomes `D` is a dispatcher clearing it by hand (that is how the board
  measured 97 `D` stops, `mcleodLoadProjection.ts:113-118`); during and after rollout dispatchers keep doing it
  from the driver's phone call. Their keyed times will almost never equal the driver's taps to the minute. So
  most Completes on cleared stops end `conflict` → an office exception with "Write again" / "Keep McLeod's"
  (`A:675-681`, `:699-703`) and a driver-side "Dispatch will fix this in McLeod" (`A:685-696`) for a stop
  dispatch has already done. Q-MK3 says McLeod's time is the truth.
- Fix text: (1) at enqueue, if `load_stops.external_status = 'D'` (`mcleodStopDeparted`), write no request and
  record `mcleod_write: 'already_in_mcleod'` in the `stop_completed` payload; (2) at write time, McLeod already
  cleared → a terminal, non-exception outcome `already_in_mcleod` carrying McLeod's and the driver's times
  (`observed`), never `conflict`; the driver's Settings list and the office exceptions feed exclude it; the load
  page shows "Cleared by dispatch 10:20 · driver tapped 10:14". `conflict` stays for: stop gone, movement/stop id
  changed, dispatched driver changed. Matrix/agent titles: "a Complete on a stop McLeod already cleared enqueues
  no write"; "a stop cleared in McLeod between enqueue and write settles already_in_mcleod, not conflict, and is
  not an exception".

### DR-9 [GAP] — Per-stop FIFO does not protect the arrival time, nor the order McLeod needs stops cleared in
- AUDIT says: "`claimNext` keeps first-in-first-out order per stop, so an Arrive is never overtaken by its
  Complete" (§2.2).
- Correction to round-1 A-21's evidence: in airplane mode nothing is attempted (`sync.ts:175-178`), so the
  overtake does NOT happen there; it happens when NetInfo says "connected" but requests fail — exactly a dock with
  one bar. A-21's conclusion stands; its §9 staging recipe ("airplane mode … wait for a failed attempt") cannot
  reproduce it: use a throttled/blackholed network (e.g. Charles / Android emulator `-netdelay`/`-netspeed` with
  the API host blocked) instead.
- Gaps: (i) an Arrive that exhausts 8 transient attempts is `dead` (`policy.ts:24, 99-101`) and FIFO (non-dead
  only) then lets the Complete through → `arrived_at` null on tms (no fabricated arrival) → McLeod gets no
  arrival; the driver's later "Try again" on the Arrive meets DL003 (`0141:313-315`). The arrival is lost.
  (ii) FIFO is per STOP: the SO stop's records can sync before the PU stop's, and the pipeline would call
  `clearStop` on a stop that is not the next uncleared one — W12 lists that behaviour as unknown and RowStop has
  `prior_uncleared_stops` (AUDIT §1 W4/W12).
- Fix text: (1) the Complete carries the arrival it knows: the stop screen puts the driver's own Arrive tap
  (`arrived_at`, `arrive_action_id`, from the optimistic cache or the queued Arrive record) in the Complete
  payload; `driver_complete_stop` on tms, when `arrived_at` is null and the payload carries one, sets it and
  writes the `stop_arrived` event with `id = arrive_action_id` — so the late Arrive record dedupes as a replay.
  (2) Outbox FIFO per LOAD, implemented in the pure `pickNext` (`policy.ts:55-62`, already tested,
  `policy.test.ts:119-145`) and called by `claimNext` inside its exclusive transaction instead of the restated
  SQL (`outbox.ts:99-104`) — deriving beats restating. (3) The agent processes `stop_clear` requests of one
  movement in `seq` order and holds a later stop while an earlier stop of the same movement has a queued or
  leased request. Tests: `policy.test.ts` "a record waits while an older record of the same load is
  unfinished", "a dead record of the load no longer holds the queue"; matrix "a Complete that carries its Arrive
  records the arrival once, and the late Arrive is a no-op"; agent "stop 2's clear waits for stop 1's".

### DR-10 [GAP] — Transient failures dead-letter a stop action in a few minutes of bad coverage
- Evidence: 8 attempts with 2 s→5 min backoff (`policy.ts:24-39`), each needing a trigger (60 s tick,
  `sync.ts:238`) — under ten minutes of "connected but unreachable" kills the record into Needs attention, and
  the driver must find Settings → Try again. 429 and deferrals were exempted for the same reason
  (`policy.ts:87-97, 135-147`). Today this touches almost nobody; N2 puts every McLeod stop through it.
- Fix text (C-A2): `outcomeAfterFailure` treats a transient failure of kinds `load_stop` and `load_ack` like a
  429 (never `dead`, backoff capped at 5 min); permanent 4xx still dead-letter. Test: "a stop action is never
  dead-lettered by timeouts, however many".

### DR-11 [GAP] — A second Complete silently drops its photos; v2's banner invites exactly that
- Evidence: same-status replay returns at `0141:310-312`, before the photo insert at `0141:350`; the handler
  has already uploaded the bytes (`handlers.ts:141-143`); the 200 marks the record done and deletes the staged
  files (`sync.ts:131-133`). The stop screen offers Complete on a completed stop (`[stopId].tsx:150-190`). Spec A
  adds "You can still add your photos. Complete stays available" (`A:354-356`); with teams (O-3) two phones
  completing one stop is ordinary. The office never sees those photos (Storage object without a
  `load_stop_photos` row). Not addressed by any spec or audit.
- Fix text (M-A): in `driver_complete_stop`, the same-status branch inserts `p_photos` (`on conflict (id) do
  nothing`) and writes a `stop_photos_added` event when any row was new, then returns — no status change, no
  write request. Matrix: "a second Complete with new photos records them and changes nothing else". App: once
  the driver's stop is `completed|skipped`, the footer becomes "Add photos" (same handler, `status` unchanged)
  and "Skip stop" is hidden.

### DR-12 [GAP] — Team drivers: the second phone's Arrive on a stop the first completed dead-letters
- Evidence: A completes; B (stale cache) taps "Mark arrived" → `p_status='arrived'`, stop `completed` → DL003 →
  409 → dead on B's phone (`0141:313-315`, `policy.ts:99-101`) for a stop that is done.
- Fix text: on tms loads an `arrived` on a `completed|skipped` stop is a success no-op (the action id is still
  checked first). Matrix: "an Arrive after the co-driver completed the stop is a no-op, not DL003". A
  Skip-vs-Complete clash stays DL003 (a real disagreement).

### DR-13 [OK] — Co-driver photo thumbnails (A-50 / Q-MK5c) are moot for the app
- Evidence: the app renders no stored photo at all — no `createSignedUrl`/`download` from `load-photos` in
  `apps/driver` (grep: only the bucket constant, `handlers.ts:35`); slots fill from API rows, which include the
  teammate's (`driverLoads.ts:144-158`). Both seats upload into their own folder (`0085:298-304`). Close A-50 as
  "no app reader exists".

### DR-14 [GAP] — A dispatch nobody can see is still silent (and a repower makes it so after the fact)
- Evidence: the office may dispatch to any driver ("sending to somebody other than McLeod's driver, is a new row",
  `dispatchToDriver.ts` header) and may dispatch an uncovered `pending_approval` load (`isDispatchable` allows
  every non-closed tms status, `loadDispatchContract.ts:24-26`); a McLeod repower makes the current dispatch name
  a non-seat (DR-7). In all three the driver app shows nothing and the office sees "Dispatched".
- Fix text (C-A1, derived, not restated): the dispatch response and the load page's dispatch fact call
  `driver_visible_load_ids(org, dispatched_driver)` and say "Not in {name}'s app — {reason}" (`not a seat on this
  load in McLeod` | `uncovered in McLeod` | `closed`); `EXCEPTION_KINDS += 'dispatch_not_visible'` lists loads
  whose current dispatch names nobody who can see them. Tests: `dispatchToDriver.test.ts` "a dispatch to a
  driver McLeod does not seat says the driver will not see it"; exceptions "a repowered load whose dispatch
  names the old driver is an open exception".

### DR-15 [GAP] — The driver's load list grows without bound and will hit the 1,000-row cap and the header limit
- Evidence: no window on delivered/canceled (`driverLoads.ts:121-132`; v2's function has none, `A:163-186`);
  stops and photos are read in one unchunked `.in("load_id", loadIds)` each (`driverLoads.ts:142-149`); PostgREST
  returns at most 1,000 rows (memory "PostgREST caps at 1,000") and a long `.in()` overflows Node 22's header
  limit (memory "`.in()` overflows Node 22"). At ~2.6 stops per McLeod load (253/96,
  `mcleodLoadProjection.ts:113-118`) a driver reaches 1,000 stops at ~385 loads — the CURRENT load's stops can be
  among the truncated rows. AUDIT §2.4 adds only org filters.
- Fix text: (1) C-A1 carries A-30 whole — both nested reads `.eq('org_id')` AND `chunks()`, every read throws
  on `error`; (2) new open question with recommendation: the LIST shows delivered/canceled loads for 30 days
  (`coalesce(external_closed_at, updated_at) >= now() - interval '30 days'`), applied in `getDriverLoads` only —
  never inside `driver_visible_load_ids`/`assert_driver_load`, so late evidence (O-5) is unaffected. Test
  `driverLoads.test.ts`: "stops and photos are read in chunks, org-scoped"; "a load delivered 31 days ago is not
  listed but still accepts evidence".

### DR-16 [WRONG] — The "Dispatch planned" pin is limited to a function v2 deletes
- Evidence: AUDIT §2.8 "limited to loads in `loadsDispatchedTo` (B-22)"; spec A C-A1 deletes `loadsDispatchedTo`
  (`A:245`).
- Fix text: B6's planned-unit read takes its load set from `driver_visible_load_ids(org, driver)` (so the
  co-driver gets the pin too); if B6 merges before C-A1, it calls `loadsDispatchedTo` and C-A1 rewrites that call
  in the same merge that deletes it. Test `check-in-model`/route: "the planned unit is pinned only for a load the
  driver can see".

### DR-17 [GAP] — The McLeod enqueue must never be able to fail the driver's evidence
- Evidence: AUDIT §2.1/X 1.3 put C's `mcleod_write_enqueue()` inside `driver_complete_stop`'s transaction; C's
  guard raises its own codes and has uniqueness rules (X 1.1 table). Any raise aborts the stop, the photos and
  the event → 500 → transient → retried until dead (`policy.ts:42-46`), while McLeod has nothing to do with the
  evidence (D-MK1 "evidence never depends on McLeod").
- Fix text: the call is wrapped `begin perform public.mcleod_write_enqueue(…); exception when sqlstate 'MW001'
  or … or unique_violation then v_write_note := 'enqueue_refused:' || sqlstate; end;` — named SQLSTATEs only,
  never `others`; the note goes into the `stop_completed` payload and the office exceptions feed. Matrix:
  "a refused enqueue still records the stop, its photos and its event".

### DR-18 [IMPROVE] — Drop `p_mcleod_write` from M-A's signature
- Evidence: A adds `p_mcleod_write boolean default false` so the API can pass the env switch (`A:283-286`,
  `:650-655`); AUDIT §2.1 replaces that switch with `mcleod_write_switches` + one env master switch.
- Fix text: the SQL reads the switch table itself; M-A adds only `p_action_id`. Removes a dead parameter, the
  extra `loads.external_id` read in `completeStop` (A-56), and one future signature change (A-10's drop+grant
  dance) on the function D also rewrites (X 1.12).

### DR-19 [GAP] — C-A3 ("action id required") has no adoption condition, and with store-only delivery may never be safe
- Evidence: A-43 is not carried into AUDIT §2; a pre-C-A2 build sends no `action_id` → 422 → `dead`. The only
  version signal is push registration `app_version` (`apps/api/src/modules/messaging/routes/notifications.ts:182`).
- Fix text: drop C-A3 from v2, or gate it on "every driver device that synced a load action in the last 30 days
  reports `app_version` ≥ the C-A2 build", with the query written in the step. Keeping `.optional()` costs only
  the state-based fallback that already exists.

### DR-20 [GAP] — CI and release facts for the driver merges are still missing from v2
- `native-android` runs on every `apps/driver/` PR (`.github/workflows/ci.yml` `NATIVE_INPUTS`, A-53) — not in
  AUDIT §2; state it for C-A2/C-K3. GitHub "Approve and run" for bot-pushed driver workflow runs (v1 §2 item 5,
  X §6.1 "not placed") now applies to `driver-store.yml`'s tag trigger; place it in the DR-3 step. No iOS CI job
  exists (repo CLAUDE.md) — the iOS store build is the first iOS compile of these screens.

### DR-21 [OK-with-correction] — Migration/merge sequencing for the driver-facing steps
- S0a (schema + backfill + RPC, no code) → S0b code after S0a is current on staging: holds (`A:118`).
- **"N2 must not precede S0b in production"**: M-A alone exposes nothing to the app (the app reads loads only
  through `/api/me/loads`, `useLoads.ts:58`), so the binding edge is C-A1 ↔ S0b. In a release migrations run
  first and code ships together, so S0b and C-A1 **in the same release** is safe (stop ids stable from the moment
  the code serves). State the rule as "C-A1 never reaches production in a release that does not also contain
  S0b" — X §3.3's "C-A1 → S0b in production" is stricter than needed.
- S0c "≥ one release after S0b": the reason A gives (old code's `onConflict: load_id,seq` during the deploy
  window) is right only for a ROLLBACK — once S0b serves, nothing upserts on `(load_id, seq)` (grep: only
  `mirrorLoads.ts:124` and `tmsLoadIngestWriters.ts:162`, both removed by S0b). Write the reason as "so that a
  `release.yml` rollback to pre-S0b code still finds the unique index". With DR-5's fix S0c shrinks to the CHECK
  restore.
- M-K1 after S0b live; C-K2 after M-K1 current: hold. C-A2/C-K3 timing is a store question (DR-3, DR-4).

### DR-22 [IMPROVE] — The driver is never told why a load vanished, and photos captured but not yet queued are lost
- Evidence: when the load leaves the cached list, the stop screen shows "This stop is no longer available. Return to
  Loads and refresh" (`[stopId].tsx:69-76`) and the in-component `captures` (`:54`, not yet enqueued) are dropped.
  O-5 stores only what was queued.
- Fix text (C-A2): keep the last-seen load in the screen while `captures.length > 0` and offer "Send these photos
  to the office" (enqueued as a normal stop action, admitted by DR-7's predicate); the list shows a one-line toast
  "Dispatch moved {ref} to another driver" when a load with queued or recent work disappears.

### DR-23 [IMPROVE] — A worked stop McLeod removed stays in the driver's and office's list as if McLeod still had it
- Evidence: worked stops are kept by design (`mirrorLoads.ts:18-21`, S0 step 3) with no marker. Fix: the same
  `mcleod_removed_at` as DR-6 (stamped, not deleted), shown as "Removed by dispatch" in both apps.

### DR-24 [OK] — Things v2 relies on that do hold
- Action id = `record.id` read from the record survives a store update: the outbox is on-device SQLite and the
  handler receives the full record (`sync.ts:63, 131`); the legacy-record pattern exists (`handlers.ts:225-230`).
- A successful action on a load that is no longer visible returns 200 `{load:null}` (`driverLoads.ts:221`,
  `me.ts` `runLoadMutation`) → `done`, not Needs attention — O-5 needs no app change for queued work.
- Storage insert is own-folder only, no load check (`0085:298-304`) — uploads after a reassignment succeed.
- `driver_complete_stop` never checks stop order — fine for evidence; order matters only for the McLeod write
  (DR-9).

### DR-25 [GAP] — MK3's "dispatched driver unchanged" check must compare McLeod's seats, not the actor
- Evidence: AUDIT §2.2 lists "the dispatched driver is unchanged" without saying against what; with O-3 the
  co-driver completes stops. Fix text: `expected` snapshots McLeod's movement driver codes at enqueue; the agent
  compares McLeod's codes at write time with that snapshot; the actor is never compared. Test: "a stop completed
  by the co-driver is written, not conflicted".

### DR-26 [GAP] — Tests v2 must add (named), beyond spec A's lists
- `supabase/tests/load-stops-mcleod-identity.test.mjs`: DR-2, DR-5 (three titles), DR-6.
- `supabase/tests/driver-load-actions.test.mjs`: DR-7 (five), DR-9 (late-Arrive replay), DR-11, DR-12, A-14's
  "a replayed owner-operator decline is a no-op, not DL002", A-15's "an action id reused for another stop of the
  same load is refused (DL012)".
- `supabase/tests/mcleod-write-requests.test.mjs` (or C's pipeline matrix): DR-8 (two), DR-17, DR-25.
- `supabase/tests/load-lifecycle.test.mjs:151` rewritten (A-12); `supabase/tests/loads-co-driver.test.mjs` gains
  "the co-driver of a dispatched McLeod load sees it" (the existing file asserts only the column, `:68-92`);
  `loads-mirror-status-guard.test.mjs` keeps `:145, :155, :165` (A-17); `rls.test.mjs:2246` and
  `definer-rpc-grants.test.mjs:142` helper rename (same merge as M-A).
- `apps/driver/src/data/policy.test.ts`: DR-9 (two), DR-10. `apps/api/src/modules/loads/driverLoads.test.ts`: DR-15.
  `apps/driver` contract parse: DR-4. `packages/shared/src/loadOnTruck.test.ts:100` replaced (A-18).
  `offerDeckModel` "an unacknowledged McLeod load leads the Upcoming list" (A-19, not carried into AUDIT §2).

---

## Part 4 — Scenarios

| # | Scenario | Today | Planned (v2 as ruled) | Verdict |
|---|---|---|---|---|
| a | Dispatched load seen before start | Invisible: `approved` is not a driver status; appears only after McLeod has a `D` stop, i.e. after the dispatcher already cleared the pickup — no app at the pickup (`0371:64-74`, `mcleodLoadProjection.ts:136-142`). Co-driver never. | Visible to both seats as "Dispatched" with "Got it" the moment 360 Dispatch is pressed. | **Better, correct** — but a dispatch to a non-seat / uncovered load is still silent (DR-14), and nothing reaches a phone until the first store release (DR-3). |
| b | Offline 3 h: Arrive + photos + Complete, reconnect | Stop ids churn on every ETA re-post (`agent.mjs:891`, `mirrorLoads.ts:102-128`) → queued actions DL005 → `dead`; photos orphaned. True airplane mode keeps order; flaky "connected" coverage lets Complete overtake Arrive. | S0 ids stable; action ids; FIFO per stop. Works in airplane mode. Flaky coverage: Arrive can exhaust 8 attempts → `dead` → Complete goes through → arrival lost (DR-9, DR-10); if dispatch cleared the stop meanwhile → `conflict` noise (DR-8). | **Much better, not complete** — needs DR-9 (Complete carries its Arrive, per-load FIFO), DR-10, DR-8. |
| c | Dispatcher re-sequences / adds a stop while driver offline | Pending stops recreated with new ids (queued actions die); a worked stop is overwritten with its seq-neighbour's data (DR-2). | Ids stable; but until S0c the load is DEFERRED — no update at all, new stop invisible (DR-5); a pending stop McLeod removed is hard-deleted and the driver's evidence on it dies (DR-6). | **Better after S0c; regression in the S0b→S0c window** — fix DR-5, rule DR-6. |
| d | Load repowered to another driver mid-trip | Same movement: `driver_id` rewritten → old driver loses it; new driver needs a new 360 Dispatch. Split: remaining stops move to a new movement = new 360 load. | Same, plus O-5 stores the old driver's late evidence — but O-5's predicate is unwritten and refuses the co-driver; repower leaves the load visible to nobody with no office signal. | **Partly better** — write DR-7's predicate, DR-14's exception, DR-6 for moved stops. |
| e | Team drivers both tapping | Co-driver cannot see the load. | Both see and act; separate "Got it"; arrival from one seat + departure from the other form one clearStop. Second phone's Arrive on a done stop → DL003 → Needs attention (DR-12); second Complete drops its photos (DR-11). | **Better, two gaps** (DR-11, DR-12, DR-25). Thumbnails moot (DR-13). |
| f | Driver taps Complete twice | Second is a silent no-op; its photos are uploaded but never recorded (DR-11). | Same no-op; no second McLeod request (state check returns before enqueue). Photo loss unchanged; v2's banner invites more of it. | **Same as today — fix DR-11.** |
| g | McLeod already cleared the stop (dispatcher) | App ignores McLeod `D` (`loadsContract.ts:163-174`); driver may work it again; nothing is written to McLeod. | `nextStop` skips it; banner "Dispatch has this stop done"; Complete still enqueues → pre-write check → `conflict` → office exception + driver "Dispatch will fix this". | **Wrong as planned** — DR-8: no request at enqueue, `already_in_mcleod` at write, never an exception. |
| h | App update mid-trip with old queued actions | No action ids anywhere; state-based idempotency only. No OTA exists since 2026-10-22. | New build sends `record.id` for old records too (works). Old builds keep posting without ids until C-A3 → then 422 → dead. Store-only delivery: adoption slow, unforceable; app built from main can outrun production API (DR-4). | **Better for drained records; BLOCKER on build/API skew (DR-4); C-A3 needs DR-19.** |
| i | Owner-operator decline | Manual only (McLeod loads never `offered`); a replay writes a second `declined` and, after unassign, the replay is DL002 → dead. | Manual: dedupe before visibility makes the replay a no-op (AUDIT §2.4). McLeod: decline refused DL014 and never offered. | **Better, correct.** |
| j | Delivered load disappears | Never disappears (no window) unless re-dispatched or re-seated; the load bounces Previous→Current after the driver's last stop because the sweep restores McLeod's status. List grows for ever. | Phase from stop state: stays in Previous once every stop is behind the truck, regardless of `loads.status`. Still no window; unchunked nested reads hit the 1,000-row cap / header limit at ~385 loads (DR-15). | **Better behaviour, latent scale failure** — DR-15. |

---

## Part 5 — Summary

**Counts (26 findings):** BLOCKER 1 · WRONG 3 · REGRESSION 1 · GAP 13 · IMPROVE 4 · OK 4 (DR-21 is OK with a correction).

**Top 10**
1. **DR-4 [BLOCKER]** A `driver-v*` store build tagged on main can require API fields production does not serve (release train keeps production behind main); with `source` required the Loads tab fails to parse, and a store app cannot be hot-fixed. Fix: tag only commits already in `origin/production`, and default every new app-read field.
2. **DR-3 [WRONG]** The driver rollout assumes OTA/APK lanes deleted on 2026-10-22 (`d313fa8a1`). The only lane, `driver-store.yml`, has never run; there is no EAS project; the app is in neither store. Every driver benefit of v2 waits on the first store release, and that release must carry C-A2.
3. **DR-8 [WRONG]** A stop the dispatcher already cleared in McLeod (today the only way a stop gets `D`) becomes a `conflict`: an office exception plus a "Dispatch will fix this" line on the phone. Fix: no request at enqueue, and a non-exception `already_in_mcleod` outcome at write.
4. **DR-5 [REGRESSION]** Between S0b and S0c, any stop inserted mid-movement (`seq` counts non-drawn stops) or any swap defers the whole load. Driver and office stop getting updates. Fix: an in-RPC scratch band (widen the CHECK from 1–50) instead of the exception arm.
5. **DR-9 [GAP]** Per-stop FIFO does not save the arrival when the Arrive dead-letters, and it lets a later stop clear before an earlier one. Fix: the Complete carries its Arrive (time plus action id); FIFO per load, built in the pure `pickNext`; the agent clears stops in movement order. Round-1 A-21's airplane-mode recipe cannot reproduce the bug.
6. **DR-7 [GAP]** O-5 is ruled but its predicate is not written. The dedupe protects only replays. A McLeod repower and the co-driver are not covered.
7. **DR-11 [GAP]** A second Complete (a team member, or v2's "you can still add photos") uploads photos that are never recorded (`0141:310-312` returns before `:350`). This happens today and v2 makes it more likely.
8. **DR-6 [GAP]** S0 hard-deletes a pending stop McLeod removed, so the driver's queued evidence on it dead-letters (DL005). A split/relay moves stops between loads. Rule a soft-remove.
9. **DR-15 [GAP]** There is no history window, and the stop/photo reads are unchunked. A driver hits the 1,000-row cap at about 385 loads, and the current load's stops can be among the dropped rows. Window the list only, never the visibility predicate.
10. **DR-14 / DR-17 [GAP]** A dispatch nobody can see is silent; derive "Not in {name}'s app" from `driver_visible_load_ids`. Separately, the McLeod enqueue inside `driver_complete_stop` must never fail the driver's evidence: catch named SQLSTATEs only.

Also: DR-10 (transient retries dead-letter a stop in minutes), DR-12 (team Arrive after Complete is DL003), DR-16 (the B6 pin cites `loadsDispatchedTo`, which C-A1 deletes), DR-19 (C-A3 needs measured adoption, or drop it), DR-21 (same-release S0b + C-A1 is safe; S0c's real reason is rollback safety), DR-2 (S0 fixes a silent corruption of worked stops today; test it).

**Is the planned result better than today?**

**Yes, on the data path and for the office.** It is only potentially better for drivers.
- **Data path:** S0 ends stop-id churn on every ETA update and the overwriting of worked stops. The action-id dedupe ends replay dead-letters. One SQL visibility rule closes the live hole (acting on an undispatched McLeod load). Co-drivers are admitted. "Got it" replaces an Accept that could never work. The load no longer bounces back to Current.
- **Drivers:** today no driver uses the app at all, and a McLeod load would appear only after the pickup was already cleared. The plan gives the right flow, but it reaches nobody until the never-run store lane ships C-A2 (DR-3/DR-4).
- **Two places where v2 is worse until fixed:** the S0b→S0c freeze (DR-5), and the conflict flood once MK3 goes live (DR-8).
- **Fix before claiming "works every time":** DR-9, DR-10 and DR-11, without which offline evidence can still be lost.
