# Council round 2 — lens 1: the write pipeline's correctness and reliability

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` @ `4876449c7`. Read-only. Inputs: `AUDIT-2026-11-20-API-KIT-SPECS.md`
(§2, §5), `api-kit-audit/C.md` "Reconciled schema proposal" (C.md:264-351), `A.md`, `WS.md`, specs A §1/§3/§5/§6 and
C §1/§3/§5. Every claim below was re-checked at the cited line. Postgres behaviour marked **[PGlite]** was executed
(PGlite, this session): scripts `scratchpad/council/pg/t1.mjs` (FK restrict vs org cascade), `t2.mjs` (15 scenario
assertions against the corrected design below, 15/15 pass), `t3.mjs` (claim cost at a year of history),
`schema.sql` (the corrected DDL + claim + fence, runnable).

Verdict: the reconciled direction (immutable intent + append-only facts + derived state + in-transaction
enqueue) is the right one and I recommend keeping it. As written it has **four double-write paths, one switch
bypass, one ordering bug that makes the derived state nondeterministic, and two DDL lines that contradict the
audit's own resolutions.** All are fixable inside the same three tables.

---

## Findings

### P-1 [BLOCKER] There is no fence between the lease and the McLeod call; the lease is shorter than one request's worst case — the same agent re-leases and re-sends its own in-flight `clearStop`
- Evidence: lease 120 s, ≤ 5 rows (`C-transport.md:44`); read timeout 15 s with retries 1/2/4 s (`:130`, `:173`) ⇒ a
  precheck can take 4×15+7 = 67 s, the write 30 s (`:131`), the verify another 67 s: **≈164 s for ONE request, ≈820 s
  for a batch of five**, against a 120 s lease. Expiry is lazy, done only inside `mcleod_write_claim` (C.md:343), and
  the audit moves claims onto **their own timer** (AUDIT §2.7 "write claims run on their own timer, not in the agent's
  one-at-a-time job loop"). So the 15-s timer fires while the batch is still in flight, the claim sees an expired
  lease, writes `lease_expired` + a new `leased`, and the agent (same process or a second one, P-11) runs precheck
  on a stop whose first `clearStop` is still in McLeod's hands → `absent` → second `clearStop`.
- The proposal's only guard is "lease_id must be the newest `leased`" at **settle** (C.md:344) — after the McLeod
  call. Nothing checks the lease **before** the call.
- Fix (exact): add event kind `send_started` and RPC `mcleod_write_begin_send(org, request, lease, instance,
  send_window_s := 90, max_sends := 3) returns text`, called immediately before every McLeod write. Under the org's
  advisory lock it returns `go` and inserts `send_started` only when: the request has not ended; `lease` is the
  newest `leased` for it and is live; `lease_expires_at >= now() + send_window` (DB clock); no `applied_unverified`
  exists; `count(send_started) < max_sends`; and the switch still admits it (P-5, P-24). Any other answer → the agent
  does not call McLeod. Lease 300 s per request. The agent runs **one claim/process loop at a time** (single-flight
  flag), and the write call has an **absolute** 30 s deadline (P-26), so `send_window 90 s > write deadline 30 s +
  settle POST`. [PGlite] t2: "a second claim gets nothing while the lease is live", "fence says go",
  "off: fence refuses a second send".

### P-2 [BLOCKER] §2.2's pre-write check classes OUR OWN landed write as a `conflict`
- Evidence: AUDIT §2.2: "the pre-write check compares: … its status is not already cleared … **Any difference is
  recorded as `conflict`**". The commonest crash window — agent applied, crashed (or the API was deploying) before
  settle — leaves the stop cleared **with our times**; the next lease's precheck sees "already cleared" → `conflict`.
  Spec A had the right rule (`A-driver-loads.md:672-674` "McLeod already `D` with our departure → `confirmed` without
  a write") and spec C too (`C-transport.md:633-634` `pre.state = same → already_applied`); the audit's restatement
  dropped it. Result: every crash-after-apply shows the driver "Dispatch will fix this in McLeod" and puts a false
  item in the office's exceptions, and the request never reaches `confirmed`.
- Fix (exact text for §2.2): "Cleared in McLeod **with our arrival and departure** (after normalising both to the
  precision MK0 measured, P-14) → `confirmed`, reason `already_applied`, no write. Cleared with other times →
  `conflict`, reason `cleared_in_mcleod`, `observed` = McLeod's times. Not cleared → proceed to `begin_send`."

### P-3 [WRONG] `settle` accepts only `confirmed` from a stale lease, so a 2xx reported late is discarded and the request is re-sent
- Evidence: C.md:344 "`lease_id` must be the newest `leased` for `refused/conflict/transient`; `confirmed` from any
  lease". `applied_unverified` is in neither list; under the "newest lease" rule a slow agent's "McLeod said 2xx"
  (lease already re-issued) is refused, so the new lease has no 2xx on record and its precheck — if McLeod's read is
  not yet showing the clear — sends again. This is exactly the re-send C-15 was meant to prevent.
- Fix: "Facts about McLeod's side of the wire (`send_started`, `applied_unverified`, `confirmed`) are accepted from
  **any** lease of the request. Decisions (`transient` backoff, `refused`, `conflict`) only from the newest lease;
  from a stale one the call returns the current state and inserts nothing."

### P-4 [WRONG] Event order is `at default now()` — events written in one transaction tie, so "newest event" is nondeterministic
- Evidence: C.md:307 `at timestamptz not null default now()`; `now()` is the **transaction start** time. The claim
  inserts `lease_expired` then `leased` for the same request in one call (C.md:343), so both rows carry the same
  `at`; the index `(request_id, at desc)` (C.md:313) cannot order them, and "newest `leased`", "no later fact" and
  the derived state can flip between reads.
- Fix: `seq bigint generated always as identity` on events (and switches); every "newest" is `order by seq desc`;
  `at` defaults to `clock_timestamp()` for display only. Drop `lease_expired` as a stored kind: a lease is live while
  `now() < lease_expires_at` and no result row carries its `lease_id` — derived from the DB clock, nothing to write
  (deriving beats restating; it also removes the lazy-expiry branch entirely). Stall alert W4 counts "leases that
  ended with no result" by the same derivation.

### P-5 [BLOCKER] `test` mode is a switch bypass: any company set to `test` writes every driver stop, with no proof
- Evidence: C.md:340 `mcleod_write_allowed`: "`test`/`live` → true". The live-needs-proof constraint
  (C.md:328) binds only `live`. Nothing ties `test` to a test company (no registry exists — C-14's "flag
  `is_test_company`" was not carried into the DDL). An admin who sets `stop_clear / TMS / test` has production live.
- Fix: modes keep their names, meanings change:
  - `test` leases **only `origin = 'prove'`** requests (admin-created, one stop at a time, `requireFreshAuth`). No
    driver request is enqueued under `test`.
  - `canary` leases driver requests whose `canary_key` is listed, and **requires `proven_by_request`** = a confirmed
    `prove` request of the same operation (any company of the org — the test company).
  - `live` requires `proven_by_request` = a confirmed **`driver_app`** request of the **same org, operation and
    company**, leased under a `canary` row (the leased event records `switch_id`, so "issued under canary" is a join,
    not a timestamp guess).
  - The chain is therefore off → test → (prove confirmed) → canary → (canary request confirmed) → live, and no step
    is skippable. No deadlock (C-12): `test` needs no proof and admits prove requests.
  [PGlite] t2: "test mode does not lease a driver_app request".

### P-6 [GAP] Canary keyed by the request's target cannot select driver stops
- Evidence: C.md:340 `canary → target = any(canary_targets)`; for `stop_clear` the target is the McLeod stop id,
  unknown until the stop exists. A canary of "these stops" cannot be set ahead.
- Fix: `mcleod_write_requests.canary_key text` filled by the enqueuer per operation (for `stop_clear`: the
  completing driver's McLeod driver id; for driver updates: the McLeod driver id; for images: the order id), and
  `mcleod_write_switches.canary_keys text[]`. The operation registry in `@silvicom/shared`
  (`MCLEOD_WRITE_OPERATIONS`) names what the key is per operation.

### P-7 [WRONG] The DDL keeps the `auth.users` FKs the audit resolved away
- Evidence: C.md:284 `requested_by uuid not null references auth.users(id)`; C.md:324 `changed_by uuid not null
  references auth.users(id)`. AUDIT §2.1: "`requested_by` is **not** a foreign key to `auth.users`, so it does not
  block `revokeDriverLogin`". `revokeDriverLogin` deletes the auth user (`driverCredentials.ts:236-253`, A-33); the
  default NO ACTION FK makes that delete fail for every driver who ever completed a McLeod stop, and every admin who
  ever flipped a switch. Also `driver_complete_stop`'s `p_actor_user` **defaults to null** (`0141:274`), so `not null`
  can abort the evidence transaction.
- Fix: `requested_by uuid` (nullable, no FK, comment "the login at the time, kept as evidence; logins are deleted");
  `driver_id uuid` (no FK; who the evidence is about) with an explicit `lint:driver-references` entry stating
  `merge_driver` moves it or why it is exempt; `changed_by uuid not null` with **no** FK.

### P-8 [GAP] `applied_unverified` has no backoff and no end — it is re-read every 15 s for 72 h
- Evidence: C.md:343 claim leases any open request with no live lease and `transient.not_before <= now()`;
  `applied_unverified` carries no `not_before` (C.md:301 "only on 'transient'"). C.md:344 "Never re-apply" but no rule
  ends it: ≈ 4 leases/min × 72 h ≈ 17,000 `GET /stops` per stuck request, and it ends as `stale_intent`, the wrong
  reason. Worse, `clearStop` answers **text/plain** "a string representing success **or failure**" (WS.md:37-39): a
  200 that says "failed" is a likely way to get here.
- Fix: `applied_unverified` carries `not_before = now() + 60 s` (read-back delay); each later read that still shows
  the stop uncleared is a `transient` with reason `not_visible_yet` and backoff 2/5/15 min; the **third** such read
  makes `settle` insert `conflict`, reason `accepted_not_visible`, with McLeod's 200 text in `mcleod_text` for the
  office. MK0 adds a probe: the exact text of a 200-with-failure from `clearStop` (stop not next / already cleared /
  bad date), so the agent can class it `refused` at once.

### P-9 [GAP] Outcome-unknown sends (timeout, 5xx, crash after `send_started`) are re-read immediately, while McLeod may still be applying
- Evidence: C-transport.md:641 "WsTransient / timeout → do NOT re-apply; settle transient (next lease's precheck
  decides)"; the next lease may come 15 s later. A server that kept processing after our client gave up shows
  "not cleared" to that read, and the second send lands on top of the first.
- Fix: the claim does not lease a request whose newest `send_started` is younger than `quiet_s = 300` and has no
  result; after the quiet period the read decides (cleared with ours → `confirmed`; uncleared → `begin_send` again,
  counted). `max_sends = 3`, then `conflict` `mcleod_keeps_failing`. MK0 probes "second `clearStop` on a cleared
  stop with the same times" (WS.md:41 lists it as undocumented); if McLeod no-ops it, the residual is harmless and
  the plan says so; if it rewrites or errors, the plan says that instead. [PGlite] t2: "quiet period after a send
  blocks immediate re-lease".

### P-10 [GAP] `settle` and `begin_send` are not idempotent across HTTP retries and API deploys
- Evidence: `service.mjs` retries a failed POST up to `POST_ATTEMPTS = 4` (`service.mjs:25`, `:58-99`), including
  after a timeout where the server may have committed. A retried `transient`/`applied_unverified` settle inserts a
  second row (only terminals are unique, C.md:312), which inflates exactly the counters P-8/P-9 cap on.
- Fix: every agent report carries `event_id uuid` (generated once per report, before the first POST attempt);
  `mcleod_write_events.id` = that id; the RPC does `insert … on conflict (id) do nothing` and returns the current
  state. A lost `claim` response needs nothing: its leases expire (300 s) and are re-leased. A lost `begin_send`
  answer is treated as **not** `go`; the orphan `send_started` then counts as an outcome-unknown send (P-9) — safe,
  costs one of three sends.

### P-11 [GAP] "One agent per org" is not enforced anywhere; the DB must be the fence
- Evidence: the lock is a **file on one machine**: `takeLock(CFG.lockPath)` with `lockPath =
  SERVICE_LOCK_PATH ?? beside("service.lock")` (`agent.mjs:95`, `:976`; `service.mjs:125-160`). Only `runService`
  takes it — one-shot modes (`--close`, `--loads-backfill`, the planned `--api-prove`) do not (`agent.mjs:1046+`). A
  lock untouched for 2 min is removed **even when its pid is alive** (`service.mjs:153-157`), and the old copy notices
  only at its next 30-s heartbeat (`LOCK_HEARTBEAT_MS`, `:109`) — a VM suspend or a blocked event loop gives two live
  copies. A second machine already runs agent code with an ingest token (`launchd/com.silvicom.mcleod-roster.plist.template`).
  The advisory lock (C.md:343) only serialises claim decisions; it does not stop a second instance claiming *other*
  requests, nor the in-flight double send of P-1.
- Fix: P-1's fence makes two instances safe (each request has at most one live lease, and only a live lease with
  ≥ 90 s left can start a send). `mcleod_api_agent_status` keyed `(org_id, instance_id)`, written by claim; alert
  "two connectors are claiming McLeod writes" when two instance ids claimed within 10 min. The `--api-prove` CLI
  drives the same claim/begin_send path, never a side door.

### P-12 [GAP] Read-before-write cannot protect non-idempotent operations (image upload, driver create)
- Evidence: image upload returns "a staged batch id or the stored record id, and you cannot tell which" (AUDIT W5);
  D-19 already found that lease expiry would RE-SEND an image; §2.6's fix ("a 2xx settles as confirmed") does not
  cover a crash between the POST and the settle. `drivers/create` re-sent after a crash makes a second McLeod
  driver, which O-6 forbids ("never a second create").
- Fix: the operation registry gets `after_unknown: 'read_decides' | 'office_decides'`. `stop_clear`, TableRowService
  field updates (same values, idempotent by value) → `read_decides`. `image_upload_*`, `driver_create` →
  `office_decides`: `begin_send` refuses a second `send_started` and the next lease settles `conflict`
  `outcome_unknown` ("McLeod may already have this — check before sending again"). `driver_create` additionally
  prechecks by a searchable natural key (MK0 decides which field holds the 360 id) and refuses to create on a hit.

### P-13 [GAP] Two open requests for one target can apply out of order
- Evidence: §2.1 allows "many edits per driver" (D-20); claim picks "open requests with no live lease" with no order
  per target (C.md:343). A medical-expiry update in backoff is overtaken by a newer one, then lands last: McLeod ends
  with the **older** value.
- Fix: claim leases a request only when no older open request exists for the same `(org, operation, company,
  target_id)`; index `(org_id, operation, company_id, target_id, requested_at)`. [PGlite] t3 (in the claim).

### P-14 [WRONG] "Minute precision" is assumed; the format and our own SQL read carry seconds
- Evidence: AUDIT §2.2 "Exact-match rules for times use the **minute** precision of the `/ws` Date format (W6)", but
  W6/WS.md:46 is `yyyyMMddHHmmssZ` (seconds). Spec C asserts "McLeod stores minute-precision Central wall time"
  (`C-transport.md:672`), yet the agent reads stop actuals as `CONVERT(varchar(19), …, 126)` with seconds
  (`queries.mjs:381-382`). The phone sends milliseconds (`useLoads.ts:179,251` `new Date().toISOString()`).
- Fix: MK0 probe "send 10:20:37 on a test stop, read back via `/ws` AND via SQL" records `stop_time_precision`
  (`second|minute`) in `mcleod_api_capabilities`. The agent **truncates what it sends** to that precision and
  compares truncated values, so read-back equality is exact, never a tolerance.

### P-15 [GAP] A time-zone mistake confirms itself; the only independent check is the SQL mirror
- Evidence: the agent would format the write and parse the read-back through the same function; a wrong zone
  (W6 `useServerTimezone` on our install unknown) round-trips equal and settles `confirmed` 5–6 h off. The SQL feed
  is an independent path (`centralTime.mjs` + `queries.mjs:381`) and already brings McLeod's actuals into
  `load_stops.actual_*` (spec C §1 diagram, W5 at `C-transport.md:694`). DST's repeated hour resolves to the first
  pass (`centralTime.mjs` header) — a 01:30 CST departure on the first Sunday of November reads back an hour off.
- Fix: promote W5 from "warning" to the **acceptance test of the operation**: MK0's proving run must show the SQL
  mirror equal to the request's times for every proving request before `canary`; in production W5 stays (critical
  after 3 disagreements a day). The send formats with an explicit offset when our install's Date pattern has `Z`; if
  it is the zone-less pattern, `centralTime.mjs` owns the conversion and the repeated-hour case is refused as
  `conflict ambiguous_local_time` rather than guessed.

### P-16 [GAP] The phone's clock is written into McLeod unchecked
- Evidence: `occurred_at: z.string().optional()` (`loadsContract.ts:148`), passed through (`driverLoads.ts:260,275,299`),
  used as `v_now := coalesce(p_occurred_at, now())` (`0141:287`) — the departure in the request. A phone set to the
  wrong day writes a future or week-old departure into the carrier's dispatch system.
- Fix (in the enqueue): request only when `arrival_at is null or arrival_at <= departure_at` and
  `departure_at <= now() + interval '2 minutes'` and `departure_at >= now() - interval '72 hours'`; otherwise no
  request, event payload `mcleod_write: 'implausible_time'`, shown to the office. Evidence is still stored.

### P-17 [GAP] A pipeline bug aborts the driver's evidence
- Evidence: the enqueue is a plain insert inside `driver_complete_stop` (A §6.3); any check violation (e.g.
  `octet_length(payload) <= 16384`, `target_id` length, `expected` shape) or a unique violation on
  `(stop_id, operation)` (only `on conflict (id)` is handled, A §6.3) rolls back the stop completion. D-MK1: the
  evidence row "never depends on McLeod".
- Fix: wrap only the enqueue in `begin … exception when others then v_write_note := 'enqueue_failed:' || sqlstate;
  end;` (a subtransaction; the evidence commits), use `on conflict do nothing` (no target: covers the partial unique
  index), and make W6 the invariant "a `stop_completed` on a tms load whose payload says `enqueue_failed`, or
  `mcleod_write = 'off'` while the switch admitted that driver" → critical.

### P-18 [GAP] O-5 is not enforced at enqueue, and `expected` lacks the dispatch to compare against
- Evidence: O-5 ruled "evidence for a load re-dispatched away from the driver is stored … never sent to McLeod";
  §2.2's precheck compares "the dispatched driver is unchanged" but A §6.3's `expected` holds only status and
  actual times.
- Fix: enqueue only when the completing driver is the current dispatch's driver or co-driver (O-3); else
  `mcleod_write: 'not_dispatched_to_driver'`. `expected` = `{external_status, actual_arrival_at,
  actual_departure_at, movement_id, mcleod_driver_ids: [d1, d2], seen_at}`; precheck refuses (`conflict
  dispatch_changed`) when McLeod's movement driver1/driver2 no longer contains the request's driver.

### P-19 [WRONG] §2.2 says `claimNext` "keeps" FIFO per stop; it does not today
- Evidence: `apps/driver/src/data/outbox.ts:95-110` claims the oldest **due** record across all records; a failed
  Arrive in backoff lets the Complete go first (A-21). §2.2's present tense reads as existing behaviour.
- Fix: "C-A2 changes `claimNext` to skip a `load_stop` record while an older non-`done`, non-`dead` record with the
  same `payload.stop_id` exists" + the A-21 test title.

### P-20 [GAP] A `prove` request on a pending stop makes the org's stop mirror fail every sweep
- Evidence: [PGlite] t1: deleting a `load_stops` row referenced by `on delete restrict` raises
  `violates RESTRICT setting`. S0's `apply_mcleod_load_stops` deletes pending stops McLeod removed (A §1.2 step 3)
  and catches only `unique_violation`; a proving request targets a **pending** stop of the test company (the driver
  never touched it). If that stop is removed in McLeod, the FK error aborts the whole RPC call, i.e. the mirror for
  that org stops writing stops. Driver requests are safe (a completed stop is never deleted).
- Fix: `prove` requests carry no `load_id`/`stop_id` (their target is the McLeod stop id in `target_id`); the
  stop constraint becomes `target_type <> 'stop' or origin = 'prove' or (load_id, stop_id, movement_id not null)`.

### P-21 [OK] Org deletion with the `restrict` FKs works; loads and stops with requests cannot be deleted, which is intended
- [PGlite] t1/t2: deleting the organization cascades through requests (incl. a `supersedes` self-reference),
  events and switches without error, whichever FK was created first; deleting a referenced load or stop alone is
  refused. No code path deletes a load (`load_events` guard, `0370:31-33`); S0 never deletes a worked stop. The
  append-only trigger must stay `before update` only (0532 shape, `0532_scanner_relay.sql:163-180`) or the cascade
  breaks.

### P-22 [GAP] Deriving the open set is unbounded in time
- Evidence: C.md:266 "terminal rows excluded by partial index" — no partial index can say "has no terminal event in
  another table"; the claim scans all of an org's requests every 15 s (≈255,000/year).
- Fix: claim scans `requested_at > now() - interval '8 days'` (index `(org_id, requested_at)`), and ends
  `72 h < age ≤ 8 d` as `stale_intent`; the API-side watch scheduler runs one unbounded anti-join sweep daily for the
  agent-was-down-a-week case. [PGlite] t3, 260,000 requests: claim 52–57 ms, daily sweep 147 ms, driver read 2 ms.

### P-23 [IMPROVE] Switch ordering, friction and attribution
- `changed_at default now()` ties in one transaction → `seq` identity, `order by seq desc` (P-4).
- **Off is easy, on is hard**: `off` = any holder of `mcleod.connection`; `test/canary` = admin + `requireFreshAuth`;
  `live` = owner + `requireFreshAuth` (C-23).
- Each `leased` event records `switch_id` (P-5 proof join, and "which rule let this through" for an incident).

### P-24 [GAP] Turning a switch off mid-flight is unspecified
- Fix (state it): off stops **new leases at the next claim** and **new sends at `begin_send`** (P-1), so at most the
  one HTTP call already on the wire completes; leased-not-sent requests return `switched_off` and are settled
  `transient` with no backoff (they wait, unleased). Queued requests stay queued while off; past 72 h they end
  `conflict stale_intent` — a long off therefore floods the office feed, so turning off for more than a day is a
  documented act ("expect N stale items"), and the switch card shows the open count before saving. L1 (API env) is
  checked in **three** places — enqueue, the claim route, the `begin_send` route — so a half-set flag cannot claim
  or send (C-22).

### P-25 [GAP] Observability: what tells a person writes are failing
Present in spec C §5.8 (W1–W7) but written for C's mutable model. Missing / to change:
1. W2 per instance + the two-instance alert (P-11).
2. `applied_unverified` older than 30 min (P-8) — warning; `accepted_not_visible` — each one immediate.
3. W5 critical as the end-to-end truth check (P-15).
4. W6 rewritten as P-17's invariant (cheap: one `load_events` read per 5 min).
5. Refused/conflict requests reach the **office exceptions feed**, which today reads only `load_events` kinds
   (A-31/32) — v2 must name the reader (recommend: the feed gains a `mcleod_write` source that reads the
   `mcleod_write_state` view through a `mcleod` module export, not a table read from `loads`).
6. `GET /api/integrations/mcleod/api-health` returns: last claim per instance, open count by state, oldest open
   age, last 24 h confirmed/refused/conflict counts, current switch per (operation, company). The dispatch board
   header shows a red line when the oldest open is > 30 min.
7. The driver sees per stop "Sending to dispatch / In McLeod / Dispatch will fix this" (A §6.5) from the same view.

### P-26 [IMPROVE] `node:https` `timeout` is an idle-socket timeout, not a deadline
- Evidence: spec C builds on `node:https` (`C-transport.md:158`) with `WS_WRITE_TIMEOUT_MS = 30_000` (`:131`);
  `request.setTimeout`/`timeout` fires only on socket inactivity, so a slow-drip response exceeds 30 s. P-1's send
  window depends on a real ceiling.
- Fix: a timer per call that `req.destroy(new WsTimeout())` at the deadline; test "a response trickling one byte
  per second is abandoned at 30 s".

### P-27 [OK, with reasons] Append-only events beat a mutable status row here — on the conditions above
- Alternative: C's original mutable request row (status + lease columns, optimistic `update … where status='queued'
  returning`, `SKIP LOCKED`) + an append-only attempts log. Its claim is simpler and O(1); but it still needs the
  attempts log for forensics ("did we write McLeod twice?"), and then the status column restates what the log says
  — two sources (CLAUDE.md "a copy is a workaround with a delay fuse"); the repo pins evidence tables append-only
  and `RETENTION_FORBIDDEN`. With `seq` ordering (P-4), derived lease expiry (P-4), the 8-day bound (P-22) and one
  view as the only reader, the derived model costs ≈ 55 ms per claim at a year's volume on PGlite, and one row
  less to keep consistent. **Recommend append-only.** The mutable alternative would win only if volume grew ~50×.
- The one mutable table stays `mcleod_api_agent_status` (health, not evidence).

### P-28 [OK] Advisory lock choice
- `pg_advisory_xact_lock(hashtextextended(…, 0))` is right: a session lock is released when PostgREST's request
  ends (`0506_platform_scheduler_leases.sql:28-29`), and the house uses the xact form (`0592`, home_time, cards).
  Conditions: the RPCs are `volatile` (PostgREST runs `stable` functions in a read-only transaction — the inserts
  would fail), `security definer set search_path = ''`, revoked from `public, anon, authenticated`.

### P-29 [IMPROVE] Small DDL corrections
- `lease_id uuid not null` (C.md:299) forces a fake id on claim-originated `stale_intent`; make it nullable, with
  `check (kind <> 'leased' or lease_id = id)`.
- Add `check` that nothing follows an end, by trigger (`MK012`, A-34) — the one-end unique index does not stop a
  `transient` after `confirmed`. [PGlite] t2 "nothing after an end (MK012)".
- Error codes `MK010/MK011/MK012` (A-38: MW010/MW011 are taken by 0551).
- `forbid_org_change` on append-only tables is redundant (UPDATE already raises) — harmless; keep for the house
  pattern.
- Index `mcleod_write_requests (stop_id) where stop_id is not null` — the driver/office read is by stop and the
  `driver_app` unique index is partial, so office retries are not covered.
- Budgets: events ≈ 4 per request (leased, send_started, applied_unverified, confirmed) → 2,800/day, not 2,100.

### P-30 [GAP] The derived state has no "head of chain" rule in SQL
- Evidence: A §6.4 "superseded requests read through to their successor"; C.md:345 offers "a SQL view or one TS
  function" without choosing. Two readers (driver app, office) plus the claim need the same answer.
- Fix: one view `mcleod_write_state` (below) with `superseded boolean`; every reader filters `not superseded`. No TS
  re-derivation.

---

## Final pipeline spec

### Tables (one migration; number taken at merge; after S0b is live)

```sql
-- 1. Intent. Immutable. PK = client action id (driver) or a server uuid (office retry / prove).
create table public.mcleod_write_requests (
  id            uuid primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  operation     text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),   -- registry MCLEOD_WRITE_OPERATIONS
  company_id    text not null check (length(company_id) between 1 and 10),
  target_type   text not null check (target_type in ('stop','movement','order','driver','tractor','trailer')),
  target_id     text not null check (length(target_id) between 1 and 40),
  canary_key    text check (canary_key is null or length(canary_key) between 1 and 40),
  load_id       uuid references public.loads(id) on delete restrict,
  stop_id       uuid references public.load_stops(id) on delete restrict,
  movement_id   text,
  payload       jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  expected      jsonb not null check (jsonb_typeof(expected) = 'object'),
  origin        text not null check (origin in ('driver_app','office_retry','prove')),
  supersedes    uuid references public.mcleod_write_requests(id) on delete restrict,
  requested_by  uuid,          -- no FK: logins are deleted (revokeDriverLogin)
  driver_id     uuid,          -- no FK: merge_driver handling stated in lint:driver-references
  requested_at  timestamptz not null default now(),
  constraint mcleod_write_requests_stop  check (target_type <> 'stop' or origin = 'prove'
                                               or (load_id is not null and stop_id is not null and movement_id is not null)),
  constraint mcleod_write_requests_retry check ((origin = 'office_retry') = (supersedes is not null))
);
create unique index mcleod_write_requests_driver_stop on public.mcleod_write_requests (stop_id, operation) where origin = 'driver_app';
create unique index mcleod_write_requests_supersedes  on public.mcleod_write_requests (supersedes) where supersedes is not null;
create index mcleod_write_requests_org_time on public.mcleod_write_requests (org_id, requested_at);
create index mcleod_write_requests_stop     on public.mcleod_write_requests (stop_id) where stop_id is not null;
create index mcleod_write_requests_target   on public.mcleod_write_requests (org_id, operation, company_id, target_id, requested_at);

-- 2. Facts. Append-only. Ordered by seq, never by time.
create table public.mcleod_write_events (
  id               uuid primary key,                     -- agent-supplied per report (idempotent retries); server default for leases
  seq              bigint generated always as identity unique,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  request_id       uuid not null references public.mcleod_write_requests(id) on delete restrict,
  kind             text not null check (kind in ('leased','send_started','transient','applied_unverified','confirmed','refused','conflict')),
  lease_id         uuid,
  lease_expires_at timestamptz,
  switch_id        uuid,                                 -- on 'leased': the switch row that admitted it
  not_before       timestamptz,
  reason_code      text check (reason_code ~ '^[a-z][a-z_]{2,39}$'),
  mcleod_status    integer check (mcleod_status between 100 and 599),
  mcleod_text      text check (length(mcleod_text) <= 500),
  observed         jsonb check (observed is null or jsonb_typeof(observed) = 'object'),
  instance_id      text not null check (length(instance_id) between 1 and 64),
  agent_version    text check (length(agent_version) <= 40),
  at               timestamptz not null default clock_timestamp(),
  constraint mcleod_write_events_leased     check ((kind = 'leased') = (lease_expires_at is not null and switch_id is not null)),
  constraint mcleod_write_events_lease_self check (kind <> 'leased' or lease_id = id),
  constraint mcleod_write_events_lease_ref  check (kind not in ('send_started','transient','applied_unverified','refused') or lease_id is not null),
  constraint mcleod_write_events_reason     check (kind not in ('refused','conflict') or reason_code is not null),
  constraint mcleod_write_events_not_before check (not_before is null or kind in ('transient','applied_unverified'))
);
create unique index mcleod_write_events_one_end on public.mcleod_write_events (request_id) where kind in ('confirmed','refused','conflict');
create index mcleod_write_events_request_seq   on public.mcleod_write_events (request_id, seq desc);

-- 3. Switches. Append-only; newest seq per (org, operation, company) wins.
create table public.mcleod_write_switches (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity unique,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  operation         text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),
  company_id        text not null check (length(company_id) between 1 and 10),
  mode              text not null check (mode in ('off','test','canary','live')),
  canary_keys       text[] check (canary_keys is null or cardinality(canary_keys) between 1 and 20),
  proven_by_request uuid references public.mcleod_write_requests(id) on delete restrict,
  changed_by        uuid not null,                       -- no FK
  reason            text not null check (length(btrim(reason)) between 5 and 500),
  changed_at        timestamptz not null default now(),
  constraint mcleod_write_switches_canary check ((mode = 'canary') = (canary_keys is not null)),
  constraint mcleod_write_switches_proof  check (mode not in ('canary','live') or proven_by_request is not null)
);
create index mcleod_write_switches_current on public.mcleod_write_switches (org_id, operation, company_id, seq desc);

alter table public.mcleod_write_requests enable row level security;
alter table public.mcleod_write_events   enable row level security;
alter table public.mcleod_write_switches enable row level security;
```
Triggers: `before update` → raise `MK011` on all three (0532 shape; DELETE left to the org cascade, all three in
`RETENTION_FORBIDDEN`); `forbid_org_change` on all three; `before insert` on events: request in same org (`MK010`),
nothing after an end (`MK012`); `before insert` on requests: load/stop in same org, stop on that load (`MK010`);
`before insert` on switches: `canary` proof = a `confirmed` `prove` request of the same org+operation; `live` proof
= a `confirmed` `driver_app` request of the same org+operation+company whose confirming lease's `switch_id` is a
`canary` row (`MK013`).

### The one reader
```sql
create view public.mcleod_write_state with (security_invoker = true) as
select r.id as request_id, r.org_id, r.operation, r.company_id, r.target_id, r.canary_key, r.stop_id, r.load_id,
       r.origin, r.supersedes, r.requested_at,
  case when t.kind is not null then t.kind
       when x.n_sends > 0 or x.n_applied > 0 then 'sent'
       else 'queued' end as state,                                      -- queued|sent|confirmed|refused|conflict
  t.reason_code, l.id as lease_id, l.lease_expires_at,
  (l.id is not null and l.lease_expires_at > now()
     and not exists (select 1 from public.mcleod_write_events e where e.request_id = r.id and e.lease_id = l.id
                     and e.kind in ('transient','applied_unverified','confirmed','refused','conflict'))) as lease_live,
  coalesce(x.n_sends, 0) as sends, coalesce(x.n_applied, 0) as applied_reports,
  x.last_send_at, x.max_not_before as not_before,
  exists (select 1 from public.mcleod_write_requests r2 where r2.supersedes = r.id) as superseded
from public.mcleod_write_requests r
left join lateral (select e.kind, e.reason_code from public.mcleod_write_events e
                    where e.request_id = r.id and e.kind in ('confirmed','refused','conflict') limit 1) t on true
left join lateral (select e.id, e.lease_expires_at from public.mcleod_write_events e
                    where e.request_id = r.id and e.kind = 'leased' order by e.seq desc limit 1) l on true
left join lateral (select count(*) filter (where e.kind = 'send_started')       as n_sends,
                          count(*) filter (where e.kind = 'applied_unverified') as n_applied,
                          max(e.at) filter (where e.kind = 'send_started')      as last_send_at,
                          max(e.not_before)                                     as max_not_before
                     from public.mcleod_write_events e where e.request_id = r.id) x on true;
```
- Driver app / load detail: `select * from mcleod_write_state where org_id = $1 and stop_id = any($2) and not superseded`
  (2 ms at 260k rows, t3).
- Office exceptions: `… where org_id = $1 and state in ('refused','conflict') and not superseded and requested_at > now() - interval '30 days'`.
- Exposed to the API through a `mcleod` module export; `loads` code never names the view.

### Function contracts (all `volatile`, `security definer`, `set search_path = ''`, service_role only)
| Function | Caller | Lock | Contract |
|---|---|---|---|
| `driver_complete_stop(…, p_action_id, p_mcleod_write boolean default false)` | `/api/me` | none | Evidence first. Then, in a subtransaction, if tms ∧ completed ∧ `p_mcleod_write` ∧ `mcleod_stop_id` ∧ driver on current dispatch (O-3/O-5) ∧ times plausible (P-16) ∧ switch admits (`canary` with key, or `live`): insert request `on conflict do nothing`. Event payload `mcleod_write: requested\|off\|no_mcleod_stop_id\|not_dispatched_to_driver\|implausible_time\|enqueue_failed:<sqlstate>`. |
| `mcleod_write_prove(org, actor, operation, company, target, payload, expected)` | admin route, `requireFreshAuth` | none | Only when the current switch is `test`; `origin='prove'`, no load/stop FK. |
| `mcleod_write_retry(org, request, actor)` | office route | org lock | Only when the head of chain is `refused\|conflict`; copies payload; re-reads `expected`; `supersedes`. |
| `mcleod_write_claim(org, instance, version, ops[], companies[], max, lease_s=300, quiet_s=300)` | agent | org lock | Ends `72 h < age ≤ 8 d` open+unleased as `conflict stale_intent`. Leases ≤ max open requests (≤ 8 d): no live lease, `not_before ≤ now()`, newest `send_started` older than `quiet_s`, no older open request on the same target, switch admits (`test`→prove only; `canary`→key listed; `live`). Returns `{request, lease, expires_at, sends, applied_reports, payload, expected}`. Upserts `mcleod_api_agent_status (org, instance)`. Refused by the route when L1 is off. |
| `mcleod_write_begin_send(org, request, lease, instance, send_window_s=90, max_sends=3)` | agent, right before McLeod | org lock | `go` (inserts `send_started`) only if not ended ∧ lease newest & live ∧ ≥ 90 s left ∧ no `applied_unverified` ∧ sends < 3 (`office_decides` ops: sends < 1) ∧ switch admits ∧ L1 on. Else `ended\|lease_lost\|lease_too_short\|already_applied\|send_cap\|switched_off`. |
| `mcleod_write_settle(org, request, lease, event_id, kind, reason, backoff_s, status, text, observed, instance, version)` | agent | org lock | `event_id` seen → return state. Ended → return the end. `applied_unverified`/`confirmed` from any lease. `transient/refused/conflict` only from the newest lease (else return state, insert nothing). `not_before = now() + least(backoff_s, 3600)`; `applied_unverified` gets 60 s. Third `not_visible_yet` after an `applied_unverified` → `conflict accepted_not_visible`; transient with `sends = max_sends` → `conflict mcleod_keeps_failing`. |

### State machine (per request; derived by the view)
| State | Means | Entered by | Leaves to |
|---|---|---|---|
| queued | no send recorded | request insert | sent (begin_send `go`), confirmed (precheck already_applied), conflict/refused (precheck), conflict stale_intent |
| sent | ≥1 `send_started` or `applied_unverified` | begin_send | confirmed (read-back), refused (4xx), conflict (`cleared_in_mcleod`, `dispatch_changed`, `accepted_not_visible`, `mcleod_keeps_failing`, `outcome_unknown`, `stale_intent`) |
| confirmed | McLeod holds our times (read) | settle | — (terminal) |
| refused | McLeod said no | settle | office retry → new request |
| conflict | McLeod differs / cannot tell | settle, claim | office retry or "keep McLeod's" |
Lease liveness is orthogonal (`lease_live`), never a state. Precheck verdicts: not cleared → send; cleared with ours
→ confirmed `already_applied`; cleared otherwise → conflict `cleared_in_mcleod`; stop gone while movement reads 200
→ refused `stop_gone`; movement 404/403 → transient (C-29); drivers changed → conflict `dispatch_changed`.

### Failure windows
| Window | Outcome | Why safe |
|---|---|---|
| Phone offline / outbox replays | one evidence row, one request | N7 dedupe + request PK = action id, `on conflict do nothing` |
| Complete syncs before Arrive | arrival kept | per-stop FIFO in `claimNext` (P-19) |
| API crash after commit, before 200 | outbox replays, no-op | N7; request already exists |
| Enqueue insert fails | evidence commits; `enqueue_failed` noted; W6 critical | subtransaction (P-17) |
| Phone clock wrong | no request; office sees `implausible_time` | P-16 |
| Claim response lost (API deploy) | leases expire in 300 s, re-leased | lease derived from DB clock |
| Agent crash after lease, before send | re-leased after 300 s; no send happened | no `send_started` |
| `begin_send` answer lost | agent does not send; orphan counted as one send; quiet 300 s then read | P-9/P-10 |
| Crash after `send_started`, McLeod applied | quiet 300 s → read cleared-with-ours → confirmed | P-2, P-9 |
| McLeod timeout/5xx, applied late | same as above | quiet period ≥ McLeod processing; cap 3 |
| McLeod timeout, not applied | read uncleared → send #2 (≤ 3) | read decides, capped |
| 2xx, read-back not visible | 60 s, then ≤ 3 reads with backoff → `accepted_not_visible` | never re-sent (`already_applied` at fence) |
| 200 carrying a failure text | as above, McLeod text kept for office | P-8; MK0 learns the text |
| Settle POST retried / API deploy | one event | agent event id PK (P-10) |
| Lease expires while call in flight | cannot happen for a send: fence requires ≥ 90 s left, call deadline 30 s absolute | P-1, P-26 |
| VM suspended mid-call (> lease) | late 2xx accepted from stale lease; new lease's fence sees `applied_unverified` or `send_started` + quiet | P-3, P-9 |
| Two agent instances | each request ≤ 1 live lease; send only via fence; alert | P-11 |
| VM vs DB clock skew | no agent clock in any decision; backoffs relative | DB `now()` only |
| Switch → off mid-batch | no new lease, no new send; ≤ 1 call already on the wire completes | fence re-checks switch |
| Dispatcher clears between read and send (< 1 s) | our clearStop may land on a cleared stop | residual; MK0 probes second-clear behaviour; same-day audit read (W8) |
| Image / create, crash after send | `conflict outcome_unknown`, office decides | `office_decides` (P-12) |
| Time-zone or precision error | caught by SQL mirror (W5) before canary | P-14, P-15 |
| Agent down a week | requests end `stale_intent` (daily sweep); W2 critical within 10 min | P-22 |

---

## Summary

30 findings: **BLOCKER 3** (P-1, P-2, P-5) · **WRONG 5** (P-3, P-4, P-7, P-14, P-19) · **GAP 16** (P-6, P-8, P-9,
P-10, P-11, P-12, P-13, P-15, P-16, P-17, P-18, P-20, P-22, P-24, P-25, P-30) · **IMPROVE 3** (P-23, P-26, P-29) · **OK 3** (P-21, P-27, P-28). The corrected design ran 15/15 scenario
assertions on PGlite; claim ≈ 55 ms at a year's volume.

Top 10:
1. **P-1** No fence before the McLeod call; a 120 s lease vs ≈164 s worst case per request, plus a separate claim
   timer, makes the agent re-send its own in-flight `clearStop`. Add `begin_send` + `send_started`, 300 s leases,
   single-flight, absolute deadline.
2. **P-2** §2.2 records our own landed write as `conflict`; restore "cleared with our times → confirmed".
3. **P-5** `test` mode writes every stop of any company with no proof; `test` = prove-only, canary and live each
   need a confirmed proof from the step before.
4. **P-3** A late 2xx from a stale lease is discarded and the stop is re-sent; McLeod-side facts are accepted from any lease.
5. **P-4** Events ordered by `now()` tie inside one transaction; add `seq` identity; derive lease expiry instead of
   writing `lease_expired`.
6. **P-11** "One agent per org" is a per-machine file lock (stale-removable with a live pid); the DB fence is the
   only real exclusion.
7. **P-9/P-8** Outcome-unknown sends need a 300 s quiet period and a 3-send cap; `applied_unverified` needs backoff
   and an end (`accepted_not_visible`), especially as `clearStop` can answer 200 with a failure text.
8. **P-12** Image upload and driver create are not read-back-able; they must never auto re-send after an unknown
   outcome (O-6's "never a second create").
9. **P-7** The DDL still has `auth.users` FKs on `requested_by`/`changed_by` that block `revokeDriverLogin`;
   `p_actor_user` defaults to null.
10. **P-14/P-15/P-16** Minute precision is assumed (seconds are on the wire), a zone error confirms itself unless
    the SQL mirror is the acceptance check, and the phone's clock reaches McLeod unchecked.
