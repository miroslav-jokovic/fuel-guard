# Samsara collection — completeness, freshness, and the collector/harness seam

**Opened 2026-09-01 against `main` @ 3adfe17.** Companion to
`docs/plans/fuel/FUEL-SECTION-CONSOLIDATION-PLAN.md`, which measured the symptoms; this one owns the
cause. It is a **collector-architecture** plan, not a fuel-section plan, and it is filed separately for
that reason.

The owner's framing, 2026-09-01, is the thesis: *"our collectors should be updated selectively in short
intervals — if there is any change on source we should have that data that has changed updated in our
database, and not all data pulled again and again"*, and the acceptance question: *"I want to make sure
that we always have fresh data."* §1.1 answers that question honestly, including the part of it that
cannot be promised.

---

## 0. Ground truth (measured 2026-09-01 — tree, production database, and the live Samsara API)

### 0.1 What we schedule today

| Tier | Cadence | Shape of the call |
|---|---|---|
| `stats` — odometer, fuel level | **20 min** (`SAMSARA_STATS_SYNC_MINUTES`) | `GET /fleet/vehicles/stats` — **full snapshot**, all vehicles |
| `identity` — vehicles, drivers, trailers | **12 h** (`SAMSARA_IDENTITY_SYNC_HOURS`) | `GET /fleet/vehicles`, `/fleet/drivers`, `/fleet/trailers` — full lists |
| `driver-scores` + `idle` | **6 h** | window pulls |
| `ifta` | **24 h** | window pull |
| `retention` | 24 h | DB only |
| **per-fill telematics reconciliation** | **none — no tier exists** | only as a side effect of scoring |

For comparison, the EFS SOAP poller runs **every 5 minutes** (rejected) and **15 minutes** (posted).
**Nothing in the product is push-driven.** EFS is not "real time"; it is a fast poll.

Verified alive: `sync_stats` ran **192 times in the last 24 h**, `sync_vehicles` **154 times in 7 days**.

### 0.2 Every call is a snapshot or a window — the delta feed is not used

`listAllPages` walks `pagination.endCursor`, but that is **intra-request paging**: `after` is a local
variable, reset on every run, never persisted. Endpoints in use: `/fleet/vehicles`,
`/fleet/vehicles/stats`, `/fleet/vehicles/stats/history`, `/fleet/drivers`, `/fleet/trailers`,
`/v1/fleet/trailers/assignments`, `/fleet/hos/logs`, `/fleet/hos/clocks`, `/safety-scores/drivers`.

**`GET /fleet/vehicles/stats/feed` — Samsara's cursor-based delta feed — has zero references in the
codebase.**

A snapshot poll shows where a value **is**, never where it **was**. A truck that fuels at 10:07 and
leaves at 10:19 is invisible between the 10:00 and 10:20 snapshots. That is not a cost problem at 195
vehicles; it is a **completeness** problem, and it is the direct cause of §0.3.

### 0.3 The coverage hole this produced (production)

| Measured | Value |
|---|---|
| Non-retired vehicles / linked to Samsara | 195 / **195 — zero unlinked** |
| Vehicles with a fuel level fresher than 7 days | 164 (84%) |
| Tractor fills where `samsara_recon_status` is **null — never attempted** | **10,522 of 13,696 — 76.8%** |
| Attempted → `success` / `no_data` / `skipped` | 3,017 / 32 / 130 — **95.9% success when it runs** |
| `fuel_events` (the webhook's table) | **0 rows, no event ever received** |

By month: 2026-03 **0** successes, 2026-04 **0**, 2026-06 **0**; 2026-02/05/07 partial (319 / 259 / 239
— the signature of bucketed backfills started and stopped); **2026-08 onwards ~100%**.

### 0.4 Why 77% were never attempted — the code says it plainly

Per-fill telematics is fetched inside `modules/anomalies/scoring/reconcile.ts`, i.e. **as a side effect
of scoring**. `ScoreOpts.skipRecon` documents the consequence:

> *"Reuse the Samsara values already stored on the transaction instead of making a fresh live call. Used
> by bulk rebuilds so re-scoring thousands of historical rows doesn't hammer the Samsara API (and stay
> within rate limits). New imports use a fresh reconciliation (`skipRecon=false`)."*

New import → fetch (hence August at ~100%). Bulk rebuild, the post-import cascade and `scoreVehicle` →
`skipRecon: true` → reuse stored values, and for a historical row there are none, **so it stays null
permanently**. Nothing incidental will ever fill it.

**This is the inversion.** Collection is subordinate to calculation, and because collection-at-scale
would exhaust the vendor rate limit, it was disabled on exactly the path that processes volume.

### 0.5 Two checks run against the live Samsara API, 2026-09-01

**Check 1 — retention. ANSWERED: the history is fully available; retention is NOT the constraint.**
`GET /fleet/vehicles/stats/history` over 8 vehicles, one sample day per month,
`types=fuelPercents,obdOdometerMeters`:

| Day | fuelPercents | obdOdometerMeters | vehicles with data |
|---|---|---|---|
| 2026-01-15 | 581 | 5,175 | 6 of 8 |
| 2026-02-15 | 250 | 2,639 | 4 of 8 |
| 2026-03-15 | 385 | 3,227 | 6 of 8 |
| 2026-04-15 | 982 | 9,075 | **8 of 8** |
| 2026-05-15 | 878 | 7,090 | 7 of 8 |
| 2026-06-15 | 651 | 5,034 | 7 of 8 |
| 2026-08-15 | 508 | 5,090 | 6 of 8 |

**Every one of the 10,522 fills with no telematics is recoverable.** The gap is ours, not the vendor's.

**Check 2 — webhooks. ANSWERED, and it found two live defects.** `GET /webhooks` returns **2**
configured on the account:

1. `Fleetpal Webhook` → a third party. Events `VehicleCreated`, `VehicleUpdated`, `DvirSubmitted`.
2. `Fleetguardweb` → **ours**, pointed at `https://fleetguardweb-production.up.railway.app/api/webhooks`,
   events `RouteStopArrival`, `RouteStopDeparture`, `RouteStopResequence`, `RouteStopEarlyLateArrival`,
   `RouteStopEtaUpdated`.

Two independent reasons it has never delivered anything:

- **The path is wrong.** Our handler is mounted at **`POST /api/webhooks/samsara`**
  (`app.use("/api/webhooks", webhooksRouter())` + `router.post("/samsara", …)`). Samsara is posting to
  `/api/webhooks`, which matches no route → 404 on every delivery.
- **The events are wrong.** We subscribe to five **route-stop** events. `processSamsaraWebhook` is
  written for a *sudden fuel-level drop* (the siphoning signal) and writes `fuel_events`. Even with the
  path corrected, nothing we receive would be stored.

**Check 3 (added) — is the delta feed reachable with this token?** `GET /fleet/vehicles/stats/feed?types=fuelPercents,obdOdometerMeters`
→ **HTTP 200**, 192 vehicles in the first page, a valid `endCursor`, ~~`hasNextPage: false`~~. **The
recommended mechanism works on the current plan and scope.** No entitlement question to resolve.

> ⚠ **CORRECTED 2026-09-01 by S2, and the original reading would have hung the tier.** `hasNextPage` is
> **`true`, always** — re-measured against the live feed by walking it twelve pages deep, including on
> pages carrying a single sample and on an immediate re-poll of an idle fleet. It never went false. On
> a *delta* feed the flag means "this stream continues", not "there is more data right now", so a
> `while (pagination.hasNextPage)` walk — which is what this plan's S2 Build bullet implies — never
> terminates. **A page with an empty `data` array is the end of the available delta**
> (`feedPageHasData`).
>
> Also measured, and load-bearing for S2's shape: **the feed returns per-vehicle ARRAYS**
> (`fuelPercents: [{time, value}]`), not the singular objects `/fleet/vehicles/stats` returns. The
> existing `parseVehicleFuelPercents` / `parseVehicleStatsOdometer` read `.value` off those arrays and
> would yield `undefined` for every truck, silently. The shapes therefore have separate parsers.
>
> Volume, for S5's cadence argument: a cursorless seed of the whole fleet drained in **12 pages / 422
> samples** (396 of them on page 1), and a re-poll seconds later returned **1 vehicle, 1 sample**. The
> delta is real and it is cheap.

### 0.6 The one-line thesis

**Samsara data is not missing because Samsara withholds it, or because the layering is wrong — it is
missing because nothing owns collecting it.** The layering is in fact good (§1.2). What does not exist
is a collector that is complete by construction, on its own schedule, independent of whether anything
downstream happened to ask.

---

## 1. The architecture this must end in

### 1.1 Freshness is a bounded promise, and "always fresh" is not one of the options

The owner's acceptance question deserves a straight answer rather than a reassuring one.

**No mechanism gives "always fresh".** What each gives is different, and the difference matters:

| Mechanism | Completeness | Latency | Fails how |
|---|---|---|---|
| Snapshot poll (**today**) | **none** — anything between polls is lost forever | ≤ interval | silently, and invisibly |
| **Cursor delta feed** | **guaranteed** — the cursor advances or it does not | ≤ interval | loudly: the cursor stalls |
| **Webhook** | **not guaranteed** — providers drop, retry, and a receiver outage loses events | seconds | silently, unless reconciled |

So: **a webhook alone is fast and lossy; a cursor feed alone is complete and up to one interval stale.**
The only answer that is both is **both** — webhooks for latency, the cursor feed underneath as the
reconciler that makes completeness a property of the system rather than a hope. This is the standard
shape and it is what D-SAM2 adopts.

What this plan can therefore promise, and will measure:

- **Completeness:** every change at the source lands, eventually, with no silent gap. **Guaranteed** by
  the cursor.
- **Freshness:** a *stated, per-feed staleness bound*, monitored, and **shown on the surfaces that
  depend on it** — not a global claim. Fuel-theft detection does not need seconds; a live map does. A
  single global "fresh" target would over-poll most feeds and under-serve one.
- **Honesty:** where the bound is exceeded, the product says so, in the pattern IFTA's health gate and
  the spend coverage line already use.

**Anyone who tells you a polling integration is "always fresh" is describing the happy path.** S5 turns
freshness into a number with a threshold and an alarm, which is the enterprise-grade version of the
request.

### 1.2 The layering is already right — do not rewrite it

`samsaraRecon.ts` performs I/O and imports its logic — `parseSamsaraSamples`, `findFuelingEvent`,
`resolveTankFuel`, `resolveOdometer`, `resolveLocation`, `resolveCapacity` — from `@silvicom/shared` as
pure functions. The harness reaches it through `modules/samsara/index.js`, the module's public
interface, never its internals. `modules/anomalies` reads `fuel_transactions` (core), never a Samsara
staging table. **D-ARC1 is satisfied.** The brain is already separated from the collector.

What is inverted is **control flow**, not dependency direction. The fix is a scheduler tier and a
cursor, not a re-architecture.

### 1.3 A collector is complete by construction, or it is a best-effort script

A collector whose coverage depends on what a downstream consumer happened to request is not a
collector. Every feed here gets: a **persisted cursor or a watermark**, a **resumable backfill**, its
own **rate budget**, and a **coverage figure that can be read without writing SQL**.

### 1.4 Selective where change is continuous; whole where it is not

The owner's rule is right and should not be applied uniformly. `stats`/telematics change every minute
and are where loss occurs — those get the delta feed. Vehicles, drivers and trailers change a few times
a month; a 12-hour full pull of 195 rows is cheap, simple, and self-healing. Delta machinery there would
be complexity bought with nothing. **IFTA stays a daily window pull**: a quarterly filing does not need
a cursor.

---

## 2. Decisions

- **D-SAM1 — per-fill telematics becomes a collector tier that owns itself.** Its own schedule, cursor,
  rate budget and resumable backfill. It stops being reachable only through scoring.
- **D-SAM2 — webhooks for latency, cursor feed for completeness, always both.** Neither ships alone.
  A webhook event is a hint that arrives early; the feed is what makes the record true.
- **D-SAM3 — `skipRecon` stops meaning "never fetch".** It becomes "not on this pass — enqueue it", so a
  bulk rebuild leaves work behind rather than a permanent hole. The rate-limit concern that created it
  is real and is answered by the queue, not by dropping the work.
- **D-SAM4 — the stats tier moves to `/fleet/vehicles/stats/feed` with a persisted cursor.** Verified
  reachable on the current token (§0.5 check 3).
- **D-SAM5 — identity, IFTA and driver-scores keep their full/window pulls.** Explicitly out of scope,
  per §1.4, so that a later reader does not mistake the omission for an oversight.
- **D-SAM6 — freshness is a per-feed SLO with a surfaced staleness figure**, not a global adjective.
- **D-SAM7 — coverage is measured against an all-time denominator, not the selected window.** The
  Dashboard's existing "Telematics coverage — fills corroborated" tile computes
  `coveredTxns / totalTxns` over the *chosen window*, so on a recent window it reads ~95% and looks
  healthy while 76.8% of history has nothing. A coverage figure whose scope hides the gap is worse than
  none.
- **D-SAM8 — the backfill is a first-class, resumable, observable job**, not a script somebody runs. The
  319/259/239 partial months are what "somebody ran it" looks like six months later.

---

## 3. Facts the design is bound by (verified 2026-09-01)

- `/fleet/vehicles/stats/feed` returns 200 with a valid `endCursor` on the current token and scope.
- Historical `stats/history` is available back to at least 2026-01 (§0.5) — the backfill is possible.
- Samsara caps `/fleet/vehicles/stats/history` at **10 req/s per token** (`samsaraStats.ts`), and
  `BUCKET_MAX_MS = 96 h` bounds one grouped fetch window (`backfill.ts`). Any backfill honours both.
- `backfillOrg` already implements bucketed live recon with `reconHealth` and an abort-on-systemic-failure
  guard (`BACKFILL_ABORT_AFTER`) — **it is not written from scratch**, it is scheduled and made resumable.
- The webhook receiver verifies HMAC-SHA256 over `v1:<timestamp>:<rawBody>` and **fails closed** when
  `SAMSARA_WEBHOOK_SECRET` is unset. The secret is `z.string().optional()` in `env.ts`, so an unset
  secret is a silent no-op, not a boot error.
- Schedulers must run in **exactly one process fleet-wide** (`docs/WORKER-DEPLOYMENT.md`); a new tier
  goes into the existing `startAllSchedulers` path, never a second fleet.
- `fuel_events` is owned by the `samsara` module (D-ARC3, ARCHITECTURE §2). A new cursor table is
  owned by `samsara` and gets `enable row level security` with no client policy (`check-rls.mjs`).
- Any new table ships with a PGlite matrix printing a `RESULT` line, and a column ships one merge ahead
  of its first reader (`lint:migration-ordering`).

---

## 4. Execution protocol

**Resume ritual:** read this document, then `docs/ARCHITECTURE.md` §1–§3 (D-ARC1/D-ARC3),
`docs/WORKER-DEPLOYMENT.md`, and `FUEL-SECTION-CONSOLIDATION-PLAN.md` §0.3a (what the coverage hole
costs downstream). Establish reality with `git log --oneline -15`, `pnpm verify:live`,
`git branch --show-current`. One step per branch from `origin/main` explicitly, PR to `main`.

**Gates:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus each step's named extras.
⚠ `pnpm lint` scans `.claude/worktrees` — filter the path before believing a failure count.

### 4.0 Verification status

| Step | Status | Basis |
|---|---|---|
| S1 | **verified** | Both defects proved from the live `GET /webhooks` response and the mount path in `app.ts`/`webhooks.ts`. |
| S2 | **verified** | Feed endpoint returns 200 with a cursor on this token. |
| S3 | **verified** | `skipRecon` semantics read; the 77% measured; no tier exists in `samsaraScheduler.ts`. |
| S4 | **verified possible** | History available back to 2026-01 across 8 vehicles. **Full-fleet volume and runtime are NOT measured** — S4 opens with that measurement. |
| S5 | **MERGE 1 of 2 SHIPPED 2026-09-05** | Q-SAM1 answered. The number and its surface are built; the alarm and the dependent-surface strips are merge 2. |
| S6 | **assumption — deliberately** | That backfilled telematics materially moves the 2.9% precision is **expected, not proven**. S6 measures before and after and is allowed to conclude it did not. |

---

## 5. Steps

**Order:** `S1 → S2 ∥ S3 → S4 → S5 → S6`. S1 is hours of work and is the only one that changes anything
today; S3 stops the hole growing; S4 closes the one that exists.

### S1 · Point the webhook at the handler, and subscribe to events we handle

**Prerequisites:** none. Smallest possible first PR, and mostly configuration.

**Build.**
- In the Samsara dashboard, correct the `Fleetguardweb` webhook URL to **`/api/webhooks/samsara`** and
  subscribe it to the fuel-level event `processSamsaraWebhook` is written for. ⚠ Owner action — this is
  a vendor-console change, not a code change.
- Set `SAMSARA_WEBHOOK_SECRET` in Railway. Until it is set the receiver fails closed and every delivery
  is rejected.
- **Code:** make the missing secret loud. A webhook receiver that silently rejects everything for six
  months is the defect this step is actually fixing — boot logs a warning when the route is mounted
  without a secret, and the integration settings page shows "configured / never received an event / last
  event at".
- Decide what to do with the five `RouteStop*` subscriptions: either handle them or unsubscribe. An
  event type nobody handles is a 404 generator.

**Done when.** A test event from the Samsara console produces a row and a visible "last event at".

**Verified by.** Receiver tests already exist for signature verification; add one asserting an unset
secret warns rather than passing silently.

#### — CODE HALF SHIPPED 2026-09-01. The step stays OPEN: nothing has been received yet.

**What shipped** (PR #444, `claude/samsara-webhook-visibility`) is only the half that was a defect in
this repository. Both live defects — the vendor URL and the unset secret — are a Samsara console
setting and a Railway variable, and neither is a code change; they remain owner actions (handoff §4.1
items 2 and 3). What WAS ours is that neither was visible from inside the product: `fuel_events` sat
at 0 rows for six months and no surface distinguished *no siphoning happened* from *nothing can reach
us*. So:

- `SAMSARA_WEBHOOK_PATH` is now one exported constant — the string the settings card prints for an
  operator to paste — and `apps/api/src/routes/webhooks.test.ts` asserts the app actually routes it
  (401, fail-closed) while the prefix the vendor was given (`/api/webhooks`) still 404s. A future
  re-mount now breaks a test rather than the integration.
- `samsaraWebhookBootWarning(env)` logs at mount when `SAMSARA_WEBHOOK_SECRET` is unset, naming the
  path and the 401. An `optional()` secret used to boot clean and reject everything silently.
- `GET /api/integrations/samsara/webhook` reports secret-configured / all-time event count / last
  event / the exact URL to configure. The count is **all-time, not windowed** (D-SAM7): a windowed
  zero reads as a quiet week. The gate is derived — `rolesThatCanView("settings")`, not a hand-listed
  role set; this file's older `requireRole("admin")` writes are FUEL-T2's surface and were left alone.
- A "Fuel-drop webhook" card on Settings → Data & sync renders the three states.

**Verified by:** `samsaraWebhookBootWarning > warns when the secret is unset, naming the path the
receiver is mounted at`; `readSamsaraWebhookStatus > reports a receiver that has never received
anything, and is org-scoped` (`expectOrgScoped`); `the Samsara webhook receiver > is routed at the
path we publish, and refuses an unsigned delivery there`; `DataSyncPage — the fuel-drop webhook card >
distinguishes 'configured but nothing has ever arrived' from a quiet week`. Each was proved able to
fail by mutating its subject (wrong published path; a boot warning that returns null; a dropped
`org_id` filter; the never-received branch removed). Gates: `pnpm test`, `pnpm typecheck`, `pnpm
lint`, and the ~19 CI gates run individually — all green.

**What remains before S1 is DONE**, and none of it is code:
1. Correct the `Fleetguardweb` webhook URL in the Samsara console to the path the card prints.
2. Subscribe it to the sudden fuel-level drop alert instead of the five `RouteStop*` events (Q-SAM2).
3. Set `SAMSARA_WEBHOOK_SECRET` in Railway.
Then a test event from the console should move the card off "no event has ever arrived", which is the
Done-when above.

### S2 · The stats tier moves to the delta feed

**Prerequisites:** S1 (independent, but S1 is faster and de-risks the webhook half of D-SAM2).

**Build.**
- New table `samsara_feed_cursors` (org, feed, cursor, updated_at) — owned by `samsara`, RLS on, no
  client policy.
- `syncVehicleStatsFromSamsara` calls `/fleet/vehicles/stats/feed` with the stored cursor and advances
  it only on a fully applied page. A failed apply leaves the cursor where it was — **at-least-once, never
  at-most-once**.
- First run with no cursor: take the snapshot path once to seed, then switch.
- Keep the 20-minute cadence initially. **The cadence is now a latency knob, not a completeness one** —
  which is the whole point, and it means S5 can tune it on evidence instead of on nerves.

**Done when.** A value that changes twice between two polls produces two records rather than one.

**Verified by.** A test that advances the cursor across a simulated multi-change window;
`lint:rls`, `lint:table-modules`, `lint:migrations`, a PGlite matrix with a `RESULT` line.

#### — MERGE 1 of 2 SHIPPED 2026-09-01 (`claude/samsara-feed-cursors`). S2 stays OPEN until merge 2.

**What shipped.** Migration **0288**, `samsara_feed_cursors` — primary key `(org_id, feed)`, an opaque
`end_cursor`, `updated_at` maintained by `set_updated_at()`, RLS enabled with **no policy at all**, and
the ownership entry (`module=samsara; layer=infra`). Nothing reads or writes it yet; that is merge 2.

**⚠ The plan said column `cursor`; it shipped as `end_cursor`, and the reason is not cosmetic.** The
value is Samsara's `pagination.endCursor` and is opaque — we never parse one and could never construct
one. A column called `cursor` reads like something this system owns and could recompute after a loss;
`end_cursor` says whose it is. Same reason `feed` is a checked-non-empty text vocabulary rather than an
enum: a new feed is a new collector tier, which is application work, and making it also a migration
would buy nothing.

**Two merges, not one, even though the gate would have allowed one.** `lint:migration-ordering` exempts
new tables — "their readers are new code paths, so the window degrades a feature nobody is using yet".
That exemption does **not** describe this step: the reader is the *existing* stats tier, which works
today. Splitting is what HANDOFF-2026-09-01 §4 instructs, and it means the ~9-minute window between a
merge being served and its migration being applied cannot touch a live tier.

**The cost of splitting, named because it is a change to a gate's own file.** With no writer yet,
`lint:table-producers` fails — schema nothing writes is "a promise nobody is keeping". The table is on
that gate's waiver list for exactly one merge, with merge 2 named as what removes it. **If that entry
outlives this step, the step did not finish.**

**Verified by:** `supabase/tests/samsara-feed-cursors.test.mjs` — 21 assertions, `RESULT` line, and
`rls.test.mjs` (459) discovered and seeded the table on its own, so cross-tenant isolation is covered
without a hand-written case. Proved able to fail by four mutations of 0288: dropping `enable row level
security` (8 fail), dropping the `end_cursor` check (3), removing the `updated_at` trigger (1), and
narrowing the primary key to `org_id` alone (1). Gates run individually and green: `pnpm test`,
`typecheck`, `lint`, `build`, `lint:migrations`, `lint:migration-ordering`, `lint:rls`,
`lint:table-writers` (with the regenerated `schema.generated.sql` staged), `lint:table-producers`,
`lint:tests`, `lint:upserts`, `lint:comment-claims`, `lint:filesize`, `lint:funcsize`,
`lint:boundaries`, `lint:rpc-org-default`, `lint:capabilities`, `lint:secrets`, `lint:codegen`,
`lint:tokens-parity`, `lint:ui-adoption`.

**What merge 2 owes, and one thing it has to settle first.** The Done-when above — *"a value that
changes twice between two polls produces two records rather than one"* — **cannot be satisfied by the
Build list as written**, and that is worth saying before the reader is built rather than after.
`syncVehicleStatsFromSamsara` writes `vehicles.current_odometer` and `vehicles.samsara_fuel_percent`:
single current-value columns, where the last sample wins and the intermediate one is lost exactly as it
is today. Swapping the endpoint alone changes the mechanism and nothing observable. See **Q-SAM5**.

#### — MERGE 2 of 2 SHIPPED 2026-09-01 (`claude/samsara-stats-feed-reader`). **S2 is DONE.**

**What shipped.** `samsaraStatsFeed.ts` — the stats tier now walks `GET /fleet/vehicles/stats/feed`
from the cursor stored in 0288, accumulates every page of the delta, applies it, and only then advances
the cursor. `syncVehicleStatsFromSamsara` moved there from `samsaraVehicleSync.ts` under the same name,
so the scheduler tier and the queue handler are unchanged. Cadence is untouched at
`SAMSARA_STATS_SYNC_MINUTES` — **it is a latency knob now, not a completeness one**, which is the point.

**The Done-when is met, via Q-SAM5 (a).** A contiguous descent in tank level is filed to `fuel_events`
with `fuel_pct_before` / `fuel_pct_after` — **the first producer ever to write those two columns; 0021
added them and the webhook populates neither.** Two descents between two polls therefore produce two
rows, which is precisely what `vehicles.samsara_fuel_percent` cannot represent.

**Nothing about the detector is invented, except one number that is stated as such.**
- Capacity is `resolveCapacity()` — sensor-measured over entered, with the observed-fill floor — never
  the entered figure, because 101 of the 145 trucks with a learned capacity disagree with theirs by >15%.
- The gallons floor is the existing `TANK_FILL_MIN_TOLERANCE_GAL` (15), not a new constant.
- The gate is `tank_sensor_reliable`, the same one `ruleEligible` puts in front of `tank_fill_short` —
  the gate the fuel plan measured at **19 fires / 0 false**, against ungated `cumulative_overfuel`'s
  89 / 55 / 0 (§0.3a). It is narrow today (12 of 195 trucks) and widens as S3/S4 feed the learner, so
  **what it suppresses is counted into the `jobs` ledger** rather than discarded.
- ⚠ The one judgement: `FUEL_DROP_MAX_GAP_MINUTES = 30`, standing in for a fuel-burn model. Stated, not
  tuned: over 30 minutes a tractor at highway speed burns ~5 gal at a 6 mpg baseline, so the 15-gal
  floor sits at ~3x the largest consumption the window can legitimately contain. **SAM-S6 owns changing it.**

**⚠ It does NOT email.** The webhook path calls `notifyFuelDrop`; this one deliberately does not. A new
detector joining a queue measured at 2.9% precision earns an inbox before it earns an inbox alert.

**Two things the live API corrected, both in §0.5 check 3 above** — `hasNextPage` is always true (a
`while (hasNextPage)` walk, which this plan's Build bullet implies, never terminates), and the feed
returns arrays where the snapshot returns singular objects.

**One thing this forced, named because it touches a gate's ledger.** `vehicles` is owned by `roster`,
and `lint:table-modules` grandfathers exactly ONE out-of-owner write site for it in this module — a
list that may shrink and not grow. Writing `vehicles` from the new file would have pinned the same debt
twice and stepped the ratchet backwards, so the write stays in `samsaraVehicleSync.ts` behind
`writeVehicleTelematics()` and the collector reads and diffs where its logic lives. **The real fix is a
roster-owned "a collector observed this truck" interface; it is not this step's to build, and the
function's comment says so.**

**Verified by:** `samsaraStatsFeed.test.ts` (17) — `resumes from the stored cursor rather than
re-reading the feed's head`; `treats a missing cursor table as 'no cursor' instead of failing the
tick`; `stops on an EMPTY page, never on hasNextPage — which the live feed never sets false`; `cannot
spin forever on a vendor that never returns an empty page`; `advances the cursor only AFTER the page is
applied — at-least-once, never at-most-once`; `a cursor it cannot store does not lose the samples it
already applied`; `two descents between two polls produce TWO rows, not one`; `a descent split across
pages is ONE event, because pages accumulate before anything is judged`; `re-delivery collides with the
row it already wrote instead of doubling the queue`; `suppresses a drop on a sensor the learner does not
trust, and COUNTS what it suppressed`; `sizes the loss against the LEARNED capacity, not the entered
one`; `never emails — the webhook notifies, this does not, because the detector has not earned an
alert`; `is org-scoped, like every other service-role read` (`expectOrgScoped`). Plus
`samsaraStatsFeed.test.ts` in `packages/shared` (13) for the pure detector.

**Proved able to fail by eight mutations**, each breaking exactly one assertion: terminating on
`hasNextPage`; advancing the cursor before applying; deleting the sensor gate; sizing the drop against
the entered capacity; removing the gap window; filing per adjacent pair instead of per descent; trusting
`hasNextPage` in `feedPageHasData`; and deleting the unknown-capacity guard. ⚠ **That last mutation
initially passed** — the guard was redundant with the gallons floor, so the assertion proved nothing.
The test now drops the floor to isolate the guard. Gates green individually: `pnpm test`, `typecheck`,
`lint`, `build`, and the CI list including `lint:table-writers`, `lint:table-modules`,
`lint:table-producers` (the merge-1 waiver **removed**, as promised), `lint:boundaries`, `lint:upserts`,
`lint:funcsize`, `lint:filesize`.

### S3 · Per-fill telematics becomes a collector tier

**Prerequisites:** none (parallel with S2).

**Build.**
- A sixth tier in `samsaraScheduler.ts` that claims fills with `samsara_recon_status is null` (or a
  stale evidence version), oldest-first, within a rate budget, through the jobs ledger with the existing
  no-overlap guard.
- **D-SAM3:** `skipRecon` enqueues instead of dropping. The bulk rebuild stays fast and stops creating
  permanent holes.
- Reuse `backfillOrg`'s bucketing, `reconHealth` counters and abort-on-systemic-failure. Honour the
  10 req/s cap and `BUCKET_MAX_MS`.

**Done when.** A fill imported today gets telematics whether or not anything scored it, and a fill that
missed its chance is retried rather than abandoned.

**Verified by.** A test asserting `skipRecon: true` leaves an enqueued item; org-scoping via
`expectOrgScoped`.

#### — DONE 2026-09-01 (PR #449, `claude/samsara-recon-tier`)

**What shipped.** A sixth tier, `recon`, in `samsaraScheduler.ts`. Every
`SAMSARA_RECON_SYNC_MINUTES` (60) it dispatches the existing `backfill` kind per org with
`reconBatch: SAMSARA_RECON_BATCH` (250) and `reconRetryAfterHours` (72). `BackfillOpts.reconClaim`
turns that into one bounded, oldest-first claim; `backfillOrg`'s existing bucketing, `reconHealth`
counters and `BACKFILL_ABORT_AFTER` guard carry it, unchanged.

**⚠ D-SAM3 was based on a wrong reading of the code, and the correction makes it SIMPLER.** The
decision says `skipRecon` "stops meaning 'never fetch'. It becomes 'not on this pass — enqueue it'".
That assumed a bulk rebuild writes a terminal marker. It does not: the `skipRecon` branch in
`resolveReconciliation` is empty — *"Rules-only rebuild: stored reconciliation is authoritative"* — so
a skipped fill keeps a **null** `samsara_recon_at`. The hole was never permanent because rows were
marked done; it was permanent because **nothing ever claimed them**. So no second queue was built:
the claim predicate IS the queue, and the rows in it are the backlog. `skipRecon` is untouched.

**⚠ The claim needs two conditions, and finding out why is the substance of this step.**
- `samsara_recon_at is null` alone (10,644 fills) **never clears** for the 32 rows Samsara has no
  history for — they come back `no_data`, keep a null `recon_at`, and claimed oldest-first would be
  re-fetched every single tick while the other 10,612 were never reached. A scheduler that runs hourly
  and makes no progress is worse than none: it looks busy.
- `samsara_recon_checked_at is null` alone would be wrong the other way — **1,087 fills** carry stored
  telematics from before that column existed and would be re-fetched for data we already hold.

  The claim is therefore "needs data **and** not attempted inside the cooldown", which is also exactly
  what makes the Done-when's *retried rather than abandoned* true.

**⚠ `samsara -> anomalies` is deliberately NOT in the boundary allow-list**, so the tier **dispatches**
the `backfill` kind rather than importing `backfillOrg` — `startRebuildOnBoot`'s pattern. A message,
not a dependency, and the layering the plan calls correct (§1.2) stays correct. `dispatchJob` also
supplies the per-org scoring mutex free, so a tick can never overlap a manual rebuild.

**Measured 2026-09-01 (production), and the plan's §0.3 figure reproduces exactly** — unlike the fuel
plan's, which did not: `samsara_recon_status is null` on **10,522** tractor fills, as stated. Beside
it, `samsara_recon_at is null` = 10,644 and `samsara_recon_checked_at is null` = 11,699 of 13,711.
Those three predicates differ by over a thousand rows, which is why the claim names the one it means.

**A number S4 should start from.** At the shipped defaults the tier claims 250 fills an hour, so the
existing 10,644-fill hole drains in roughly **43 ticks ≈ 43 hours of runtime** without anybody running
anything. That does not make S4 unnecessary — S4 still opens with a measurement, and **the wall-clock
of one tick is still NOT measured** — but it changes S4's question from "how do we run a backfill" to
"do we raise `SAMSARA_RECON_BATCH`, and what does one tick actually cost".

**One thing this forced, named because it is a real change to a file it did not set out to touch.**
The tier pushed `startSamsaraScheduler` past the 200-line function budget. `lint:funcsize`'s own
message is "split into an orchestrator + stage helpers", so each tier is now its own function. It was
split WHOLE rather than by evicting the largest tier — squeezing back under leaves the next tier to
hit the same wall with no headroom, the argument `mountApiRouters` in `app.ts` already had to make.

**Verified by:** `the per-fill telematics claim > takes ONE bounded bite, oldest first — a rate budget,
not a target`; `> skips a fill attempted inside the cooldown, and takes one attempted before it`;
`> claims only fills that still have no stored telematics`; `> is org-scoped, like every other
service-role read` (`expectOrgScoped`); `> refuses to be a scoring pass — reconClaim with skipRecon
throws rather than fetching nothing`; and `backfillHandler — the payload decides the sweep > a
scheduled tick claims a BOUNDED batch, never the whole history` plus `> 'Re-check all history' is
still unbounded — the manual button did not change`. Proved able to fail by three mutations: dropping
the cooldown, reversing the claim order, and making a scheduled tick an unbounded sweep. Gates:
`pnpm test`, `typecheck`, `lint`, `build`, and the CI list run individually — `lint:boundaries` and
`lint:funcsize` included, since those are the two this step moves.

**Not verifiable until it is deployed.** The tier's effect is a falling claim count; there is nothing
to observe until the scheduler process runs it. S6 is where that is measured.

### S4 · Close the historical hole

**Prerequisites:** S3. **Opens with a measurement, not a run.**

**Build.**
- First, measure: 10,522 fills across ~195 vehicles, bucketed at ≤96 h and capped at 10 req/s — compute
  the real call count and wall-clock before starting, and write it into this step. §0.5 proves the data
  is *there*; it does not prove the run is cheap.
- Then run it through S3's tier as a bounded, resumable, observable backfill (D-SAM8), oldest-first, with
  the abort guard armed.
- Report coverage per month as it closes.

**Done when.** `samsara_recon_status is null` approaches zero for the period Samsara still serves, and
whatever remains is *reported* per month rather than left as an unexplained gap.

#### — THE OPENING MEASUREMENT, taken 2026-09-02 in production. S4 stays OPEN; this answers what it opens with.

S3 said the wall-clock of one tick was **not** measured and that S4's real question had become "do we
raise `SAMSARA_RECON_BATCH`, and what does one tick actually cost". Both are now measured, from the
`jobs` ledger rather than from a run anybody started.

**The tier has run, and it works.** Two `backfill` ticks, both `done`, both claiming the full batch
(`stats.batch = 250`, `count = 250`).

| | Measured |
|---|---|
| One tick, wall-clock | **112.5 s** and **119.5 s** → ~**0.46 s per fill** |
| Duty cycle at the 60-minute cadence | **~3.2%** — two minutes of every hour |
| Fills reconciled in those two hours | **249** and **244** |
| The same figure BEFORE the tier deployed | **2 and 3 per hour** (the side-effect-of-scoring path) |
| Backlog remaining (`samsara_recon_at is null`, fills with a vehicle) | **10,815** of 14,514 |

**So the answer to S4's question is that runtime is not the constraint — the batch size is.** At 250/h
the hole drains in ~43 hours; at 1,000 it costs ~8 minutes a tick (13% duty) and drains in ~11 hours;
at 2,500, ~19 minutes (32%) and ~4 hours. **The number that decides it is not wall-clock, it is how
much of the Samsara backfill lane we are willing to spend** — see **Q-SAM6**.

**⚠ And check 1 needs qualifying: the history is NOT uniformly available, and the shortfall is at the
oldest edge.** §0.5 sampled 8 vehicles and concluded "the whole gap is recoverable". At full-fleet
scale that holds for recent months and does not for January:

| Fill month | Attempted | `no_data` | Still to do |
|---|---|---|---|
| 2026-01 | 733 | **79 — 10.8%** | 1,299 |
| 2026-02 | 23 | 3 | 1,396 |
| 2026-03 | 0 | — | **2,004** |
| 2026-04 | 0 | — | 1,134 |
| 2026-05 | 272 | **0** | 1,340 |
| 2026-06 | 0 | — | **1,951** |
| 2026-07 | 0 | — | 1,670 |
| 2026-08 | 1,541 | **10 — 0.6%** | 20 |
| 2026-09 | 65 | 1 | 1 |

The oldest-first claim is why January dominates the attempted column, and why the ~13% `no_data` seen
in the raw hourly figures is a **January artifact rather than a fleet rate** — August is 0.6%. This is
exactly the per-month reporting the Done-when asks for, and it means S4 should expect a floor of a few
hundred permanently-unrecoverable January/February fills rather than zero. **"Approaches zero" has to
mean "approaches the reported floor", or S4 can never be marked done honestly.**

#### — THE REPORTING HALF SHIPPED 2026-09-02 (`claude/samsara-telematics-coverage`). S4 stays OPEN on Q-SAM6.

S4's Done-when has two halves. The first — the hole approaching its floor — the S3 tier does on its own
at 250 fills/hour, with no run for anybody to start. The second, *"whatever remains is **reported** per
month rather than left as an unexplained gap"*, was the part that needed building, and it is this.

**What shipped.** `GET /api/integrations/samsara/telematics-coverage` (gate derived from
`rolesThatCanView("settings")`) and a **Telematics history** card on *Settings → Data & sync*, beside
S1's webhook card. `computeTelematicsCoverage` in `@silvicom/shared` is the pure aggregator.

**⚠ ALL-TIME, with no window control, and the route cannot be given one.** This is D-SAM7 made
concrete. The Coverage page computes the same idea over its 90-day window and reads ~95%; across the
whole history it was ~23%, because 76.8% of fills had never been fetched. **Both figures were correct
and one of them was useless** — a coverage figure whose scope hides the gap converts an unanswered
question into a reassuring answer, which is worse than showing nothing.

**Three states, not two, because they need different actions.** *Checked* / *no history at Samsara* /
*to fetch*. Only the last improves by waiting. Blending them is how a transient backlog at the new end
and a permanent vendor gap at the old end get mistaken for each other — and the measurement above shows
they are genuinely different populations (January 10.8% `no_data`, August 0.6%).

The card also prints **where coverage lands** once the backlog clears, extrapolated from the rate the
already-attempted fills came back at, and prints nothing at all when nothing has been attempted — a
ceiling extrapolated from no evidence is a guess dressed as a measurement.

**⚠ A predicate this step had to get right, and a test that initially could not tell.** *Attempted*
means `samsara_recon_at is not null` — the stamp the recon path writes whether or not Samsara had
anything. Judging by `samsara_recon_status` instead calls a stamped row done and never re-queues it.
**124 production rows carry a status with no stamp** (measured 2026-09-02), so the two predicates
genuinely disagree; the first version of the test suite passed under BOTH until a fixture for that case
was added.

**Verified by:** `computeTelematicsCoverage` (9, `packages/shared`) — including `a status with no stamp
is still PENDING — the stamp is what 'we asked' means`, `reports where coverage LANDS if the backlog
resolves at the rate already observed`, `refuses to extrapolate a ceiling from nothing`, and `puts a
December fill in December — the UTC month boundary is not the local one`. `readTelematicsCoverage` (6,
`apps/api`) — `takes no window — nothing in the query bounds fueled_at`, `excludes fills with no truck —
an unmapped fill is a roster problem, not a collection one`, `surfaces a read failure rather than
reporting 0% coverage`, and `is org-scoped` (`expectOrgScoped`). `DataSyncPage` (10, `apps/web`).

**Proved able to fail by eight mutations**, each breaking exactly one assertion: windowing the read to
90 days; counting unmapped fills; swallowing the read error; judging attempts by status rather than the
stamp; extrapolating a ceiling with no evidence; showing the landing figure with no backlog; hiding the
truncation warning; swallowing the card's error. ⚠ **Two of these initially passed** — the
status-vs-stamp one for want of a discriminating fixture, as above.

**One thing this broke and fixed properly.** `DataSyncPage.test.ts` answered *every* `apiFetch` with the
webhook payload, so a second card on the page silently received the wrong shape and took the whole page
down — four existing assertions failed for a reason none of them was about. The fake now dispatches on
the path.

**What remains for S4:** Q-SAM6 (the batch size), and then watching the number this card now prints
reach its floor. `lint:ui-adoption` also rejected a hand-written `<table>` here and was right to —
the card renders through `DataTable`.

### S5 · Freshness becomes a number with a threshold

**Prerequisites:** S2, S3. **Needs Q-SAM1 answered** for the targets; ships the mechanism regardless,
with defaults stated as provisional.

**Build.**
- A per-feed staleness figure — last successful run, last cursor advance, oldest unreconciled fill —
  from the `jobs` ledger and the new cursor table.
- A threshold per feed, and an alert when it is breached, through the existing notification path.
- Surface it: the integration settings page, and a one-line strip on the surfaces that depend on it,
  above the figures rather than below them (the IFTA health-gate pattern).
- **D-SAM7:** the Dashboard coverage tile gains an all-time denominator beside the windowed one.

**Done when.** "Is our data fresh?" is answerable by looking, and a stalled feed pages somebody instead
of quietly degrading every number downstream.

### S6 · Retrain, re-score, and measure whether it moved the needle

**Prerequisites:** S4.

**Build.** With history present, re-run the capacity and sensor-reliability learners and re-score. Then
**measure**: `tank_sensor_reliable` count, entered-vs-learned capacity disagreements,
`cumulative_overfuel` fires, and the confirmed/false-positive ratio — before and after, in this document.

**Done when.** The before/after is written down. **This step is allowed to conclude the backfill did not
help**, and if so that is the finding, recorded here, not a reason to run it again.

---

## 6. Open questions

| Id | Question | Owner | Fallback until answered |
|---|---|---|---|
| **Q-SAM1** | ~~**What staleness is acceptable, per feed?**~~ **ANSWERED 2026-09-05 (owner ruling): adopt the proposal.** stats/telematics **1 h**, identity **24 h**, driver-scores **12 h**, IFTA **48 h** — real bounds, not provisional ones, so a breach of any of the four may alert. ⚠ **The ruling names four feeds and the collector runs eight.** Odometer, HOS and idle take a bound DERIVED from the cadence they already promise (`FEED_LATE_AFTER_PASSES`, the answer this repo already gave for the EFS pollers), are shown so nothing is unmonitored, and **never alert** — which is this row's own fallback sentence kept rather than discarded. `targetSource` carries the difference onto the wire and onto the screen. | Miki | ~~open~~ Answered. |
| **Q-SAM2** | **Do we handle the five `RouteStop*` events or unsubscribe them?** They imply a dispatch/ETA feature nobody has asked for. Handling them is real work; leaving them is a permanent 404 generator against our own endpoint. | Miki | Unsubscribe. An event type with no handler is not a feature. |
| **Q-SAM3** | **What is the `Fleetpal Webhook` on this account, and is it ours to touch?** It receives `VehicleCreated`/`VehicleUpdated`/`DvirSubmitted` at a third-party URL. `ARCHITECTURE.md` names a future `fleetpal` collector, so this may be a live integration outside this codebase. | Miki | Left strictly alone. Nothing in this plan modifies a webhook we did not create. |
| **Q-SAM4** | **Is the webhook pointed at the right Railway service?** It targets `fleetguardweb-production`, while `railway.json` names `fleetguardapi` as the WEX-whitelisted service that runs the pollers. Both serve the API, so the path fix may be sufficient — but which service should own inbound webhooks is a deployment decision. | Miki | S1 fixes the path on the service already configured and changes no deployment topology. |
| **Q-SAM6** | **NEW, 2026-09-02, raised by S4's opening measurement.** **How much of the Samsara backfill lane may the recon tier spend?** One tick costs 112–120 s for 250 fills — **3.2% of its hour** — so the 43-hour drain is a `SAMSARA_RECON_BATCH` choice, not a runtime limit. **1,000** costs ~8 min/tick (13% duty) and drains in ~11 h; **2,500** costs ~19 min (32%) and drains in ~4 h. What it trades against is the live lane: the backfill priority gets `1 − SAMSARA_LIVE_RPS_FRACTION` of `SAMSARA_MAX_RPS`, and the measured 2.2 fills/s is well inside it, so the ceiling is a policy about vendor load and shared pacing rather than a technical one. **Recommendation: 1,000.** It clears the hole inside a working day, keeps the tier under one sixth of its window so a slow tick cannot overrun the next, and leaves the live lane the majority share it was given on purpose. | Miki | Stays at 250. The hole still closes — in ~43 hours rather than ~11 — and nothing is at risk, so this is a speed decision and not a correctness one. |
| **Q-SAM5** | **NEW, 2026-09-01, raised by S2 merge 1.** **Where does an intermediate sample go?** S2's Done-when asks that "a value that changes twice between two polls produces two records rather than one", but the stats tier's only sink is `vehicles.current_odometer` / `samsara_fuel_percent` — one current value per truck, last-sample-wins. **The feed's completeness is real and lands nowhere.** Three candidates: **(a)** file the intermediate *fuel-level drops* into `fuel_events`, whose `fuel_pct_before` / `fuel_pct_after` columns have sat unused since 0021 and were plainly designed for exactly this, gated on the learned-reliable sensor the way `ruleEligible` already gates `tank_fill_short`, and sized against `resolveCapacity` rather than a new blanket threshold; **(b)** a general per-vehicle telematics sample store — honest but expensive, ~195 vehicles at telematics ping rates, and it duplicates what `stats/history` already serves S4; **(c)** accept that the cursor buys *guaranteed delivery of the latest value* and nothing more, and strike the Done-when. **Recommendation: (a).** It is the only one that makes the Done-when literally true, it reuses two learners the product already paid for instead of inventing a threshold, and it is D-SAM2's own words — the cursor feed sitting *underneath* the webhook as the reconciler that makes completeness a property rather than a hope. ⚠ Note `fuel_events` is operator-facing: it renders on `/fuel-events` and is counted as "Siphoning" in the weekly digest, so (a) must **not** reuse the webhook's `notifyFuelDrop` path, and its suppressed-by-gate count must be reported into the `jobs` ledger so S6 can measure what the gate cost. | Miki | ~~open~~ **ANSWERED 2026-09-01: (a).** Merge 2 ships the cursor, the endpoint swap, and the feed-derived `fuel_events` sink under the reliability gate. |
| **Q-SAM7** | **NEW, 2026-09-05, raised by S5 merge 2.** **The surfaces S5 wants to annotate are ungated; the data it would annotate them with is `settings`-gated.** S5's third and fourth bullets are a one-line freshness strip on the surfaces that depend on a feed, and D-SAM7's all-time denominator on the Dashboard coverage tile. Both are blocked by the same fact, measured rather than assumed: `/` (Dashboard) and `/coverage` carry `meta: { requiresAuth: true }` and **no section gate at all** — any authenticated org member, a `driver` included — while `GET /api/integrations/samsara/feed-freshness` and `/telematics-coverage` are `requireSection("settings", "view")`. The Dashboard also reads Supabase DIRECTLY under RLS and computes `coveragePct` in `aggregateDashboard`; it calls no API for this at all, so adding one introduces a gate where there is none. Candidates: **(a)** a narrow `requireOrg` freshness read carrying only each feed's id, label, state, age and bound — **no `lastError`** (a vendor error string can carry account identifiers) and no job internals — with the full card staying `settings: view` (**recommended**: it is the shape this repo already chose for Q-FUI15, where refusing a list while printing its contents protected nothing, and collector health is operational metadata rather than money or PII); **(b)** widen `/telematics-coverage` and `/feed-freshness` to the Dashboard's audience wholesale, which also exposes vendor error text; **(c)** compute the all-time coverage in the browser from two `count` queries — **rejected**: S4 spent real effort getting the three-state predicate right (*attempted* is the STAMP, not the status, and 124 production rows disagree), and a second implementation of it is a second source of truth with a delay fuse. | Miki | **The strips and D-SAM7 do not ship.** The alarm and the settings card stand on their own, and no figure is placed on a page because a permission check happened to pass. |

---

## 7. What this plan deliberately does not do

- **It does not re-architect the collector/harness seam.** §1.2 — it is already correct. This plan adds
  a scheduler tier and a cursor.
- **It does not convert identity, IFTA or driver-scores to delta feeds.** D-SAM5, on the §1.4 argument.
- **It does not promise "always fresh".** §1.1 — it promises guaranteed completeness and a measured,
  stated staleness bound, which is the achievable version of the request.
- **It does not touch the anomaly rules.** The capacity gate and the odometer cluster are
  `FUEL-SECTION-CONSOLIDATION-PLAN.md` Q-FUI11's business. This plan supplies the data those rules were
  always supposed to have; S6 measures whether that was enough.
- **It does not modify a webhook it did not create.** Q-SAM3.
- **It does not pin migration numbers.** Next-numbered at execution.

#### — S5 MERGE 1 of 2 SHIPPED 2026-09-05 (`claude/samsara-s5-feed-freshness`). S5 stays OPEN for the alarm.

S5 has four bullets and they split cleanly along one seam: the first three sentences of the Done-when
are *"is our data fresh?" is answerable by looking*, and the last is *a stalled feed pages somebody*.
Merge 1 is the first. Nothing in it needs a migration; merge 2 does, and the reason is below.

**Q-SAM1 was answered as ruled, and the ruling covers half the collector.** stats/telematics 1 h,
identity 24 h, driver-scores 12 h, IFTA 48 h. The collector runs **eight** feeds, not four — odometer,
HOS and idle are real tiers with real consumers and the ruling does not name them. Inventing numbers
for them would be exactly what this row's own fallback forbids, so they take a bound derived from the
cadence they already promise, reusing `FEED_LATE_AFTER_PASSES` — the answer this repo already gave to
this question for the EFS pollers, where the argument is written out. **A derived bound is shown and
never alerts.** `targetSource` is `ruling` or `cadence`, it travels to the browser, and the card says
which the reader is looking at.

Worth writing down rather than leaving as a coincidence: **the ruled numbers and the derived rule
agree.** Identity, driver-scores and IFTA are each exactly 2× their configured interval and stats is
3×, which is the band `FEED_LATE_AFTER_PASSES` produces. They are still kept apart, because one is a
decision somebody made and the other is arithmetic, and only the first may wake a person.

**⚠ A ruled bound is ABSOLUTE and a cadence is an environment variable, so they can contradict.** Raise
`SAMSARA_STATS_SYNC_MINUTES` past 60 and the ruled 1-hour bound is breached the moment it is met — a
feed working exactly as configured, permanently red, which is how an alert becomes wallpaper.
`targetUnreachable` is computed and surfaced, and suppresses the alert. It does **not** silently move
the owner's number: the bound stays what was ruled and the product says the two settings disagree.

**Three stamps, and each one could have reported a dead feed as healthy.**

1. `runOrgTier` records `NoSamsaraTokenError` as **done** with `stats = { skipped: "no token" }` — right
   for the ledger, fatal for this. An org with no token would show every feed as freshly delivered
   forever: the `*_last_polled_at` trap `fuelSpend/feedFreshness.ts` documents, in a second ledger. A
   skipped run is excluded from the success stamp and still counts as an attempt, which is what
   separates *never configured* from *configured and delivering nothing*.
2. The error is taken from the **most recent run**, not the most recent failure. A tier that failed on
   Tuesday and has succeeded hourly since is not failing — and, measured below, that is the normal
   state of three of these feeds. It is also read only when that run's status is `failed`: the worker
   records an attempt's error and leaves the row queued for a retry, so reading the column alone
   reports a tier that is mid-retry, with a fresh delivery behind it, as broken.
3. **The per-fill tier is not measured by its job rows.** The recon tier dispatches the `backfill`
   kind, which `startRebuildOnBoot` and manual rebuilds also use, so a `backfill` row proves nothing
   about telematics. `fuel_transactions.samsara_recon_checked_at` is the stamp the recon path itself
   writes — the same predicate S4's coverage card judges attempts by, so the two surfaces cannot
   disagree about whether we asked.

**Measured on production, 2026-09-05 20:27 UTC.** All eight feeds healthy: latest run `done` or
`running` for every kind, no error on any, and the newest `samsara_recon_checked_at` three minutes old.
So the card's first reading is 8/8, which is true.

**But the history says something the card does not, and that is a deliberate limit.** Over all runs
this org holds: `sync_idle` **268 failed against 486 done (36%)**, `sync_ifta` **181 against 400
(31%)**, `sync_vehicles` 56 against 865, `sync_hos` 74 against 760, `sync_stats` 21 against 8,472.
A feed that fails a third of its runs and succeeds on the retry is *fresh* by this card's definition
and by the plan's — freshness is a bound on staleness, and it is being met. **A failure RATE is a
different question and this card does not answer it.** Naming it here rather than widening S5 on the
spot: it is a candidate step, not a defect in this one.

**What merge 2 holds, and why it needs a migration.** The alarm cannot be stateless. A stale feed is
stale on every tick, so alerting from the scheduler would email the carrier hourly until somebody
fixed it — which is how a warning becomes wallpaper, the same failure `targetUnreachable` exists to
prevent one level down. It needs a per-org, per-feed record of what was last notified and when, so a
breach pages once on transition and recovers quietly. That is a table. Merge 2 also carries the
one-line strips on the surfaces that depend on a feed (`worstSamsaraFeed` is built and exported for
exactly that, and is unused today), and D-SAM7's all-time denominator on the Dashboard tile.

**Verified by.** `feedHealth` (18, `packages/shared`) — including `does not let a bare attempt stand in
for a delivery`, `never alerts on a cadence-derived one, however far past it`, `is reported as
unreachable rather than paging every hour forever`, and `does not silently move the owner's number —
the bound stays what was ruled`. `readSamsaraFeedHealth` (13, `apps/api`) — including `does not count a
run that skipped for want of a token as a delivery`, `judges the per-fill tier by the stamp the recon
path writes, not by a job row`, `does not call a feed failing while a retry is still queued`, and
`scopes every query it makes to one organization` (`expectOrgScoped`). `FeedFreshnessCard` (8,
`apps/web`).

**Proved able to fail by fifteen mutations**, each breaking exactly one assertion. ⚠ **Three initially
passed and the fixtures were wrong, not the code** — the same lesson as S4's status-vs-stamp case, and
it is now three for three across two steps:
- *the attempt stamp standing in for the success stamp* — every fixture had a success, so the fallback
  never ran. It also exposed an overclaim: a tier that has run and delivered nothing with **no error
  recorded** was being described as "refused by Samsara", which is a claim about the vendor that only
  the error text supports, and would send somebody to check a token that is fine.
- *absorbing a refused read* — one fixture failed BOTH job queries, so the second guard hid a missing
  first one. The fixture now fails each read independently.
- *the recon-batch guard* — a malformed mutation, re-run properly.

**⚠ One CI failure this step earned, and the reason is worth keeping.** `apps/api/src/testing/envCasts.test.ts`
bans `as unknown as Env` in fixtures — a cast hands the code under test an object missing every key it
did not mention, a shape `loadEnv` can never return. The fixture here did exactly that and `pnpm test`
passed locally anyway, because **that gate enumerates its inputs with `git ls-files`** and the new test
file was still untracked. A full green suite before `git add` is not a full green suite. The fixture is
now `testEnv()`, which parses the schema as the process does — so the cadence assertions test the
deployment's real defaults rather than a fixture's opinion of them.

#### — S5 MERGE 2 of 2 SHIPPED 2026-09-05 (`claude/samsara-s5-feed-alarm`). **S5's Done-when is met; two bullets are blocked and recorded as Q-SAM7.**

The second half of the Done-when — *a stalled feed pages somebody instead of quietly degrading every
number downstream*. Migration `0321`, a pure decision in shared, and a scheduler tier.

**The alarm's hard problem is not detection, it is repetition.** `describeSamsaraFeeds` already says
which feeds are breached. Mailing that list every evaluation reports a standing outage once per tick
until somebody fixes it, and a carrier who gets the same email forty times stops reading the
forty-first — the same failure `targetUnreachable` prevents one level down. So the alarm has a memory,
and remembering is a table.

**The cooldown is the feed's own target, which is not a number chosen here.** "How often may we speak
about this feed?" already has an answer in the data: no more often than the bound it is held to. A feed
allowed to be an hour late may be discussed hourly; one held to 48 hours may not. Q-SAM1's fallback
applies to the alarm's cadence as much as to its thresholds.

**⚠ A recovery does NOT delete the memory row, and the reason is measured.** Deleting was the first
design. A `late` feed guards its own flapping — going late again takes a whole target window with no
delivery — but a `failing` one cannot, because `failing` comes from the most recent run's error. On
production this org has `sync_idle` at **268 failed runs against 486 done** and `sync_ifta` at **181
against 400**: a tier that fails, succeeds and fails again would email on every raise if the memory of
the last one had been thrown away. So a recovery sets `cleared_at` and the row — and therefore
`notified_at` — survives.

**Two ordering rules, both of which would be silent if broken.** The mail goes out BEFORE the memory
row is written: recording first and failing to send marks a carrier as notified about an outage they
were never told about, and because the memory is what suppresses the next evaluation, that silence
would then be permanent. And a MUTED carrier — notifications off, or no address — is recorded as
nothing at all, so the outage still reaches them the day they switch notifications back on.

**⚠ `makeSender` RETURNS false; it does not throw.** `sendEmail` catches its own transport errors and
reports `{ ok: false }`. The first version of this file wrapped the send in `try`/`catch` and would
have sailed straight past a refused send into writing the memory row — the exact failure the paragraph
above forbids, introduced by the code meant to honour it. Found by reading `lib/mailer.ts` rather than
assuming its contract. The boolean is now the guard, and `remembers nothing it could not send` pins it.

**It is a tier, not a job kind.** Every collecting tier runs through `runOrgTier` for the (org, kind)
mutex and the failure record. This one collects nothing — it reads the ledgers the others write.
Giving it a job kind would put its own rows into the very ledger it reads and buy nothing: the
duplicate-suppression it needs is the memory table, not a mutex, and `startTier`'s re-entrancy guard
covers the overlap. Its interval is the SHORTEST configured cadence, clamped to [1 min, 1 h] —
checking more often than the fastest feed polls cannot find anything new, and a cap above an hour
would delay a one-hour bound's alert by as much as the bound itself. **No new scheduler process, so
`docs/WORKER-DEPLOYMENT.md` is unchanged.**

**⚠ WHAT THIS MERGE DOES NOT SHIP, AND WHY — the S5 bullets 3 and 4 are BLOCKED, not skipped.**
`worstSamsaraFeed` was built and exported in merge 1 for the strips and is still unused. Measured
today: `/` (Dashboard) and `/coverage` carry `meta: { requiresAuth: true }` and **no section gate at
all**, while both freshness routes are `requireSection("settings", "view")` — and the Dashboard reads
Supabase directly under RLS, computing `coveragePct` in `aggregateDashboard` without calling an API at
all. Annotating those pages therefore means either widening a route to suit a screen or implementing
S4's three-state predicate a second time in the browser. Both are the shape this repo calls a
workaround, so neither was done: the question is **Q-SAM7**, with candidates and a recommendation.

**Verified by.** `feedAlerts` (14, `packages/shared`) — including `says nothing on the next evaluation,
and the one after that`, `measures that window against THIS feed's bound, not a number chosen for all
of them`, `holds a raise that follows a recovery too closely — the flap this table exists for`, and
`does not announce the same recovery twice, even long after the cooldown has passed`.
`runSamsaraFeedAlarm` (11, `apps/api`) — including `remembers nothing it could not send, so a refused
mail is retried rather than swallowed`, `stays quiet for a carrier with notifications off — and
remembers nothing`, `sends ONE message when several feeds break at once, not one each`, and `scopes
every query it makes to one organization`.

**Proved able to fail by eleven mutations.** ⚠ **Two initially passed and the fixtures were wrong** —
five for five across S4 and S5 now, which is worth treating as the default expectation rather than a
surprise:
- *announcing the same recovery twice* — the cleared row was dated an hour back, so the COOLDOWN held
  the second mail and `cleared_at` was never read. The fixture is now dated well past the feed's bound.
- *a muted carrier reported as notified* — the mutation changed only the returned `sent` list, which is
  what the scheduler LOGS. Harmless to the database and a lie in the one place somebody looks during
  an incident, so it is now asserted.
