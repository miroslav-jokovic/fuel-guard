# Live map at 20–30 dispatchers — measured, 2026-09-17

**Owner's ask, 2026-09-17:** the freeze is no longer seen (item 3 closes as *not reproduced on
today's deploy*), but the board must hold up "enterprise grade" when **20–30 dispatchers use it at
the same time", and the remaining live-map work needs listing.

This document is the measurement and the queue. Decisions land at the end of `LIVE-MAP-PLAN.md` as
usual; nothing here is built yet.

---

## 0. The headline, in one line

**The application is not the problem — the rate limiter is.** At 30 concurrent dispatchers the API
serves the board in **59.8 ms p50 / 68.7 ms p95** with an event loop that never stalls, and it is
still flat at **100** concurrent. But every dispatcher in one office shares one public IP, and the
global `/api` limiter allows **600 requests per IP per 15 minutes** — so a 5-second poll means the
whole office is **hard-refused with 429 after 100 seconds**, measured, and stays refused for the
remaining ~13 minutes of the window.

That is not lag. It is the map going blank for everyone at once, and nothing in the product explains
why.

---

## 1. How this was measured

A load rig drove the **real Express app** — real middleware, the real limiter, the real supabase-js
client, real JSON serialisation — against a stand-in Supabase answering PostgREST reads and RPCs
after a configurable delay. Only the database was faked, and it was faked *with latency* rather than
instantly, because the thing under test is round trips under concurrency.

- Fleet fixture: **171 trucks**, the number the board actually draws on production.
- Poll cadence: **5 000 ms**, read from `LIVE_MAP_POLL_MS` rather than chosen.
- Virtual dispatchers are started staggered across the poll window — a real office does not open the
  board on the same tick, and a synchronised herd would have measured a burst instead of a steady state.
- `trust proxy` is `1`, so the rig sets `X-Forwarded-For` per user. That is the only difference
  between the two scenarios, and it is the whole question.

⚠ The DB cost was checked separately against production rather than assumed: the positions query
plans and runs in **0.749 ms execution, 1.154 ms planning**. **Postgres is nowhere near the
bottleneck at this fleet size** — this is a round-trip and middleware story, not a query story.

---

## 2. What was measured

| scenario | users | served | refused | p50 | p95 | p99 | loop lag (worst) |
|---|---|---|---|---|---|---|---|
| **one office IP**, 120 s | 30 | 600 | **149 × 429** | 58.7 ms | 67.3 ms | 72.3 ms | 2.4 ms |
| separate IPs, 120 s | 30 | 748 | 0 | 59.8 ms | 68.7 ms | 73.6 ms | 21.5 ms |
| separate IPs, 60 s | **100** | 1 295 | 0 | 55.3 ms | 63.7 ms | 66.7 ms | 3.0 ms |
| separate IPs, slower DB (30 ms RTT) | 30 | — | 0 | **170.3 ms** | 194.1 ms | 201.2 ms | — |

**First refusal at 100.1 seconds**, against a predicted 100.0 — the model and the measurement agree
to a tenth of a second, which is what makes the arithmetic in §3 safe to quote.

### The four facts behind those numbers

1. **Five upstream round trips per poll, sequential.** `org_module_enabled` (RPC), `vehicle_positions`,
   `vehicles`, `drivers`, `loads`. Latency is therefore ~`5 × RTT` plus overhead, which is why a
   30 ms database turns a 59 ms board into a 170 ms one. The board's own comment says the three
   reads are sequential *on purpose* (a rejection in flight leaves two queries orphaned against a
   shared pool) — that is a documented decision, not an oversight, and §4 treats it as one.
2. **68.4 KB per poll, uncompressed.** There is **no compression middleware in the API at all**. A
   representative board of this shape gzips **93% smaller** (77.7 → 5.7 KB modelled). At 30 users
   that is **27.3 MB/min of egress instead of 2.0**.
3. **No caching or coalescing.** Thirty dispatchers in one org receive thirty *identical* boards
   every five seconds, each costing its own five round trips — **150 Supabase round trips per second
   to answer one question**.
4. **One instance.** `railway.json` declares no replica count, so each service is a single Node
   process. That is fine at these numbers (the loop never stalled) but it is also the entire
   failure domain.

---

## 3. The limiter arithmetic, and why it bites far below 30

`apiLimiter` is `windowMs: 15 min, limit: 600`, keyed by IP (express-rate-limit's default), mounted
`app.use("/api", …)`. One dispatcher with the board open spends **900 s ÷ 5 s = 180 requests per 15
minutes on polling alone**.

| dispatchers on one office IP | board polls / 15 min | vs 600 |
|---|---|---|
| 1 | 180 | fine |
| 2 | 360 | fine |
| 3 | 540 | **90% of the budget** |
| 4 | 720 | **refused** |
| 30 | 5 400 | refused after 100 s |

⚠ **And tiles come out of the same budget.** `/api/fueling/map-tiles/:z/:x/:y` is under `/api`, so
every basemap tile counts against the same 600. A first viewport is dozens of tiles, and panning or
switching basemap costs more. **The practical ceiling today is about three dispatchers per office
address, before anyone touches the map.**

This is also why the owner has not seen it yet: it needs several people on the board *at once, from
one address*, which is exactly the situation being planned for and not the one being run today.

---

## 4. The queue — ordered by measured impact

### C1 · Key the limiter by user, not by address — **the only one that is a defect**
Everything else here is an optimisation; this is legitimate traffic being refused. Authenticated
routes should count against the **caller**, not the address they share with their colleagues. The
repo already has the pattern: `fuelCardVendorRateLimitKey` is a custom `keyGenerator` with its own
matrix test (`vendorRateLimit.test.ts` pins "two orgs / one IP" and "one org / two IPs" — the exact
shape of this bug). Keep an IP-keyed cap for *unauthenticated* routes, where address is the only
identity there is.
**Done when:** thirty dispatchers on one address poll for a full 15-minute window with zero 429s,
and a single abusive token is still capped.

### C2 · Compress API responses — 93% off the board, one middleware
No compression exists today. This is the cheapest large win available and it helps every JSON route,
not just the map. ⚠ Decide the BREACH posture explicitly rather than by default: compressing
authenticated responses is standard practice, but it should be a recorded decision.
**Done when:** the board is served `content-encoding: gzip` and measures ≤ 10 KB.

### C3 · Coalesce the board per org — 150 round trips/sec become ~1
A short server-side TTL (2–3 s, strictly under the 5 s poll) keyed by org, plus in-flight request
coalescing so N simultaneous pollers share one upstream read. The data is a 5-second snapshot
already; serving two dispatchers the same 2-second-old board is not a correctness change.
⚠ Must be **org-keyed and org-scoped** — the API reads with the service role, which bypasses RLS, so
a cache keyed carelessly is a cross-tenant leak. This needs `expectOrgScoped` coverage like any
other service read.
**Done when:** 30 dispatchers in one org produce ~1 upstream read per 5 s, and a matrix proves two
orgs never share an entry.

### C4 · An ETag / `304` on the board
With C3 in place the board is already a shared snapshot; an ETag lets an unchanged board cost a
header instead of 68 KB. Compounds with C2 rather than replacing it.

### C5 · B3 — tile coalescing, and what it does to `Q-LM21`
`Q-LM21` recorded that B3's gate could not be opened because **the API logs no requests at all**, so
the storm could not be counted. The owner's 20–30 number changes the picture: at that concurrency the
tile path is both a quota cost *and* a consumer of the C1 budget. The money question is still HERE's,
so the recommendation stands — **read HERE's own quota console** — but B3 is now much more likely to
be worth building.

### C6 · Revisit the five sequential round trips — **with a measurement, not by reflex**
Three of the five (`vehicle_positions`, `vehicles`, `drivers`) are independent. Running them
concurrently would cut a 30 ms-RTT board from ~170 ms to ~70 ms. **But the sequential order is a
documented decision** (an orphaned query against a shared pool on rejection), so this is a decision
to revisit in the open, not a line to change quietly. C3 may make it moot — a coalesced board runs
these five trips once per org per 5 s rather than once per dispatcher.

### C7 · Request observability — the enterprise gap
Measured on 2026-09-17: **no `morgan`, `pino`, `winston`, no hand-rolled middleware, no logging
dependency**, so both Railway services return zero log lines for any route. There is no p95, no
request rate, no 429 count. Running 20–30 concurrent users with no request visibility means the next
incident is diagnosed the way this one nearly was — by arithmetic and a local rig. ⚠ Whatever ships
must not log PII (the repo's own rule) and must not cost a log line per tile.

### C8 · Horizontal headroom on Railway
No replica count is declared. Not needed at 30 users on today's evidence, but it is the single
failure domain, and **`RUN_SCHEDULERS_IN_PROCESS` defaults to true** — so adding a replica without
setting it `false` would run the scheduler set twice. `docs/WORKER-DEPLOYMENT.md` governs; this is
not a box to tick casually.

---

## 5. The live-map feature work still outstanding

Separate from performance. Status per `LIVE-MAP-PLAN.md` §5 and the dated log.

| step | what | state |
|---|---|---|
| **LM11** | Link McLeod dispatchers to Silvicom users (a card on the existing Integrations → McLeod page) | **blocked** — `tms_dispatchers` does not exist in production |
| **LM12** | Turn the loads feed on in production — runbook, no new code | **next**; being progressed separately (`LOADS-GO-LIVE-PLAN.md`) |
| **LM3** | Ingest writes `dispatcher_external_id` | follows LM2's migration by one merge |
| **LM-F2** | Make the cost boundary real in the database | scoped, not scheduled |
| **B4** | `webglcontextlost` handling in `useMapLibre.ts` | **now unlikely to be needed** — it was gated on item 3 pointing at the map, and item 3 is not reproduced. A lost context still leaves a dead canvas silently, so it remains cheap insurance rather than a fix |

⚠ **Until LM11 and LM12 land, `scope` is `all` forever and every truck card reads "No load on this
truck"** — `loads`/`load_stops` are 0 rows in production. The rail foot already knows how to say
"assigned to you" the day that changes. This is the biggest *functional* gap on the surface, and it
is a McLeod grant, not code.

---

## 6. Recommended order

**C1 → C2 → C3**, then re-measure before anything else. C1 is a live defect; C2 is one middleware
for 93%; C3 removes the load rather than absorbing it. On today's evidence C6 and C8 are not needed
at 30 users, and C5 waits on HERE's quota page.

⚠ **Re-run the rig after each, not at the end.** The 30-user office scenario is the one that fails
today, and it is a two-minute test.
