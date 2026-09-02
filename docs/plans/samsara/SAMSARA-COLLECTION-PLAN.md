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
| S5 | **verified as shape** | The staleness inputs exist (`jobs` ledger, `samsara_recon_status`, `updated_at`). The per-feed targets are Q-SAM1 and are the owner's to set. |
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
| **Q-SAM1** | **What staleness is acceptable, per feed?** Fuel-theft detection tolerates an hour; a dispatcher looking at a live map does not. A single global target over-polls most feeds and under-serves one. Proposal to react to: stats/telematics **1 h**, identity **24 h**, driver-scores **12 h**, IFTA **48 h**. | Miki | S5 ships the mechanism with those numbers marked provisional in the code comment. No alert fires on a guessed threshold. |
| **Q-SAM2** | **Do we handle the five `RouteStop*` events or unsubscribe them?** They imply a dispatch/ETA feature nobody has asked for. Handling them is real work; leaving them is a permanent 404 generator against our own endpoint. | Miki | Unsubscribe. An event type with no handler is not a feature. |
| **Q-SAM3** | **What is the `Fleetpal Webhook` on this account, and is it ours to touch?** It receives `VehicleCreated`/`VehicleUpdated`/`DvirSubmitted` at a third-party URL. `ARCHITECTURE.md` names a future `fleetpal` collector, so this may be a live integration outside this codebase. | Miki | Left strictly alone. Nothing in this plan modifies a webhook we did not create. |
| **Q-SAM4** | **Is the webhook pointed at the right Railway service?** It targets `fleetguardweb-production`, while `railway.json` names `fleetguardapi` as the WEX-whitelisted service that runs the pollers. Both serve the API, so the path fix may be sufficient — but which service should own inbound webhooks is a deployment decision. | Miki | S1 fixes the path on the service already configured and changes no deployment topology. |
| **Q-SAM6** | **NEW, 2026-09-02, raised by S4's opening measurement.** **How much of the Samsara backfill lane may the recon tier spend?** One tick costs 112–120 s for 250 fills — **3.2% of its hour** — so the 43-hour drain is a `SAMSARA_RECON_BATCH` choice, not a runtime limit. **1,000** costs ~8 min/tick (13% duty) and drains in ~11 h; **2,500** costs ~19 min (32%) and drains in ~4 h. What it trades against is the live lane: the backfill priority gets `1 − SAMSARA_LIVE_RPS_FRACTION` of `SAMSARA_MAX_RPS`, and the measured 2.2 fills/s is well inside it, so the ceiling is a policy about vendor load and shared pacing rather than a technical one. **Recommendation: 1,000.** It clears the hole inside a working day, keeps the tier under one sixth of its window so a slow tick cannot overrun the next, and leaves the live lane the majority share it was given on purpose. | Miki | Stays at 250. The hole still closes — in ~43 hours rather than ~11 — and nothing is at risk, so this is a speed decision and not a correctness one. |
| **Q-SAM5** | **NEW, 2026-09-01, raised by S2 merge 1.** **Where does an intermediate sample go?** S2's Done-when asks that "a value that changes twice between two polls produces two records rather than one", but the stats tier's only sink is `vehicles.current_odometer` / `samsara_fuel_percent` — one current value per truck, last-sample-wins. **The feed's completeness is real and lands nowhere.** Three candidates: **(a)** file the intermediate *fuel-level drops* into `fuel_events`, whose `fuel_pct_before` / `fuel_pct_after` columns have sat unused since 0021 and were plainly designed for exactly this, gated on the learned-reliable sensor the way `ruleEligible` already gates `tank_fill_short`, and sized against `resolveCapacity` rather than a new blanket threshold; **(b)** a general per-vehicle telematics sample store — honest but expensive, ~195 vehicles at telematics ping rates, and it duplicates what `stats/history` already serves S4; **(c)** accept that the cursor buys *guaranteed delivery of the latest value* and nothing more, and strike the Done-when. **Recommendation: (a).** It is the only one that makes the Done-when literally true, it reuses two learners the product already paid for instead of inventing a threshold, and it is D-SAM2's own words — the cursor feed sitting *underneath* the webhook as the reconciler that makes completeness a property rather than a hope. ⚠ Note `fuel_events` is operator-facing: it renders on `/fuel-events` and is counted as "Siphoning" in the weekly digest, so (a) must **not** reuse the webhook's `notifyFuelDrop` path, and its suppressed-by-gate count must be reported into the `jobs` ledger so S6 can measure what the gate cost. | Miki | ~~open~~ **ANSWERED 2026-09-01: (a).** Merge 2 ships the cursor, the endpoint swap, and the feed-derived `fuel_events` sink under the reliability gate. |

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
