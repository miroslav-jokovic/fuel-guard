# Round 4 / reviewer 1 — verify ROUND3 §2 (27 corrections)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` at `274dd5459` (origin/main `c9b1a54cf`). Read-only.
Scripts: `/private/tmp/claude-501/-Users-miroslavjokovic-Projects-FuelGuard/77d282ee-6821-4d7e-bafa-eb3616447ed2/scratchpad/round4/pg/`
(`tail.mjs`, `switch.mjs`, `identity.mjs`, `subtx.mjs`, `attempts.mjs`), each `node <file>`; PGlite imported by absolute path
as the council's `t2.mjs` does.

### V4-1 (ROUND3 §2.1) IMPRECISE
- `git ls-tree origin/main supabase/migrations/` now ends at **0640_tenstreet_intake.sql**: PR #2589 merged. "open PR #2589
  holds 0640" is stale; harmless, because §2.1 gives an order only.
- The order "B2 → S0a → M-A → pipeline → MK4 images" omits S0c, a migration (A:138; §2.19 gives it the 0453 re-key and the
  tail renumbering), and does not say which side of "pipeline" S0c sits. SEQ table N-15 puts S0c after S0b is in production.
- Fix text: "Migration order: B2 → S0a → M-A → pipeline → MK4 images; S0c lands at least one release after S0b is in
  production, independent of the pipeline. Numbers are the next free one at merge (main holds 0640 on 2026-11-20)."

### V4-2 (ROUND3 §2.2) IMPRECISE — the rule works, but three things it needs are not written
Current constraints (verified): `load_stops_seq_check check (seq >= 1 and seq <= 50)` (`0423:101-102`, originally inline
at `0085:122`); `idx_load_stops_load_seq` unique, non-deferrable (`0085:162-163`); both old writers upsert
`onConflict: "load_id,seq"` (`mirrorLoads.ts:124`, `tmsLoadIngestWriters.ts:162`).

PGlite `pg/tail.mjs` (today's DDL + S0a's unique `(load_id, mcleod_stop_id)` + DR-5's widened check + an RPC doing:
incoming → band; worked-removed → band; delete pending-removed; incoming → final; insert new; band → tail):
```
sweep1 (C removed, D->3):   ["A1*","B2*","D3","C4*"]
sweep2 (same):              ["A1*","B2*","D3","C4*"]          <- R3-2's failure is gone
sweep3 (E added at 4):      ["A1*","B2*","D3","E4","C5*"]
sweep4 (swap D,E):          ["A1*","B2*","E3","D4","C5*"]
band empty after commit:    0
tail > 50 (McLeod max 49, 2 removed worked): ERR violates check constraint "load_stops_seq_check"
old code ON CONFLICT vs deferrable: ERR ON CONFLICT does not support deferrable unique constraints ... as arbiters
old code (rollback) upsert at seq 5: ["A1*","B2*","F5*"]   <- new stop F inherits worked C's row
```
So two consecutive sweeps hold, and the deferrable claim is reproduced. What §2.2 leaves out:
1. **The band needs the widened CHECK.** Today's check is 1–50, so "the band" does not exist until S0a runs DR-5's
   `check ((seq between 1 and 50) or (seq between 101 and 150))`. §2.2 never says so, and A's S0c / DR-5 say S0c
   "restores `check (seq between 1 and 50)`". If S0c does that, every later sweep fails on the band move. See V4-19.
2. **The tail can exceed 50** (above). The RPC is "one call per projection batch" (A:79-80), so one over-long load
   aborts every load in the batch unless each load runs in its own sub-block. R3-2 had "refused by name, office sees
   it"; §2.2 dropped it.
3. **Order matters:** worked-removed stops must enter the band **before** new stops are inserted, or a new McLeod
   stop at the removed stop's seq collides (sweep 3).
- Rollback note (not new risk, but now likelier): on a rollback to pre-S0b code, a worked stop parked at the tail is
  overwritten by the next stop McLeod appends at that seq (last row above). That is today's DR-2 corruption; S0b's
  rollback line must say it.
- Fix text (§2.2): "S0a widens `load_stops_seq_check` to `(seq between 1 and 50) or (seq between 101 and 150)`, and
  nothing ever narrows it again while the band RPC exists. Per load, in its own `begin … exception` block: (1) claim
  null-id rows by seq; (2) move McLeod's stops **and** every worked stop McLeod no longer lists into the band; (3)
  delete pending stops McLeod no longer lists (§2.3); (4) set McLeod's stops to their seqs and insert new ones; (5)
  move the band's remaining (worked, removed) stops to `max(McLeod seq) + row_number() over (order by seq)`. If that
  passes 50, the load is skipped, returned in `refused: [{load_id, reason:'too_many_stops'}]`, and the office sees
  it; other loads in the call still apply. Matrix titles: 'two consecutive sweeps after McLeod removed a worked stop
  both apply'; 'a stop McLeod adds at a removed worked stop's old sequence is inserted'; 'a load that would pass 50
  stops is refused by name and the rest of the batch applies'; 'the band is empty after every apply'."

### V4-3 (ROUND3 §2.3) BROKEN — the "flagged event" loses the photos in 24 h, and it contradicts §2.6
- A pending stop has no driver evidence in the DB to copy: photos are inserted only by Complete (`0141:349-350`),
  and an Arrive makes the stop `arrived`, which is never deleted. So the "copy" is a snapshot; fine.
- The case that matters is the **queued** action. Its photos are uploaded to Storage **before** the POST
  (`handlers.ts:139-143`). With the stop row gone, `load_stop_photos` (`stop_id … not null references load_stops on
  delete cascade`, `0085:217`) cannot hold them, so they exist only inside a `load_events` payload. The `load-photos`
  reconciler deletes every object no `load_stop_photos` row names after a 24 h grace (`storageReconcile.ts:160-213`,
  `:297`). **The evidence §2.3 promises to keep is deleted the next day.**
- Today the RPC raises DL005 → 404 `stop_not_found` (`driverLoads.ts:43`), and §2.6 sends "a 4xx with a DL code" to
  Needs attention. "Lands on the load as a flagged event" needs the RPC to **accept** (2xx) instead. §2.3 and §2.6
  disagree on that path.
- Also needed and unstated: two new `load_events.kind` values (`load_events_kind_check`, last set by `0145:21-28`),
  e.g. `stop_removed_in_mcleod` and the orphan-evidence kind, in a migration.
- Fix text (§2.3): "On a `source='tms'` load, `driver_complete_stop` given a stop id that a `stop_removed_in_mcleod`
  event on that load names records the action as a `stop_evidence_orphaned` event (action id = event id, photos in
  the payload) and returns 200 `{orphaned:true}`. It does not raise DL005. The `load-photos` reconciler adds the
  orphan events' photo paths to its index (`alsoIndexedBy`, through a view `load_orphan_photo_paths(storage_path)`),
  or the orphaned photos are deleted after 24 h. The migration adds both kinds to `load_events_kind_check`. Matrix:
  'evidence for a stop McLeod removed is stored and flagged, never DL005'; reconciler test: 'an orphaned stop photo
  named by an event is not deleted'."

### V4-4 (ROUND3 §2.4) BROKEN — every gate in the redesigned proof chain can be bypassed by a config edit or an empty array
I wrote the trigger exactly as §2.4 reads (`pg/switch.mjs`): `test` only on a company in
`org_integrations.config.mcleod.test_companies`; `canary` needs a confirmed request leased under a `test` row, or,
when the list is empty, an owner sign-off; `live` needs a confirmed request leased under `canary` on the same company.
```
1 test on live TMS:                              ERR test only on a listed test company      (holds)
2 canary on TMS, no proof:                       ERR canary needs a confirmed test request   (holds)
A test on TMS after editing config to list TMS:  accepted
B empty the list, canary with sign-off = the admin's own uuid: accepted
C canary_scope = '{}' (whole company):           accepted
D live from ONE confirmed pickup under a pickup-only canary: accepted (EDI deliveries now live)
```
- **A.** `org_integrations.config` is one mutable jsonb (`0068:15`), written by the service role. Listing the live
  company there opens `test` on production **and** hides the whole live company from every report, census and count
  (§2.4's own exclusion predicate). Two catastrophic effects from one jsonb edit, with no audit row.
- **B.** "The org has no test company" is the same mutable fact, so emptying the list switches the canary gate to the
  sign-off path. And there is no org role "owner" to check: `USER_ROLES` tops out at `admin`
  (`packages/shared/src/constants.ts:7-17`), and `requireAdminOnly` admits any admin (`middleware/auth.ts:211-219`).
  AUDIT C.md:127 already found this for S1. A trigger cannot tell the owner from any admin.
- **C.** `canary_scope jsonb` has no shape; `{}` means "everything". And the request carries no stop type or customer
  to compare against: R3-3 required `stop_type`/`customer_id` columns on the request; §2.4 dropped that sentence.
- **D.** "`live` needs one confirmed canary request" lets the first pickup unlock EDI deliveries, so C-19's order
  "pickups, then non-EDI deliveries, then EDI" (still in force) is not enforced at the last step. It also drops the
  **first** owner sign-off (HANDOFF-2026-11-19:140 "first switch to live"; C §9 S1), which §2.4 itself calls "the
  second of the two".
- Fix text (§2.4):
  - "Test companies are not in `org_integrations.config`. They live in append-only `mcleod_test_companies (org_id,
    company_id, added_by, reason, added_at)`, written only by a platform-console route (`platform_admins.role =
    'platform_owner'`, `requireFreshAuth`). Its insert trigger refuses a company that already has a `load_dispatches` row
    (a company we have dispatched real drivers on is not a test company). The reporting predicate reads this table."
  - "Owner sign-offs are rows in append-only `mcleod_write_signoffs (id, org_id, operation, company_id, step in
    ('canary_without_test','first_live'), scope jsonb, signed_by, signed_at)`, inserted only by that same
    platform-owner route. A `canary` row without a test company, and the first `live` row per (org, operation,
    company), must reference one (`signoff_id`, FK), and the trigger checks that its step, company and scope match."
  - "`canary_scope` is checked: `jsonb_typeof(canary_scope->'stop_types') = 'array'`, non-empty, a subset of
    `{pickup, delivery}`; `canary_scope->'customers'` a non-empty array. Requests carry `stop_type` and
    `customer_id` (filled at enqueue from the projected stop), and the claim admits a request only inside the scope."
  - "`live` needs, besides the sign-off, a confirmed request under `canary` for **each** stop type, and one for a
    customer marked EDI when the operation is `stop_clear`."
  - Matrix titles: 'listing a company with live loads as a test company is refused'; 'a canary without a test company
    needs a platform-owner sign-off row'; 'an empty canary scope is refused'; 'a delivery is not leased while the
    canary scope allows pickups only'; 'live is refused until every stop type was confirmed under canary'.
- Also: reading the test company "into the real org" must be loads-only. The roster sweep matches by licence and name
  (`rosterApplicantHire.ts:82-103`); a test company with copies of our drivers (X6: "with copies of
  drivers/tractors/customers") read into the same org would hire or link real applicants to test-company ids. State:
  "the test company's movements are read; its drivers, tractors and trailers never are."

### V4-5 (ROUND3 §2.5) IMPRECISE — the index holds for the driver, but the narrowing re-opens duplicate images
`pg/identity.mjs`, index `(stop_id, operation) where origin='driver_app' and supersedes is null`, the adopted
`(origin='office_retry') = (supersedes is not null)` check and unique `(supersedes)`:
```
1 first Complete:                               inserted
2 outbox replay, same action id:                0 rows (no-op)
3 replay with a NEW action id, on conflict do nothing: 0 rows (no duplicate)
3b same with a plain insert:                    ERR duplicate key ... "r_driver_stop"
4 Send again #1 (office_retry, random id):      inserted
5 Send again #2 also superseding the original:  ERR duplicate key ... "r_supersedes"
6 Send again #2 superseding the head (#1):      inserted
8/9 sweep image_upload_bol twice:               both inserted   <- duplicate
10 under R3-9's index (origin <> 'office_retry'): duplicate refused; 11 Send again of the image: inserted
```
- A driver replay cannot create a duplicate, and Send again works (as a chain on the head; a second Send again on the
  original is refused, which is right).
- But images are `origin='sweep'` (D: uploaded by a sweep when the stop completes). §2.5's predicate covers only
  `driver_app`, so a sweep run twice (a retry after a partial failure, or two worker processes) enqueues two uploads.
  R3-9's index (`where origin <> 'office_retry'`) prevents that; §2.5 narrowed it without saying why. The fallback,
  "a resend first checks `mcleod_image_sends`", is check-then-act at send time, and does nothing for a first send
  whose outcome was unknown (C-4).
- `and supersedes is null` restates the retry check (driver_app rows can never carry supersedes; row 7 of the
  script). Harmless, but it reads as if driver retries exist.
- "`mcleod_image_sends` … per order and category": a multi-stop order has two BOLs in one category, so this must not
  be a unique key. R3-9 keyed it by request id with no uniqueness.
- §2.8 must keep P-17's `on conflict do nothing` (no target), or row 3b becomes an `enqueue_failed` critical alert
  every time a team's second phone completes the stop.
- Fix text (§2.5): "One partial unique index: `(stop_id, operation) where origin <> 'office_retry'` (R3-9). It covers
  driver stops and sweep images; office acts and jobs with no stop carry `subject_ref` and get `(org_id, operation,
  subject_ref) where origin in ('office','job')` and `supersedes is null`. Only `office_retry` rows carry `supersedes`;
  one retry per head (`unique (supersedes)`). `mcleod_image_sends` is keyed by request id and has no unique key of
  its own. The enqueue inside `driver_complete_stop` is `insert … on conflict do nothing`."

### V4-6 (ROUND3 §2.6) CONTRADICTION — the phone cannot see "a DL code", and the office alert has no source
What the code does today (`apps/driver/src/data/`):
- `policy.ts:24` `MAX_ATTEMPTS = 8`; `:27` `MAX_DELAY_MS = 5 min`; `isTransient` = no status, 408, 425, 429, ≥ 500;
  `outcomeAfterFailure`: 429 never dead; otherwise `!transient || attempts >= 8` → `dead`. One policy for every kind.
- `handlers.ts:41-45` `post()` throws `SyncError(message, status, retryAfterMs)`. **The API's `code` is dropped**, and
  the API never sends a DL code anyway: `driverLoads.ts:36-44` maps DL001..DL011 to `{status, code:"stop_not_found"…}`.
- Photo upload failures throw `SyncError` with **no status** (`handlers.ts:86`) → transient.
- `sync.ts:183-187`: after any failure the pass `break`s. `claimNext` takes the oldest due record (`outbox.ts:95-110`).
- Tests that pin today's behaviour: `policy.test.ts:108-111` "dead-letters once attempts are exhausted" (a 500 at
  attempt 8), `:102` "dead-letters a permanent failure immediately", `:33-40` "caps at 5 minutes". Their fixture kind
  is `'test'` (`:18-31`), so a rule scoped to `kind === 'load_stop'` (`handlers.ts:27`) leaves all three green; a
  global change breaks them.

What §2.6 requires, made exact:
1. **Per kind.** `outcomeAfterFailure` branches on `rec.kind === LOAD_STOP_KIND`; other kinds keep 8 attempts and the
   5-min cap (the existing tests stay as they are).
2. **"A 4xx with a DL code" must become "a 4xx whose body `code` is a known refusal".** `SyncError` gains `code`
   (from `res.error.code`), and the list is the API's codes (`not_your_load`, `wrong_state`, `stop_not_found`,
   `reason_required`, `illegal_transition`, `not_ready`, and `invalid_request` from `validateBody`, `lib/http.ts:52`). Everything else, including 401, a 403 that
   is not `device_limit`, 404 without a code, 410, and every 5xx, retries.
3. **R3-5 is contradicted, not rejected.** R3-5 keeps "a 500 counts toward `MAX_ATTEMPTS`"; §2.6 says stop actions
   never dead-letter. With the per-load FIFO gone (§2.6 bullet 1, R3-16), the head-of-line block R3-5 feared is
   gone too (a record in backoff is not due, so others pass it), so §2.6's choice is defensible. But §5 must list
   R3-5's 500 cap as rejected, with that reason, or the precedence rule leaves two adopted rules.
4. **"After 60 min of failure"** has no clock: the record stores `createdAt` and `attempts` only, and offline time is
   not a failure (`runSync` returns early, `sync.ts:175-178`). Say "60 min after the tap (`createdAt`), still not
   delivered".
5. **"The office gets one alert per load"** cannot come from the phone in the case it exists for (no signal). The
   server can only alert on what it saw: repeated 5xx for one action id, or a stop McLeod (or Samsara) shows departed
   with no 360 Complete after 60 min.
- Fix text (§2.6): "Stop actions (`load_stop`) never dead-letter on no response, 408, 425, 429 or 5xx; backoff caps at
  15 min for that kind only. A 4xx whose `code` is one of the API's refusal codes goes to Needs attention as today.
  60 min after the tap, a still-undelivered stop action shows 'Not sent yet — keep the app open on signal'. The office
  alert is server-side, one per load: a stop whose McLeod departure is recorded while 360 has no Complete for it 60
  min later, or ≥ 3 5xx answers to one action id. §5 adds: 'R3-5's 500 cap — rejected: with no per-load FIFO, a
  failing record blocks nothing.' Tests (`policy.test.ts`): 'a load_stop record is never dead-lettered by a 500';
  'a load_stop record with a refusal code goes to Needs attention'; 'a load_stop backoff caps at 15 minutes'; the three
  existing titles unchanged."

### V4-7 (ROUND3 §2.7) IMPRECISE — the inequality adds the wrong term
- `service.mjs:24-25`: `POST_TIMEOUT_MS = 60_000`, `POST_ATTEMPTS = 4` (confirmed). So 247 s is the worst case of a
  **retried** POST.
- What can still be on the wire when the quiet period ends is: the `begin_send` answer in flight (its DB commit is
  the `send_started` timestamp) plus the McLeod call (write deadline). The settle POST happens **after** the McLeod
  call ends; how long it takes cannot cause a second send, because C-2 accepts a late settle from any lease and the
  next lease's read-back decides. So the invariant is `quiet ≥ begin_send timeout + write deadline + margin`.
  With `begin_send` on one plain `postJson` attempt (60 s) that is 60 + 30 = 90 s, margin 210 s; with R3-4's 10 s
  no-retry variant, 40 s. "30 + 247 = 277, 23 s margin" overstates the risk and pins the wrong tunable.
- "Picked up again after the lease ends": the gate that actually applies is the quiet period after the orphan
  `send_started` (P-9/P-10). Equal today (300/300); they diverge as soon as either is tuned.
- "A matrix test title pins it": a `supabase/tests` matrix cannot read an agent constant. It is an agent unit test.
- Claim size 1: fine for safety, but say the loop claims again at once while a claim returns a row; one claim per
  15 s tick drains 240 an hour, and an outage backlog (≈ 700 Completes a day) takes hours.
- Fix text: "`begin_send` uses a no-retry POST with a 10 s timeout (R3-4); a timeout means 'did not go'. The agent
  asserts at startup `QUIET_S ≥ BEGIN_SEND_TIMEOUT_S + WS_WRITE_DEADLINE_S + 30` (10 + 30 + 30 = 70 ≤ 300), pinned by
  the agent test 'the agent refuses to start when the quiet period is shorter than a send can last'. Settle may retry
  with `postJson`. A lost `begin_send` answer is retried by the next lease after the quiet period. The loop claims
  again immediately while a claim returns a request."

### V4-8 (ROUND3 §2.8) OK — tested
`pg/subtx.mjs`, the enqueue in a `begin … exception when serialization_failure or deadlock_detected then raise; when
others then …` block:
```
check violation 23514 → enqueue_failed:23514, evidence committed
unique 23505          → enqueue_failed:23505, evidence committed (the block's earlier insert rolled back)
cast 22P02            → enqueue_failed:22P02, evidence committed
raised MK010          → enqueue_failed:MK010, evidence committed
40001 / 40P01         → whole call fails, evidence rolled back (re-raise works, both spellings)
57014 query_canceled  → whole call fails (OTHERS does not catch it), as R3-6 says
```
Both spellings of the re-raise behave as claimed (a named handler before `others`, or `if sqlstate in (...) then
raise` inside `others`). Two precisions: under the API's default READ COMMITTED a 40001 only arises from explicit
`serializable`/`repeatable read`, so in practice the re-raise is for 40P01; and the retry is the phone's (an unmapped SQLSTATE
is thrown, `driverLoads.ts:216-219`, so the route answers 500; §2.6 retries 5xx), so say "the outbox retries the
whole call". Keep `on conflict do nothing` in the insert (V4-5).

### V4-9 (ROUND3 §2.9) IMPRECISE — the column does not exist, and the metric measures the wrong thing
- `load_events` has `occurred_at` and `recorded_at` (`0087:135-139`), no `created_at`.
- `recorded_at - occurred_at` is sync delay, hours when a phone was offline. Clock skew forward is the other sign:
  rows where `occurred_at > recorded_at`.
- No driver uses the app today (DR, `2-driver.md`), so there is nothing to measure until the first store build.
- Fix text: "The future bound starts at 5 min. After the first store build, measure the p99 of
  `occurred_at - recorded_at` over driver events where it is positive, and set the tunable from it. The rest of C-6
  as corrected by R3-7 (the dispatch lower bound, `arrival ≤ departure`, both times bounded) stands."

### V4-10 (ROUND3 §2.10) CONTRADICTION — skipping the reopened row re-creates the Curtis Hairston case while reactivate is off
- Code: `rosterApplicantHire.ts:70-80` puts every `status='applicant'` row with a licence into the candidate map, McLeod
  id or not, and `:96-103` links then hires it. So §2.10's skip is a code change (fine).
- The predicate is load-bearing in a way §2.10 does not say. The same function deliberately leaves an applicant row
  **holding a McLeod id** between the link and the hire ("Linked but not yet hired is a state the next sweep finishes",
  `:96-99`). A skip keyed on "has a McLeod id" alone would strand that row forever. The `termination_date` half
  must therefore be true of every reopened row: C-15's "Hire again" must **keep** `termination_date` (the house rehire,
  `driverRehire.ts` `restoreRehiredDriver`, clears it; R3 #50), and the 360 close must clear it.
- The contradiction: while `driver_reactivate` is `off` (C-16 puts it under the O-7 switch, which stays off until the
  owner's sentence, AUDIT §5 O-7), dispatch reactivates the driver in McLeod by hand, as today. §2.10 then leaves an
  employed, possibly driving person as an applicant in 360 until somebody presses the close: exactly the failure
  D-RL5 was written to end ("held for a click that was never coming", `rosterApplicantHire.ts:10-15`). R3-11(a) said
  the D-RL5 path stays the fallback while the switch is off; §2.10 reverses it without a reason.
- Fix text (§2.10): "While `driver_reactivate` is `off`, the D-RL5 sweep hires a reopened row as it hires any
  applicant (R3-11 a–d), and the drawer says 'Reactivate this driver in McLeod; 360 completes the hire on the next
  sync.' Once `driver_reactivate` is past `off`, the sweep skips an applicant row that holds a McLeod id **and** a
  `termination_date`; that row becomes active only through the 360 close, which clears `termination_date`. 'Hire
  again' keeps `termination_date`. C-16's link runs only for rows with no McLeod id. Matrix/test titles: 'a reopened
  former driver whom McLeod reactivates by hand is hired by the sweep once while reactivate is off'; 'a reopened row is
  not hired by the sweep once reactivate is on'; 'a linked-but-not-hired applicant is still hired by the next sweep'."

### V4-11 (ROUND3 §2.11) OK
`driver-store.yml:56` is a plain `actions/checkout@v4` (shallow, no `production` ref) and `:30-44` has
`workflow_dispatch` from any ref; the only run so far was a `workflow_dispatch` from `main` on 2026-09-07, failed
(`gh run list`). `fetch-depth: 0` brings every branch, so the separate fetch is redundant but harmless. Add R3-8's
header correction (`:6-10` still describes the deleted `driver-android.yml`) to the same PR.

### V4-12 (ROUND3 §2.12) IMPRECISE — "the four items" and "anything new" are not a rule a gate can run
- OPS-16's "four already public" are the **company ids** TMS…TMS4 (`3-ops.md:233-234`). Other McLeod facts are
  already public too: `<read-only SQL login>` in 27 tracked files, `<LME SQL LAN IP>` in 20, `<LME SQL host>` in 13 (`git grep -l`,
  today). A gate that "refuses anything new" by kind is red on main the day it lands (R3-14's point); one that
  allowlists four strings has no pattern to refuse with, since a McLeod company id is any ≤ 10-character string. And
  the test company id cannot be put in a denylist without committing it.
- Fix text (§2.12): "The gate is OPS-16's, verbatim: refuse `MCLEOD_WS_URL=https?://` other than `REPLACE_ME`, any
  64-hex `CERT_SHA256=` value, and `-----BEGIN` outside `tools/mcleod-agent/fixtures/fake-mcleod-*`; and refuse any
  committed `*.env*` whose `MCLEOD_WS_USER`, `MCLEOD_WS_TOKEN` or `MCLEOD_TEST_COMPANY` value is not `REPLACE_ME`. The
  test company id and the integration user name live only in `mcleod-ws.env` and the database. Already-public facts
  (company ids TMS…TMS4, the SQL login, server name and IP) are not scanned for." Also state SEQ-11's resolution here
  (crawled McLeod docs are never committed; parser tests use hand-written stubs).

### V4-13 (ROUND3 §2.13) OK
Ingest tokens are per org (`modules/mcleod/tmsIngest.ts:34-51`, hash lookup at `:42`); `/api/tms` sits behind one limiter, 300 per 15 min per IP
(`app.ts:340-347`), with `trust proxy 1` (`app.ts:320`, comment still says Railway; Caddy on EC2 is one hop,
`infra/server/Caddyfile:17`, so `req.ip` is the client). Recording the IP and alerting on change is sound. C-7's "own
limiter" still applies and should be restated, because every write costs three `/api/tms` calls (claim, begin_send,
settle) on the same 300-per-15-min budget the mirror uses.

### V4-14 (ROUND3 §2.14) IMPRECISE — "not changed" and "its success check learns" are the same file
- The success check is `update-connector.ps1:232` (`$bad = … -match 'cycle failed|\(401\)|…'`). Teaching it the `/ws`
  failure lines is a change to `update-connector.ps1`, and every connector commit regenerates its SHA-256 manifest
  (`windows/manifest.mjs`; LOAD-RATES-PLAN R4). R3-15's wording was "unchanged except its manifest and `$bad` regex".
- Unstated: who loads `mcleod-ws.env`. The VM runs `node --env-file=connector.env …` (the house pattern,
  `set-lumper-feed.ps1:170`; the task itself is configured by hand, C-21). A second file needs either a second
  `--env-file=mcleod-ws.env` in the scheduled task's action (a VM step) or the agent reading the file itself.
- Fix text (§2.14): "`update-connector.ps1` keeps its one-line guarantee (ROSTER_MODE only); its manifest is
  regenerated and its `$bad` pattern gains the `/ws` failure lines. Every API Kit setting lives in `mcleod-ws.env`,
  written by `set-mcleod-api.ps1` in `set-connector-line.ps1`'s shape. The agent reads `mcleod-ws.env` itself
  (absent file = every API line off), so the scheduled task is not edited."

### V4-15 (ROUND3 §2.15) BROKEN — `enqueue_failed` cannot be a row in `mcleod_write_events`, and the split loses the order
- `mcleod_write_events.request_id` is `not null references mcleod_write_requests` (`1-pipeline.md` final DDL).
  `enqueue_failed` means the request insert failed, so there is no request to reference. P-17 records it on the
  driver's `load_events` payload (`mcleod_write: 'enqueue_failed:<sqlstate>'`). §2.15 lists it as an event kind.
- C-2 orders facts by one identity `seq`. Split across two tables with two identities, the settle rule "third
  `not_visible_yet` after an `applied_unverified`" compares a `transient` (attempts) with an `applied_unverified`
  (events) and has no order. `pg/attempts.mjs` shows it works with **one shared sequence** for both tables:
  `not_visible_after_applied: 1`, `sends: 1`, `newest_lease_found: true`, `not_before` = max over both.
- The 90-day purge cannot coexist with a foreign key from the business facts to the lease row: with `on delete set
  null` the purge fails (`ERR append-only`, the FK's UPDATE fires the append-only trigger); with `restrict` it is
  refused. Without the FK the purge works and the event keeps a dangling `lease_id`, which is fine for an ended
  request.
- Retention: R3-19 said 180 days, "the owner's to set", because `send_started` answers "did we write McLeod twice?";
  §2.15 says 90 with no reason. Precedence does not settle two round-3 statements.
- Settle still finds the lease (newest `leased` in attempts, by `seq`), and the claim query works across both tables.
- Fix text (§2.15): "`mcleod_write_attempts` holds `leased`, `send_started` and `transient`; `mcleod_write_events`
  holds `applied_unverified`, `confirmed`, `refused`, `conflict` and `already_in_mcleod` (the end-once index covers the
  last four). Both draw `seq` from one sequence, `mcleod_write_seq`. `lease_id` on events has no foreign key. Attempts
  of a request are purged 180 days after it ends (owner may change), never while it is open; the attempts table has
  its own MK011/MK012 triggers. `enqueue_failed` is not a write event: it is the `mcleod_write` value on the driver's
  `load_events` row, and W6 reads it there."

### V4-16 (ROUND3 §2.16) OK, keep R3-21's one check
`completeStopRequestSchema` (`loadsContract.ts:142-149`) is read only by the driver route (`me.ts:384-391`) and
`driverLoads.ts`; no office path posts stop actions, so making `action_id` required touches the phone alone. R3-21's
precondition is dropped from §2.16 and should stay: count push registrations with an `app_version` from the retired
APK lane (`messaging/routes/notifications.ts:182` stores it) before the API refuses requests without `action_id`. A
phone still on an APK build would see every stop action refused (`invalid_request` 400), which §2.6 sends to Needs
attention.

### V4-17 (ROUND3 §2.17) OK
Consistent with OF-11's own "beside McLeod capture" state and R3-22. One precision: "cannot make billing worse" holds
only if billing can tell 360's copy from the capture app's; D's "category picked once per kind by a person" must pick a
category distinct from the capture app's, or billing sees each paper twice. The echo-loop skip (OF-9) and filed rule
(OF-8) stay.

### V4-18 (ROUND3 §2.18) IMPRECISE — the window has no key
`driverLoads.ts:141-149` reads stops and photos with one unchunked `.in("load_id", loadIds)` each; `fetchAllPagedIn`
(`paging.ts:68-80`) is the right helper. The "delivered in the last 14 days" window needs a column: R3-12 warns that
`updated_at` is rewritten by the mirror on every projected change. For `source='tms'` the close is
`loads.external_closed_at` (`0366:52`); for manual loads `loads.completed_at` (`0085:55`).
Fix text: "… plus loads whose `coalesce(external_closed_at, completed_at)` is within the last 14 days (Q-8)."

### V4-19 (ROUND3 §2.19, with §2.21 and A:138) CONTRADICTION — S0c's job is defined three ways
- Spec A's S0c (A:138-143) **drops** `idx_load_stops_load_seq`, which is why "production cannot roll back past S0b
  once S0c is released" (§2.21, SEQ-7): old code's `onConflict: "load_id,seq"` needs that index.
- DR-5 says S0c "only restores `check (seq between 1 and 50)`"; with §2.2's band in the RPC every sweep, that breaks
  every sweep (V4-2).
- §2.19 says "S0c renumbers so `seq` stays unique per load". Under §2.2 the RPC already renumbers on every sweep, and
  the only thing that keeps `seq` unique is the very index A's S0c drops.
- Fix text (§2.19 + §2.21): "S0c keeps `idx_load_stops_load_seq` unique and keeps the band check; it re-keys 0453's
  predictions on the stop id (`boardEtaRecorder.ts` reader in the next merge, migration-ordering). Because the index
  stays, a rollback to pre-S0b code still finds its `onConflict` arbiter; the rollback line says instead that such
  a rollback re-exposes DR-2 (a worked stop overwritten by the next stop at its seq). A's S0c text ('drop index …',
  the exception arm) is void." Then §2.21's last sentence is deleted.

### V4-20 (ROUND3 §2.20) OK
Matches SEQ-3: `driver_complete_stop` is defined only in 0087 and 0141 today (R3 #13); one drop-and-create in M-A
with every new parameter, then same-signature `create or replace` from M-A's body. The waiver is needed
(`check-table-modules.mjs` counts DML in bodies, SEQ-3).

### V4-21 (ROUND3 §2.21) IMPRECISE — first half OK, rollback sentence depends on V4-19
B2 → S0a (S0a's RPC writes `reference_numbers`) and B1 → S0b (S0b deletes `tmsLoadIngestWriters.writeStops`, which B1
edits) hold per SEQ-7. "Production cannot roll back past S0b once S0c is released" is true only if S0c drops the unique
index; under V4-19's fix it does not, and the sentence goes.

### V4-22 (ROUND3 §2.22) CONTRADICTION — overturns a recorded owner ruling, on a PR that is ready now
- LOAD-RATES-PLAN (on main) records **owner rulings 2026-11-19: "No request to Alex … deliberately sets aside the review
  step … recorded here so nobody re-asks."** §2.22 says that line "is corrected by this". A review document cannot
  overrule the owner; it can only ask.
- State today: load rates R1–R3 and Q-RATE1 are merged (#2582, #2587, #2592, #2600); R4, the connector change, is open
  as **PR #2602**. Bundling R4 with B4 and the `/ws` client makes a finished feature wait on Alex's SQL review and on
  API Kit work.
- SEQ-5's real point stands: whichever VM update runs second installs the other's agent code, and B4's routine sent to
  Alex will contain R4's statement already running.
- Fix text (§2.22): "Load rates R4 ships on its own as the owner ruled (no Alex request; its own VM visit,
  LOAD-RATES-VM-UPDATE.md). B4 + the `/ws` client with every line off are the next connector commit, one SQL review by
  Alex (the routine he receives then already contains R4's statement, which is running under the owner's 11-19
  ruling, and the message says so), one VM visit, one required-key flip for B5 (R5 flips on its own). If the owner
  prefers one bundle, that is a new ruling: add it to §4 as Q-9." 

### V4-23 (ROUND3 §2.23) BROKEN — already impossible
`git log origin/main`: V5 Today merged (#2597), V6 "Loads, Load detail and Stop" merged (#2601, `27637638b`), and V7
Documents merged (#2603) on 2026-11-20. C-A2 cannot merge before them.
Fix text: "V5–V7 are on main. C-A2 is written on top of the restyled screens (`app/loads/[id].tsx`,
`stop/[stopId].tsx`, `(tabs)/loads.tsx`, Today); its PR lists the V6 components it changes. The first store build
carries both."

### V4-24 (ROUND3 §2.24) IMPRECISE
Picks RT-18's name over SEQ-14's recommendation (`evidence_after_reassignment`); either is fine. Say which events it
covers: SEQ-14 counted four writers (B3 `unmatched_assignment`, reassignment evidence, write refused/conflict, removed-stop
evidence). Fix text: "`late_evidence` is the exceptions-feed kind for evidence after reassignment (DR-7) **and** for
evidence on a stop McLeod removed (§2.3); `unmatched_assignment` and the write `refused`/`conflict` kinds keep their
names."

### V4-25 (ROUND3 §2.25) IMPRECISE
`me.ts` is 444 lines on main (SEQ-15's number holds). `DispatchLoadsPage.vue` is **498** now (load rates R3/Q-RATE1
added 2, `90e3636ec`), and load-rates R3 has already landed without extracting a cell, so "whichever of B4 or R3 lands
first" is moot: B4 must extract (or any change of ≥ 3 lines to that page must).

### V4-26 (ROUND3 §2.26) IMPRECISE
Right intent. Three names for one file: §2.26 `mcleod-writes.test.mjs`, R3-1 `mcleod-write-pipeline.test.mjs`,
SEQ-3 `mcleod-write-queue`. Pick one. The council's `pg/*.mjs` import PGlite by an absolute path into another
checkout (`t2.mjs:1`); the matrix uses `import { PGlite } from "@electric-sql/pglite"` as every `supabase/tests`
file does, prints `RESULT`, and closes the db (`lint:matrix-exit`). The scripts in this round (`tail.mjs`,
`switch.mjs`, `identity.mjs`, `subtx.mjs`, `attempts.mjs`) give its first titles.

### V4-27 (ROUND3 §2.27) OK
- Probe count: the 3-ops table has K1–K12 and K24 read-only (13), K13–K17, K19, K22 test-company writes (7), K18, K20,
  K21 write + written answer (3), K23 read + written answer (1). Matches.
- `driver-store.yml` "ran once (2026-09-07) and failed": `gh run list` shows exactly one run, `workflow_dispatch` from
  `main`, `failure`.
- 73 → 75: `api-kit-audit/WS.md:29` counted 75 unique services (78 links). Matches.

---

## Summary

27 items: **BROKEN 4** · **CONTRADICTION 4** · **IMPRECISE 12** · **OK 7**.

- BROKEN: **§2.3** (orphaned stop photos are deleted by the `load-photos` reconciler after 24 h; also disagrees with
  §2.6 on DL005), **§2.4** (tested: listing the live company in mutable `config` opens `test` on production and hides it
  from reports; emptying the list opens the sign-off path; no "owner" role exists to check; `canary_scope '{}'`
  accepted; one pickup unlocks EDI deliveries), **§2.15** (`enqueue_failed` has no request to reference; two tables
  need one shared `seq`; a lease FK makes the purge impossible), **§2.23** (V5/V6/V7 already merged).
- CONTRADICTION: §2.6 (vs R3-5's 500 cap, not rejected), §2.10 (re-creates the D-RL5 failure while reactivate is off),
  §2.19/§2.21 with A's S0c (drop the index vs keep it vs restore the check), §2.22 (overturns the owner's 11-19 "no
  request to Alex" on load rates; R4 is PR #2602).
- IMPRECISE: §2.1, §2.2 (works across two sweeps in PGlite; needs the widened check written down, a >50 refusal per
  load, and band-before-insert order), §2.5 (driver replay cannot duplicate and Send again works; the `driver_app`
  predicate lets duplicate sweep image requests through), §2.7 (inequality should be begin_send timeout + write
  deadline, not settle), §2.9 (no `created_at`; wrong sign), §2.12, §2.14, §2.18, §2.21, §2.24, §2.25, §2.26.
- OK: §2.8 (sub-transaction tested: evidence survives every caught class; 40001/40P01 and 57014 abort as claimed),
  §2.11, §2.13, §2.16, §2.17, §2.20, §2.27.
