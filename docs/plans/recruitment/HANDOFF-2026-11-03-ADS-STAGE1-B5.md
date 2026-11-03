# Handoff · 2026-11-03 · Ads agent, Stage 1 from step B5 (the monitor)

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-03-ADS-STAGE1-B4B.md`. That
handoff's §4 traps, the D0 handoff's §4, the B2 handoff's §4–§5 (traps, process) and the 11/01 handoff's §1
(owner rulings, not to be re-asked) **still hold**. This file replaces the B4b handoff's §1 position, §3 step
and §6 first action. Stage 1 = agents + orchestrator proven against fakes, **no social-network or Higgsfield
credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. `ADS-AGENT-BUILD-WORKFLOW.md`: the **B5 row** (§4, line ~212: hourly insights → `ads_spend_hourly`, daily
   reconcile, `external_change`, our auto-pause rules, fatigue from Meta delivery flags; done-when "forced
   overspend → pause + alert; an Ads-Manager edit → `external_change`"), §4R's **Monitor** row (L2 faults:
   insights late, missing hours, numbers revised DOWN by the platform, an Ads-Manager edit, 30 simulated days
   with fatigue/overspend/zero-lead spend; L3 bar: each rule fires exactly at its threshold and minimum spend,
   never on a learning-phase ad set except caps; reconcile flags every planted mismatch and nothing else), and
   the **progress log at the end** (the 2026-11-03 audit-fix entries and B4b are the newest).
3. What B5 plugs into (read before writing it):
   - `supabase/migrations/0537_ads_foundation.sql` — `ads_spend_hourly` (PK `(campaign_id, hour)`, hour on the
     UTC hour, cents, `pulled_at`; raw-layer waiver at line ~76), and the alert categories (`ads_overspend`,
     `ads_no_leads`, `ads_external_change`, … ; `0559` added `ads_pause_failed`).
   - `apps/api/src/modules/ads/guard/budgetGuard.ts:~181` — the guard ALREADY READS `ads_spend_hourly` for
     month-to-date, and since audit H4 also reads Meta's own account spend (`fakeMetaInsights.ts`,
     `platforms/adapter.ts:~61`). Nothing writes the table yet: B5 is its writer. Read `adsPolicy.ts:~18`.
   - `packages/shared/src/ads/adsRulesSpec.ts` — the auto-pause settings → Meta Automated Rules (B3b), incl.
     the 7-day fatigue window. B5's own checks must read the SAME settings, not restate thresholds.
   - `packages/shared/src/ads/campaignMachine.ts:~25` + `naming.ts:~12` — `external_change` as the state
     machine and the code taxonomy define it (an object we did not create, or a status we did not set, is
     reported, never adopted).
   - `apps/api/src/modules/ads/orchestrator/` (runner, tick, brake) and `alerts/` (pauseAlerts, adsAlerts) —
     how a pause is requested through the guard and how an alert rings. The monitor PAUSES through the same
     path; it never calls the adapter's spend methods directly (A5).
   - `apps/api/src/modules/ads/leads/backfillTick.ts` — the scheduler shape to copy (general lane, off unless
     `ADS_ENABLED`, one job per connection with a `dedup_key`).
   - `apps/api/src/modules/ads/platforms/simulator/fakeMetaInsights.ts` — today only ACCOUNT spend for a
     range, no days or hours. B5 extends the fake (own file — `fakeMeta.ts` is at **446 of 450** lines).
   - `scripts/ads-readiness.registry.mjs` — Monitor's L1 is `notBuilt("B5 hourly insights, daily reconcile,
     external_change")`.

## 1. Done (all merged to main)

| Step | PR | Merge | What |
|---|---|---|---|
| B4b | #1982 | `4c009c6` | `GET/POST /api/webhooks/meta` (public): HMAC `X-Hub-Signature-256` over the RAW bytes (+ the escaped-unicode form Meta signs), 503 without `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN`, 401 on a bad signature, counted and said at boot. Job **`ads_lead_fetch`** (`KIND_CAPS` 1, dedup `ads_lead_fetch:<org>:<leadgen_id>`) reads the lead by id with the Page token, maps with the backfill's `platformLeadFromMeta`, sink. Connection test check 7 **`leadgen`** (`subscribed_apps`). FakeMeta `fakeMetaWebhooks.ts`. 31 tests, 17 mutants killed, `/security-review` no finding. |
| audit H1–H4 + leads H2/H3 | #1967 #1968(0556→0559) #1970 #1972 #1973 #1976 #1978 #1979(0558) | — | (the parallel audit chat) launch failure paused+confirmed; `ads_pause_failed` alert; dead token marks connection failing; guard reads Meta's account spend; key rotation; backfill catches up from the last `done` run (`catchUpSince`); do-not-contact; `purge_lead`. |

- **Main at handoff:** `4c009c6` or later. **Newest migration on main:** `0559_ads_pause_failed_alert.sql`.
  Confirm both by NAME at start; other chats merge all day.
- **Scorecard (`pnpm ads:readiness`):** Orchestrator L3, Budget guard L3, **Lead intake L1**, Security L1,
  everything else L0. **Monitor L0**, its L1 gap is B5.
- Worktree `../FuelGuard-ads-d1` holds branch `claude/ads-handoff-b5` (this file); reuse it for B5 from a
  fresh `origin/main` branch, or remove it.

## 2. Open questions and blockers (do not route around them)

- **Q-AD23 / Q-AD24:** unchanged, owner has not ruled (B2 handoff §2).
- **Owner track (due Mon 11/09):** Meta app secret + verify token (B4b goes live only then), the App Dashboard
  `leadgen` subscription to `<api origin>/api/webhooks/meta`, the system user's **Moderate** task on the Page
  (connection check 7 fails without it), plus everything in §5.
- **Insights shape is a reading until L4.** Build the hourly pull on Meta's documented
  `time_increment`/`breakdowns=hourly_stats_aggregated_by_advertiser_time_zone` (or whatever the Insights page
  says on the day — READ IT, cite it in the fake's header, and say in one short message where it differs
  from this file). Watch for: hours in the ACCOUNT's time zone, not UTC (the table is UTC — convert, and test
  a DST day); `spend` in major units as a decimal string (the guard's fake already models that); numbers that
  Meta revises for up to ~28 days (the upsert must allow a revision DOWN).
- **Writing `ads_spend_hourly`:** it is a pulled-facts table (re-derivable), but **`lint:upserts` forbids a
  partial-payload `.upsert()`** — write every NOT NULL column, or a set-based RPC (0174/0175 pattern; a new
  function is a migration ABOVE main's newest by name, and its reader merges only after it reaches staging —
  `pnpm verify:live staging`). Add the writer to `scripts/table-writers.json` in the same PR.

## 3. Next step: B5 — the monitor (split into PRs of ≤ ~500 lines; the B4a1/B4a2 split worked)

Shape proposed (confirm against the code before building):
1. **B5a — the hourly pull.** Per connection: every live campaign of ours, the last N hours of insights at
   hourly grain (campaign level), → `ads_spend_hourly` (spend cents, impressions, clicks, leads, currency).
   Re-reads an overlapping window every hour (a window, not a watermark — the backfill's argument), so late
   and revised hours heal themselves. Job `ads_insights` (`KIND_CAPS` 1, dedup per connection), scheduler
   `ads-insights` (general lane, hourly, off unless `ADS_ENABLED`) — `docs/WORKER-DEPLOYMENT.md` already
   names it as planned. FakeMeta: `fakeMetaInsightsHourly.ts` (or extend `fakeMetaInsights.ts`) with
   planted hours, late hours, and revisions down.
2. **B5b — the checks.** After a pull: our auto-pause rules (read the settings in force via the same source
   `adsRulesSpec.ts` reads), overspend, zero-lead spend, fatigue from Meta's delivery flags. A breach →
   a pause request through the guard/runner path + the matching alert category. Never on a learning-phase
   ad set except caps (§4R). Pure decision function in `packages/shared/src/ads/`, the job only applies it.
3. **B5c — the daily reconcile + `external_change`.** Read what Meta holds (campaign/ad set/ad status,
   budgets, names) against what we hold; every mismatch is one `external_change` event + alert, never
   adopted (D-AD4). FakeMeta's `externalStatusChange` already exists for the test.
4. **Readiness:** replace Monitor's `notBuilt` with pinned tests → L1. Leave L2/L3 `later` unless the
   §4R fault list is all tested.
5. **Docs:** NOTE the parallel chat's convention since 11/03: a code PR's progress-log entry may be moved
   into one docs PR at the end to stop end-of-file conflicts. Either do that, or keep the entry and expect
   to resolve an append-vs-append conflict at merge (keep both, theirs first).

Tests that must exist (each shown to fail by mutation before the PR): a forced overspend → pause requested
and `ads_overspend` alert; an hour revised down replaces the stored hour; a late hour fills in on the next
run; a DST day lands on the right UTC hours; zero-lead spend past the minimum fires and below it does not;
a learning-phase ad set is not paused except by a cap; an Ads-Manager status change → exactly one
`external_change`, and a run with no changes flags nothing; every query org-scoped (`expectOrgScoped`).

**Then (unchanged order):** C1–C5 (+ `lint:agent-fixtures`, `pnpm ads:eval`), B2c, F1, D2, E1–E5, B6.
**Honest calendar:** Stage 1 is still B5, C1–C5, B2c, F1, D2, E1–E5 and the eval tooling away; then Stage 2
(credentials, L4). The first real ad is no earlier than the day after L4. Say so again if asked.

## 4. Traps hit this session (add to the earlier lists)

- **Production runs `JOB_EXECUTION_MODE=inprocess`: `dispatchJob` runs the handler INLINE.** Fine from a
  scheduler; wrong from a request that must answer fast (B4b writes a row with `pgQueueDriver(admin).enqueue`
  and runs it after answering with `drainKindNow`). A new row-born kind must join `drainKinds` in
  `queue/inprocessDrain.ts` or it sits `queued` forever (and `inprocessDrain.test.ts` pins that list).
- **`MetaGraph` throws `this.o.now is not a function` if handed `now: undefined`** (`RegistryDeps.now` is
  optional; spreading it overrides the default). Make `now` required in any new deps type. Inside an app
  under vitest the throw showed as a run that **hung with no output** — bisect with `-t "<describe>"` and a
  watchdog before suspecting an import cycle.
- **Importing `queue/inprocessDrain.ts` from an ads route is a cycle** (it loads every handler, one of which
  loads ads). Inject from `app.ts`, the composition root.
- **`JobConflictError` from `modules/org` is a boundary violation from ads** (`lint:boundaries`). Use the
  queue driver, which answers `{ conflict: true }`.
- **`apps/api/src/env.ts` is at 499 of 500 lines** (`lint:filesize`). A new env var needs a one-line comment,
  or a split of the file first.
- **`fakeMeta.ts` is at 446 of 450** — every new FakeMeta family goes in its own file.
- **A piped gate hides its exit code**: `pnpm ci:local … | tail` returned 0 on a red gate and the next step
  pushed. Capture `$?` before piping (memory "Run all gates — check `$?`").
- **Main moves fast**: B4b had to be rebased twice; `gh pr merge` says "merge conflicts" with a stale
  `mergeable: UNKNOWN`. Fetch, rebase, re-run gates + the touched suites, push with `--force-with-lease`.
- **Two recruiting PDF tests time out under a loaded machine** (`permissionInstrument`, `packetContinuation`);
  they pass alone. Not ours; re-run alone before suspecting a change.

## 5. Owner track (unchanged, due Mon 11/09)

Meta setup ("Meta ready", never a token in chat) **including the app secret, a webhook verify token, the App
Dashboard `leadgen` subscription and the Page's Moderate task**, Higgsfield API key, TikTok developer app, X
contact, brand kit + photos, **the first opening** (`POST /api/recruitment/openings`), spending values,
presets P1–P5, counsel (G12 / Q-AD8), rulings on Q-AD23 / Q-AD24, and approval of the next release (it
carries everything from A5 through B4b).

## 6. First action in the new chat

1. Read §0.
2. Confirm no other chat has an open PR on `modules/ads/monitor*`, `ads_spend_hourly` or insights
   (`gh pr list --state open`; the audit chat merges ads PRs too).
3. Confirm main's HEAD and the newest migration **by name**.
4. Run `pnpm ads:readiness`; it must match §1 (Lead intake L1, Monitor L0 with gap B5).
5. Read Meta's Insights pages (hourly breakdown, time zone, attribution/revision window, delivery/fatigue
   flags) and the Automated Rules page; say in one short message where they differ from §2–§3. Then build B5a.
