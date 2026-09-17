# Loads from live McLeod — go-live plan

**Status: MEASURED, NOT STARTED.** Written 2026-09-17, the day the carrier's read-only login
arrived. Every number below was read from the **live `lme` database** through that login, this
session, not recalled and not taken from the sandbox.

This plan does **not** restate `MCLEOD-COLLECTOR-PLAN.md` (how we detect change, what we may do to
their server) or `../livemap/LIVE-MAP-PLAN.md` (what the board becomes on screen). Those remain the
sources of truth and are referenced by step id. What is here is the part neither of them could
write until the login existed: what the live connection actually yields, what today's measurements
force us to change, and the order the feed gets switched on. New decisions are allocated
**D-MCC11–D-MCC15**, continuing the collector plan's sequence.

---

## 1. The headline: the data is live, and the sandbox is not

**Real-time — proven, not assumed.** Watched over 91 seconds, the database advanced **1,046 change
versions**; 4 `orders` rows and 2 `stop` rows changed while the probe sat there. Over the week since
the plan's 2026-09-10 measurement it has advanced 27,262,450 → 28,918,571, or **~236,900 versions a
day**. `lme` is the production TMS, written continuously by dispatch as they work.

There is no ETL, no batch, no nightly cut. **Our staleness is therefore whatever poll interval we
choose and nothing else** — a claim the sandbox could never support.

| | live `lme` | `lme_analytics` |
|---|---|---|
| open board (same query, same minute) | **156 loads** | 160 loads |
| newest movement id | **291,381** | 290,648 — **733 behind** |
| change-tracking version | 28,920,694, moving | 27,262,450, frozen |
| last restored | n/a — it is production | **2026-09-10 11:36, 168 hours ago** |

⚠ **The refresh Alex announced did not land.** His mail says the analytics database was updated
"with the latest snapshot… all the data up to 11PM today". `msdb.dbo.restorehistory` records the
newest restore of `lme_analytics` as **2026-09-10 11:36:54**, and the newest restore of *any*
database on APPNEW as that same event. Three independent readings agree: the restore history, the
frozen CT version, and 733 missing movements. This is the second time an announced refresh has not
arrived (`docs/plans/mcleod/` and the change-tracking memo record the first), and it is the whole
argument for reading `lme` directly: **a snapshot is a promise, a connection is a fact.**

It costs us nothing now — the loads feed reads `lme`. It matters for **finance**, which still reads
the sandbox (MC5a) and is therefore quoting figures from 2026-09-10 today.

---

## 2. What the login gives us

`silvicom_dispatch_ro` on `APPNEW` (SQL Server 2019, 15.0.2120.1), server clock **UTC−5, Central**,
confirming the plan's local-time trap. It holds **no server role and no database role** — every
grant is explicit, which is exactly the posture asked for:

| object | SELECT | VIEW CHANGE TRACKING |
|---|---|---|
| `movement`, `movement_order`, `orders`, `stop`, `tractor`, `trailer` | whole table | **granted** |
| `driver` | **column-scoped**, 18 columns | granted |
| `continuity`, `users` | whole table | not tracked — by design (D-MCC3) |

Nothing else. No `mc_position`, no `company`, no finance tables, no write permission of any kind,
and `social_security_no` is not among the granted columns.

**`VIEW CHANGE TRACKING` came through.** This is the single most consequential result: MC0 is
satisfied, the D-MCC9 fallback is not needed, and the change detector is real work rather than a
workaround. `CHANGETABLE` opens on all seven tables and returns **`company_id` *and* `id`** as the
key — the composite the plan's trap 7 demands, handed to us by the server.

Retention measured at **2,378,814 versions ≈ 10.0 days**, matching the stated 10-day setting exactly
at the observed write rate. A watermark older than ten days must re-baseline, never read zero.

**Two discrepancies in the grant, neither blocking:**

- **Missing:** `driver.fleet_manager` and `driver.tractor_id` — both columns exist, neither was
  granted. We do not need them: LM0 dropped `tractor` because `continuity` resolves the unit, and
  `fleet_manager` is the 56% dispatcher proxy D-LM18 already rejected in favour of the dispatcher on
  the load. **No action** beyond recording it.
- **Extra, and this one needs a word back:** the grant includes `birth_date`, `address`, `city`,
  `state`, `zip`, `name_of_spouse`, `license_no`, `license_state`, `license_date`,
  `medical_cert_expire`, `hire_date` — **eleven columns of driver PII we did not ask for**. Alex's
  mail says he corrected our script; this is what the correction did. It is not a breach and the SSN
  is still out, but reading a home address because nobody stopped us is not a posture we should
  accept by default (**D-MCC15**: ask IT to narrow to the eight LM0 named; until then the agent
  selects the eight by name, never `SELECT *`, so the extra grant is unexercised).

---

## 3. What the board actually contains

The agent's **existing, shipped** query and mapping — `queries.mjs` + `loads.mjs`, unmodified — run
against live production: **156 loads, 335 stops, 14 dispatchers, 0 declined, in 330 ms.**
Longitudes came out negative (the west-positive trap is correctly handled), team drivers were
aggregated rather than duplicated, and both system accounts were flagged. **LM1b's Done-when, open
since 2026-09-10 for want of a tunnel, is met.**

`P` and `A` are the only open statuses in a 278,905-row table (`D` 270,702 delivered, `V` 8,145
void), so `status IN ('P','A')` captures the entire open board — 156 of 158, the two excluded being
older than the 30-day staleness bound. **Movement 11787, the March-2015 phantom, is correctly
absent.**

The two statuses are not the same kind of thing, and the plans had not noticed:

| | loads | dispatcher | driver | tractor | trailer | commodity |
|---|---|---|---|---|---|---|
| **`P`** | 110 | **100%** | 100% | 100% | 100% | 24% |
| **`A`** | 46 | **0%** | 59% | 59% | **0%** | 35% |

A `P` movement is fully dispatched. An `A` movement has **no dispatcher and no trailer**, and four
in ten have no driver. The "dispatcher is on the load at 100%" finding recorded on 2026-09-10 is
**still true — of `P`**; today's 71% overall is the arrival of 46 `A` loads, not a regression.

**D-MCC12 — ingest both, draw only `P`.** `A` is the planning queue and belongs in the product
eventually; it cannot be drawn on a truck-centric map, and a rail that silently lists 46 loads with
no driver and no dispatcher will read as broken data. The ingest takes both (the contract already
tolerates the nulls); the live map filters to loads with a vehicle. ⚠ **Open, for Alex:** confirm
`A` means *available/not yet covered* rather than something carrier-specific — the shape of the data
says so but no code table was read.

**11 stops are of type `VA`** — San Jose CA, Fife WA, Kent WA, Phoenix AZ — carrying real
appointment times, coordinates and statuses, on 5 movements. `D-LM15` refuses to guess a stop kind,
so the agent **reports and drops them**, which is the right default and also means movement 290837
is sent with stops 1, 2, 4, 6, 8 and holes where 3, 5, 7 and 9 should be. A load whose itinerary has
gaps will draw a wrong route. **D-MCC13:** ask Alex what `VA` is (the shape suggests a *via* /
routing waypoint), then map it explicitly — as a waypoint kind if it is one, so the sequence closes.
Do not widen the vocabulary by guessing; a yard move mislabelled a delivery asks a driver for a bill
of lading that does not exist.

---

## 4. What it costs their server, and the trap found while measuring it

One incremental cycle, run as MC2 describes — detect via `CHANGETABLE`, then re-read only the
changed keys:

| stage | cost |
|---|---|
| detect one hour of change on `movement` | **41 ms** (28–96 movements, depending on the hour) |
| keyed re-read of those movements | **17–51 ms** |
| **full cycle** | **under 100 ms** |
| full board read, for comparison | 133 ms |
| board churn | ~28 movements and ~47 stops per hour; 177 and 305 per day |

Against a server running ~138 batch requests/second this is unmeasurable, and the incremental cycle
is **cheaper than reading the whole board** — which is the justification for MC2 existing at all.

⚠ **D-MCC11 — every parameter is typed, or the keyed re-read scans the table.** The first
measurement of that re-read came back at **798 ms, slower than reading the entire board**, and the
cause is not the design: `movement.id` is `char(32)` and `movement.company_id` is `char(4)`, so an
untyped `.input()` binds as NVARCHAR, forces an implicit conversion, and makes the predicate
non-sargable. Measured side by side on the same 96 ids, same connection:

```
untyped (NVARCHAR inferred):  2,022 ms, then 1,977 ms   ← not a cold cache
typed   (VarChar declared) :     51 ms, then    17 ms   ← 115× faster
```

This is the same class of defect as the `set search_path` inlining loss that took the spend page
down: a silent conversion, no error, only a number that is quietly two orders of magnitude wrong.
**Every `.input()` in the shipped agent is already typed** — audited this session, all 20 of them —
so the exposure is entirely in the new detector code MC1/MC2 will add. It should be a gate in
`lint:agent-syntax`, not a comment.

**D-MCC14 — the connection is plaintext today, and that is not acceptable for a scheduled feed.**
TLS refuses an IP literal, so the probe connected with `encrypt=false`, which is precisely the
"must be TYPED" fallback `roster.mjs` documents. Over a VPN on a private LAN it is defensible for
reconnaissance; for a credential crossing the wire every minute forever it is not. Ask IT for the
hostname on the SQL Server certificate and set `MCLEOD_SQL_SERVERNAME`. This is a question for the
same mail as the VM.

---

### 4.1 Amendment, 2026-09-17 — the cost premise is inverted, and the bottleneck is ours

Measured on live `lme` with `SET STATISTICS TIME`, median of five runs, after the first production
pull:

| | CPU | elapsed |
|---|---|---|
| **full sweep** — the three statements the agent ships, 514 rows | **16 ms** | 26 ms |
| **change detection** — `CHANGETABLE` across four tables, 60-second window | **76 ms** | 72 ms |

At a 60-second cadence the full sweep is **23 CPU-seconds a day — 0.0006%** of a 42-core box, and
**3 requests a minute, 0.036%** of its ~138/s baseline. We could poll every ten seconds and remain
invisible.

⚠ **MC1/MC2's stated premise is false at this carrier's volume.** They justify a change detector on
the grounds that re-reading the whole board is expensive. It is not: the board is 157 loads and 333
stops with every predicate indexed, while the Change Tracking side tables carry ~236,900 versions a
day. **Asking what changed costs about five times more than reading everything.**

**D-MCC16 — keep the detector, but re-argue it, and never argue it from the carrier's CPU.** The
reasons that survive measurement are: (a) it stops us re-posting all 157 loads to **our own** API
every cycle, which is where the real cost is; (b) it is how a cancellation or a disappearance is
noticed at all; (c) it is the only thing that still works if the board grows by an order of
magnitude. The reason that does **not** survive is protecting their server. Do not put that reason
in front of Alex — tell him the truth, which is that the read is 0.0006% either way.

**The bottleneck is our own ingest: 52.1 seconds for 157 loads.** Measured on the first production
pull (board read finished 17:49:25.266, ingest acknowledged 17:50:17.330). The diagnosis is not a
guess: `ingestLoads` performs **six sequential round trips per load** — insert `loads`, stamp
`external_status`, upsert `load_external_payloads`, delete pending `load_stops`, upsert
`load_stops`, insert `load_events` — inside a plain `for` loop. **157 × 6 = 942 serial round trips,
and 52,100 ms ÷ 942 ≈ 55 ms each**, which is ordinary Railway→Supabase latency. Nothing is batched.

*(Corrected 2026-09-17 while executing L11: the first count said five and 66 ms, taken from a grep
rather than from the call path. The `external_status` stamp inside `writeProvenance` is a sixth.
The conclusion is unchanged and the ratio is slightly worse.)*

At a 60-second cadence that leaves **eight seconds of headroom**. That is not a cadence, it is a
queue waiting to form — so **L11 lands before L9 turns the schedule on.**

---

## 5. Steps

Ten steps, each **one PR**, each with a Done-when a machine or a measurement can settle. They are
ordered so that **visible value arrives first** (L1 puts real loads on screen with no code at all)
and the irreversible things arrive last. Where a step is already specified elsewhere it says so and
does not restate it — `MCLEOD-COLLECTOR-PLAN.md` MC*, `../livemap/LIVE-MAP-PLAN.md` LM*.

**Dependency order.** L0 → L1 · L2 (parallel, no code) · L3 → L4 (separate merges, deploy window) ·
L5 → L6 → L7 (agent chain) · L8 (blocked on Alex) · **L11 → L9** (the schedule cannot be turned on
while one cycle takes 52 s) · L10 (independent).

---

### L0 · Get the live ingest token — owner action, 10 minutes, blocks L1

**The problem, measured.** `org_integrations` holds exactly two rows, **both** for the live org
`86d6b3ea`: `mcleod` (enabled, holding a live ingest token last used by the roster feed
2026-09-14) and `mcleod_financial`. The QA org that `tools/mcleod-agent/.env` points at **has no
integration row at all**, so a pull from this laptop today would be refused before it reached the
ingest.

⚠ **Do not re-issue the token casually.** "Enable" in Settings → Integrations → McLeod is also the
**rotate** path: calling it invalidates the previous token, and the roster sweep and the financial
sweep both authenticate with it. Rotating without updating them stops two working feeds.

**Two ways, in order of preference:**

1. **Find the existing token** on whichever machine ran the roster sweep on 2026-09-14, and put it
   in a local `.env` beside `MCLEOD_SQL_*`. Nothing else changes.
2. **Rotate, and update all three consumers in one sitting** — loads, roster, financial. Only if (1)
   fails.

**Done when.** `curl -s -H "Authorization: Bearer <token>" .../api/tms/loads -d '{"loads":[]}'`
returns `200` with `received: 0`, from this laptop. An empty payload is a valid authentication test
and writes nothing.

---

### L1 · The first real pull — no code, and the fastest way to find a mapping mistake

**Why first.** Everything downstream assumes the field mapping is right. 156 live loads on screen
test that assumption in one command, for zero engineering, and Alex's mail explicitly permits
discovery reads. It also answers the owner's actual question — *can we see loads today* — with yes.

**Do.**

```bash
cd tools/mcleod-agent
node agent.mjs --loads --dry-run     # prints the payload, posts nothing — read it first
node agent.mjs --loads               # posts to /api/tms/loads
```

with `MCLEOD_SQL_DATABASE=lme`, the `silvicom_dispatch_ro` credentials, `MCLEOD_COMPANY_ID=TMS`,
`MCLEOD_SQL_ENCRYPT=false` (D-MCC14 — typed, not silently downgraded) and L0's token.

**What will happen, stated in advance so a surprise is a finding.** 156 loads and 335 stops arrive.
Every one lands **`pending_approval`** — `auto_approve_loads` is absent from the config and the
ingest defaults it false, so a feed cannot put work on a driver's phone. 15 notes are printed: 11
`VA` stops declined (D-MCC13) and 4 team movements sending the first driver. `dispatcher_external_id`
is **accepted by the contract and silently discarded by the ingest**, because the column does not
exist — that is L3/L4, and it is why this step is not the end of the story.

**Done when.** `Dispatch → Loads` lists the loads; the count matches the agent's own line; the
unmatched-key report is **empty** (driver, tractor and trailer all resolved 100% on 2026-09-10 — a
miss here is a roster-link regression, not an expected gap); `loads` and `load_stops` row counts in
production equal 156 and 335.

⚠ **This is the one step with a visible consequence for the office** — 156 pending loads appear
where there were none. That is LM12's intended first-week behaviour, but it is the owner's call to
make knowingly, not a side effect to discover.

**If a mapping error shows up:** the ingest is idempotent on `(org_id, provider, external_id)`, and
`tmsMayOverwrite` lets the feed freely correct any load still in `draft`/`pending_approval`. Fix and
re-run; approved loads are deliberately immune.

---

### L2 · The review routine Alex can actually run — the artifact his mail asked for

**Why.** His words: *"when you are ready to publish a routine that will query the live database
systematically as we agreed please sent this to us first for a quick review."* A prose description
is not reviewable by a DBA. A file he can open, read and **execute on his own server** is.

**Files (new).**
- `tools/mcleod-agent/review/SILVICOM-READ-ROUTINE.sql` — the complete routine, commented for a
  reader who has never seen our code: the session settings we set, the **four** statements we ever
  run (change detect, board, stops, dispatchers), each with its parameters and its measured cost.
  It must be **runnable as-is** so he can time it himself.
- `tools/mcleod-agent/review/README.md` — one page: what runs, how often, from which host, under
  which login, what we never do, and the four questions (Q-GL1–Q-GL4).

**Content rules — each is a promise we are making in writing, so each must be true of the code.**

| We state | Enforced by |
|---|---|
| one connection, held, `max:1` | L5 |
| `SET LOCK_TIMEOUT 5000` — we yield, never queue behind a writer | L5 |
| `SET DEADLOCK_PRIORITY LOW` — their writers win | L5 |
| `MAXDOP 1` — we never take parallel workers | L5 |
| `READ COMMITTED`, and **never** `NOLOCK` | L5 gate |
| statement ceiling 15 s; cycle breaker at 2 s | L5 |
| read-only: `SELECT` on 7 tables + `CHANGETABLE` | the grant itself |
| every parameter typed (D-MCC11) | L5 gate |

**Done when.** Alex has the file and has replied. **Nothing is scheduled until he does** — L9 is
blocked on this, deliberately.

⚠ The file describes L5's behaviour, which is not built yet. Either build L5 first, or state plainly
in the README that these are the settings the scheduled routine will use and today's reads were
manual. **Do not send a document that describes code we have not written as though it were running.**

---

### L3 · Migration `0344` — the dispatcher table and column. Schema only.

**Why.** 110 of 110 dispatched loads carry a dispatcher we read correctly and then throw away,
because there is nowhere to put it. `tms_dispatchers` does not exist and
`loads.dispatcher_external_id` was never added — LM2 shipped only its `vehicle_positions` half
(0341/0342). Latest migration is `0343`, so this is **`0344`**.

**Do.** Exactly LM2's specification for those two objects, unchanged:

- `tms_dispatchers` — owner `mcleod`, layer `raw`, PK `(org_id, provider, external_id)`,
  `display_name`, `user_id` **nullable** → `auth.users` ON DELETE SET NULL, `is_system`, `is_active`,
  timestamps. `enable row level security`, no client policy (API-only).
- `loads.dispatcher_external_id` — `text`, nullable, indexed with `org_id` and `status`.
- `scripts/table-modules.json` entries, a PGlite matrix per new table printing `RESULT`, and the
  regenerated `schema.generated.sql` (that check hides inside `lint:table-writers`).

**No reader. No writer. Not in this PR.**

**Done when.** `pnpm lint:migrations lint:rls lint:table-writers lint:table-producers
lint:table-modules`, `node scripts/check-migration-ordering.mjs`, `pnpm test` with the matrices.

⚠ **`merge_driver` cascade:** `tms_dispatchers` does not cascade from `drivers`, so it is exempt —
but confirm rather than assume; no gate checks this.

---

### L4 · The dispatcher is written — **a separate merge from L3**

⚠ **This split is not optional.** Railway serves a merge ~2m44s before `migrate.yml` applies its
migration, so a writer merged alongside its column runs against a table that does not have it yet.
The two new *tables* are exempt from the ordering rule; **the new column is not**
(`lint:migration-ordering`).

**Files.** `apps/api/src/modules/mcleod/tmsLoadIngest.ts`, `routes/tmsIngest.ts`, new
`tmsDispatcherIngest.ts`, and `tools/mcleod-agent/agent.mjs` (turn on the dispatcher push that LM1b
deliberately left off, because posting to a 404 every cycle is noise).

**Do.** `ingestLoads` persists `dispatcher_external_id`. New `POST /api/tms/dispatchers` upserts
`tms_dispatchers` with a **complete** payload — never a partial upsert (`lint:upserts`: Postgres
checks NOT NULL before conflict arbitration) — and **never touches `user_id`**, because the link
between a McLeod account and a Silvicom person is an office act (LM11) that a re-sync must not undo.

**Done when.** `expectOrgScoped` asserts both writers; a test proves a re-sync leaves `user_id`
untouched; a test proves `is_system` is set for `loadmaster` and `lmeadm`; `pnpm verify:live` shows
`0344` **applied** before this merge is served.

**Proving mutation.** Delete the `user_id` exclusion and the re-sync test must fail. If it still
passes, the fixture has no linked dispatcher in it and the test was decorative.

---

### L5 · One connection, one query helper — the politeness policy, applied once

Exactly **MC3**, unchanged, plus one addition this session's measurements forced.

**Why it cannot be skipped.** `withPool` (`tools/mcleod-agent/roster.mjs:277`) opens `max:2, min:0`
and **closes the pool after every call**, with a 120-second request timeout, no lock timeout, no
`MAXDOP`, no breaker. Fine for a manual sweep; wrong for a connection that reconnects 1,440 times a
day at ~110 ms a handshake against a 4 ms query.

**Addition — D-MCC11, the typed-parameter gate.** Extend `scripts/check-agent-syntax.mjs` to fail on
a two-argument `.input(name, value)` anywhere under `tools/`. Measured this session: untyped binds
NVARCHAR against `char(32)` keys, the predicate stops being sargable, and the same query goes
**17 ms → 1,977 ms**. Silent, no error, 115×.

**Done when.** MC3's Done-when; **plus** `lint:agent-syntax` fails on an added `NOLOCK`, on a raw
query bypassing the helper, on a second connection, and on an untyped `.input` — **each proven by
mutation**. A duration assertion, not a row assertion, is what catches the typing one.

---

### L6 · `changes.mjs` — the change detector

Exactly **MC1**. Now unblocked: `VIEW CHANGE TRACKING` is granted (§2) and `CHANGETABLE` returns
**`company_id` and `id`**, so the watermark and every key are composite without our having to
reconstruct them.

Three rules it owns, none re-derived at a call site:

1. Compare `CHANGE_TRACKING_MIN_VALID_VERSION` against the stored watermark **before** querying.
   Greater ⇒ expired ⇒ signal `rebaseline`. **Never "no changes".**
2. A `NULL` from `CHANGETABLE` is an **error**, not an empty result.
3. The watermark advances **only after the push is acknowledged**.

**Done when.** MC1's Done-when: unit tests covering the expiry branch, the null branch and
advance-after-ack, **each proven able to fail** by mutating the implementation.

---

### L7 · `loads.mjs` reads the detector

Exactly **MC2**. Changed movement ids from L6, keyed re-read of only those, plus a re-read of
`continuity` for the active set (it is not change-tracked, and 420 rows is 0.19 s). Cadence 60 s.

**Done when.** A dry run against `lme` reproduces **the same load set** as a full sweep, compared id
by id; a run with an artificially stale watermark takes the `rebaseline` branch rather than reporting
zero. **Plus**, from this session: the cycle stays under 100 ms — assert it, because the untyped
regression is invisible any other way.

---

### L8 · The `VA` stop ruling — blocked on Alex (Q-GL1)

11 stops on 5 movements carry real appointments and coordinates and are declined by D-LM15's refusal
to guess, which leaves movement 290837 with stops 1, 2, 4, 6, 8 and holes. `load_stops.kind` is
`CHECK (kind IN ('pickup','dropoff'))` and `STOP_KINDS` matches it, so widening is a **migration plus
a contract change**, not a mapping tweak.

**Do not widen the vocabulary before the answer arrives.** LM2's own rule: *an `'other'` nobody can
define is worse than a reported exception.* When Alex answers, either add the kind properly
(migration + `STOP_KINDS` + `tmsStopInputSchema` + the mapping) or record that the tail is not driver
work and the reporting branch is the permanent answer.

---

### L9 · The VM, and the schedule — blocked on L2 and on Alex's access

1. Install Node and the agent on the Board VM. Nothing runs on a laptop.
2. `.env` with the `lme` credentials, the live token, `RUN_SCHEDULERS_IN_PROCESS` irrelevant here
   (this is not a Railway service), and `MCLEOD_SQL_SERVERNAME` once IT supplies the certificate
   hostname (D-MCC14) — **or a written decision to stay on `encrypt=false` inside their LAN.**
3. Windows Task Scheduler, **10 minutes to start**, tightening to 60 s only once the review queue
   proves it is worth it.
4. Verify against numbers, never a glance: board count ≈ live; unmatched report empty;
   `tms_dispatchers` seeded with 14, of which 2 are `is_system`; movement 11787 absent; ~16 reefers;
   the Dispatch → Loads page matching the McLeod board on a spot-check of three loads.

⚠ **Railway never connects to McLeod.** The agent runs inside the carrier's network and pushes
**outbound** over HTTPS. There is no inbound firewall rule to request and no IP allow-list to
maintain — that is the whole reason the design puts the reader on their side.

---

### L10 · Repoint the finance sweep at `lme` — independent, and now urgent

**MC5a**, unchanged in shape but newly urgent for a reason MC5a did not have: the sandbox it reads
was believed refreshed on 2026-09-17 and was not (§1). Finance is quoting figures frozen at
2026-09-10 today. Needs the LM0-shaped grant extended to the finance tables — a second request to
IT, worth sending in the same mail as L2.

**Done when.** MC5a's Done-when: the September billing count in staging equals `lme`'s (504 → 524 at
the last measurement), and MC4's sandbox warning no longer fires for the finance run.

---

---

### L11 · Make the ingest set-based — **we** are the bottleneck, not the carrier

**Why, measured.** §4.1: 52.1 s for 157 loads, 785 serial round trips at 66 ms each. A 60-second
cadence against a 52-second ingest has eight seconds of headroom. Every other step in this plan is
cheap by comparison, and this is the only one standing between us and a schedule.

**Files.** `apps/api/src/modules/mcleod/tmsLoadIngest.ts` and its tests.

**Do.** **Partition first, purely and in memory** — create / amend / cancel / skip — then **one
set-based write per partition per table**, in foreign-key order: `loads`, then `load_stops`, then
`load_external_payloads`, then `load_events`. That is roughly **six round trips for the whole
payload instead of 785**.

**Constraints that must survive the rewrite — each one is why this is not a five-minute change:**

- `lint:upserts` forbids a partial upsert: Postgres checks NOT NULL before conflict arbitration, so
  every set-based upsert carries **complete** rows. Migrations 0174/0175 are the pattern.
- ⚠ **`tmsMayOverwrite` still decides per load.** An `approved`, `accepted`, `in_transit` or
  `delivered` load is **never** overwritten by the feed. A blind bulk upsert would silently
  overwrite work an office has already approved — **this is the one place where a performance change
  can cause a correctness loss**, and it is the reason the partition is computed before any write.
- The per-load `results[]` and the unmatched report keep their present shape: the agent log and
  LM12's verification both read them.
- `load_events` is an evidence table and stays append-only. Batching its inserts is fine; collapsing
  two events into one is not.

**Done when.** The same 157-load payload ingests in **under 5 seconds**, measured against the same
board and stated in the progress log; every **behaviour** the `tmsLoadIngest` suite pins still holds;
and a **new** test proves an approved load is not overwritten when it shares a batch with loads the
feed does own — **proven by mutation**: remove the ownership guard and that test must fail.

⚠ **Corrected 2026-09-17, during execution.** This step originally required that *"every existing
test still passes unchanged"*. That was written before the suite was read and **could not be met**:
those tests assert the SHAPE of each write (`payload as { status }` on a single `loads` insert), and
batching necessarily turns one payload into an array. The assertions were moved to the new shape with
every behavioural claim intact, and the test double was corrected to model a bulk insert — it now
returns the created rows **reversed**, because PostgREST does not promise their order. Requiring a
test not to change is the wrong kind of promise; requiring the behaviour not to change is the right
one.

---

### L11b · A set-based UPDATE RPC, to remove the last per-row write

**Why.** L11 batches everything except the overwrite patches, because each patch sets different
values and one UPDATE can only set one. That path runs with bounded concurrency (8) — faster than
serial, still a statement per row, and **labelled as a deliberate intermediate in
`applyOverwrites`** rather than left as silent debt.

**Do.** The pattern this repository already uses: a migration adding an RPC that takes a `jsonb`
array and applies every patch in one statement (migrations 0174/0175). ⚠ `lint:migration-ordering`
**cannot see functions**, so the RPC ships one merge ahead of its first caller and `pg_proc` is
checked by hand before the caller merges.

**Not urgent, and say why:** once the change detector lands (L7) a cycle carries the ~28 movements
that changed in the last hour, not all 157 — so this path shrinks by an order of magnitude on its
own. Sequence it after L7 and re-measure before building it; it may not be worth a migration.

## 6. The testing routine — what "tested" means at each stage

Four levels, because each catches what the others cannot. This repo has been bitten by tests that
passed through real defects, so each level names the way it is kept honest.

| Level | Where | Catches | Kept honest by |
|---|---|---|---|
| **1 · Unit** | `tools/mcleod-agent/*.test.mjs`, `node --test` | mapping, the expiry and null branches, typed parameters | **Every assertion proven able to fail by mutating the implementation.** Fifteen loads tests exist; the fourth mutation found a fixture too uniform to discriminate |
| **2 · Contract + ingest** | `apps/api/**/*.test.ts`, PGlite matrices | org scoping, idempotency, `user_id` preservation, RLS | `expectOrgScoped`; matrices must print `RESULT` — a silent matrix fails. ⚠ The route `safeParse`s **before** the ingest sees the payload, so a zod default is invisible to a test that builds input in TypeScript — schema behaviour gets its own test in `packages/shared` |
| **3 · Dry run against live** | `node agent.mjs --loads --dry-run` | everything the sandbox cannot: real nulls, real teams, real `VA` stops, real volume | Read-only, posts nothing. Compare detector output against a full sweep **id by id**, not by count |
| **4 · Production verification** | `Dispatch → Loads`, `supabase db query --linked` | that what we believe we sent is what arrived | Spot-check **three named loads** against the McLeod board by hand. A row count agreeing is not the same as a load being right |

**The standing rule for this feed:** a number, not a glance. "It looks like it worked" has twice in
this repo's history meant a snapshot that had not landed.

---

## 7. Open questions

1. **Q-GL1 — what is stop type `VA`?** Alex. Blocks L8 and the itinerary of 5 loads.
   Recommendation: map to a waypoint kind once confirmed.
2. **Q-GL2 — does `A` mean available/uncovered?** Alex. Recommendation: ingest, do not draw
   (D-MCC12).
3. **Q-GL3 — the certificate hostname** (D-MCC14), and **Q-GL4 — narrow the `driver` grant**
   (D-MCC15). Both ride on L2's mail, with L10's finance grant.
4. **Q-GL5 — does the owner accept 156 pending loads appearing on Dispatch → Loads?** Needed before
   L1. Recommendation: yes — it is LM12's intended first week, and it is reversible while the loads
   are unapproved.

---

## 8. Progress log

Append a dated line per merge. Never edit a status column — parallel PRs conflict on table rows.

- 2026-09-17 — plan written from the first live connection through `silvicom_dispatch_ro`. §1–§4
  measured against production `lme` this session; nothing built, nothing posted, no code changed.
  **LM1b's Done-when met** (156 loads / 335 stops / 14 dispatchers through the shipped mapping).
  `VIEW CHANGE TRACKING` confirmed granted, so D-MCC9's fallback is off the table. Five decisions
  allocated, D-MCC11–D-MCC15, of which D-MCC11 (typed parameters, 115× measured) is the one that
  would have silently cost us the collector's entire justification.
- 2026-09-17 — §5–§7 written as ten one-PR steps after checking each against the code rather than
  the plans: `tms_dispatchers` and `loads.dispatcher_external_id` confirmed absent from all 343
  migrations, `load_stops.kind` confirmed `CHECK (pickup|dropoff)`, `org_integrations` confirmed to
  hold **only** the live org's two rows — so the QA org the local agent config targets has nothing
  to post to, which is now L0.
- 2026-09-17 — **L0 and L1 are DONE.** L0 needed no work: the ingest token in the agent's gitignored
  config was already the live org's, re-issued 2026-08-28 — the header calling it QA-only was three
  weeks stale, and rotating it would have broken the roster and financial sweeps. L1 ran: **157 loads,
  333 stops, all `pending_approval`**, 138 with a driver, 139 with a vehicle, 111 with a trailer.
  Three loads verified by hand against McLeod — `ref`, `external_status` and miles exact.
  ⚠ Movement 290837 stored **6 of its 10 stops**: the `VA` gap is now a real load on a real screen,
  which makes Q-GL1 the first question Alex should answer. A second unmapped type, `SP`, appeared.
  The single unmatched key (`JFERGUSO`) is a **stale roster, not a broken link** — that driver was
  hired 2026-09-14 and our roster sweep last ran 2026-09-14 19:11. Noted in passing:
  **`drivers.employee_id` is populated on ZERO of 299 rows**, so every driver match runs on
  `mcleod_driver_id` alone.
- 2026-09-17 — **L2 built, and §4.1 added because measuring for it reversed a premise.**
  `tools/mcleod-agent/review/SILVICOM-READ-ROUTINE.sql` is generated from `queries.mjs` so it cannot
  drift, carries the four questions, and was **executed against live `lme` to prove the claim that
  the carrier can run it as-is** — four result sets, 178 ms. `review.test.mjs` pins it to the code and
  to the promises it makes; all four assertions **proven able to fail** by mutation (a drifted query,
  a removed lock timeout, an injected `NOLOCK`). D-MCC16 and step **L11** added: the carrier's server
  costs 16 ms of CPU and our own ingest costs 52.1 seconds, so the bottleneck was never theirs.
- 2026-09-17 — **L11 built.** `ingestLoads` now **classifies every load purely, then issues one
  statement per table**; the writers moved to `tmsLoadIngestWriters.ts` (the 500-line budget, and a
  cleaner split: the classify file now writes nothing at all, so the three grandfathered
  `loads`-owned write sites MOVED path rather than multiplying — `lint:table-modules` and
  `lint:table-writers` both ratchet, and both pass). Round trips for a 157-load first pull go from
  **942 to ~11**. ⚠ Not yet measured end to end: the agent posts to the deployed API, so the 52.1 s →
  ? figure can only be taken **after this merges**, and L11's Done-when is not closed until it is.
  Three mutations were run against the implementation: removing the ownership guard kills 5 tests,
  reordering the results kills 2 — and **pairing inserted ids by position killed nothing**, because
  every fixture had interchangeable loads. That is the "fixture too uniform to discriminate" trap
  again; a test with two loads carrying different stops, against a stub that returns the rows
  reversed, now kills it. 24 tests in the file, 3,825 in `apps/api`, all green.
