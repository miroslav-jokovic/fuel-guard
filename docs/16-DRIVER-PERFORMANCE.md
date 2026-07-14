# 16 — Driver Performance & Weekly Rewards (audit + plan)

Goal: grade every driver each week by fairly combining **Samsara Safety Score**, **Samsara Driver Efficiency**, and our own **Idling discipline** score; rank the fleet on a **3-week trailing average**; freeze each settled week and lock in the **top 3 winners** for rewards. This is the plan — assumption-free and ready to build. Nothing is built yet.

This doc is the source of truth for the feature. It follows FleetGuard practice: **pure, testable logic in `packages/shared`; thin API services through the jobs ledger + rate-limited Samsara client; RLS-scoped Supabase reads on the web; one self-contained reusable module.** Every parameter has a default; every external dependency is confirmed or flagged as a build-time verification with a resolution step.

Decisions locked with the fleet: fleet size **150–200 drivers**; ranking basis **3-week trailing average**; Efficiency **included with graceful degrade** (it's a Samsara beta feed); eligibility gate **500 mi AND 10 drive-hours** (configurable); normalization **fleet-relative percentile**; weights **Safety 0.50 / Efficiency 0.25 / Idling 0.25**.

---

## 0. The big picture

```
                     ┌──────────── packages/shared/src/driverPerformance/ (PURE, REUSABLE) ────────────┐
 Samsara APIs        │ parse.ts   normalize.ts   combine.ts   trailing.ts   weekWindow.ts   types.ts    │
  /safety-scores  ───┼─►   the SAME pure functions are called by BOTH the API (snapshot) and web (live) │
  /driver-efficiency ┼─►                                                                                │
                     └───────────────────────────────────────────────────────────────────────────────┘
        │                              ▲                                   ▲
        │ API sync (rate-limited)      │ reads                             │ reads (RLS)
        ▼                              │                                   │
  apps/api  driverScoreSync ─► driver_scores (raw Samsara components / driver-week, PROVISIONAL)
            driverPerfSnapshot ► driver_performance_weeks (FROZEN settled week + percentiles + winners) ◄─ idle_events (ours)
            scheduler: refresh current week + snapshot settled weeks
                                       ▼                                   ▼
  apps/web  DriverPerformancePage: "This week (live)" = combine(driver_scores + idle_events + settings)
            past weeks = frozen rows verbatim · DriverPerformanceSettingsPage (admin)
```

**One-sentence model:** Samsara-sourced components are *synced* into `driver_scores` per driver-week; the idle component is *computed live* from our `idle_events`; a single pure `combine()` turns the three sub-scores into fleet-relative percentiles → a weighted final → a 3-week trailing rank; the current week renders live/provisional, and each week is *frozen* into `driver_performance_weeks` once its data settles (~96 h, to clear Samsara's 72 h efficiency lag).

---

## 1. Audit of the current system (reuse vs add)

**Architecture:** pnpm monorepo — `apps/web` (Vue 3 + Vite + Pinia + TanStack Query + Tailwind v4), `apps/api` (Express + TS), `packages/shared` (`@fuelguard/shared`). Multi-file shared modules use a **folder** (precedent `packages/shared/src/recon/`); everything re-exported from `packages/shared/src/index.ts`.

**Web:** pages in `apps/web/src/pages`, hooks in `apps/web/src/features/<domain>/useX.ts`; reads go straight to Supabase under RLS (`useIdleScores`, `useDrivers`), mutations via `apiFetch`. Shared UI: `DataTable`, `FilterBar`, `FilterSelect`, `PageHeader`, `Base*`, `FormField`, `TablePagination`, `StatCard`. **Design tokens only** (`ink`/`brand`/`edge`/`success-700`…), enforced by `apps/web/scripts/check-design-tokens.mjs`. Helpers `lib/sort.ts`, `lib/badges.ts` (`toneClass`).

**API:** routes in `apps/api/src/routes`, services in `apps/api/src/services`. Background work runs through the **jobs ledger** (`services/jobs.ts`): `startJob(org,kind)` claims a partial-unique `(org,kind)` slot (concurrent → `JobConflictError` → 409), `finishJob` records done/failed+stats. **Single in-process instance** (schedulers are `setInterval`). All Samsara calls go through `lib/samsaraHttp.ts::samsaraFetch` (per-token rate limiting, retry). Fetchers in `lib/samsara.ts` use `makeSamsaraXFetcher(env, token)` + a `listAllPages` cursor helper. Token via `lib/samsaraToken.ts::loadSamsaraToken`. Scheduler `services/samsaraScheduler.ts::startTier`. `samsaraDiagnostics.ts` probes endpoints for scope/status/sample.

**DB & RLS:** migrations `supabase/migrations/NNNN_name.sql` + `_deploy/apply_NNNN.sql`; helpers `auth_org_id()`/`auth_role()`. Tenant pattern: select `org_id = auth_org_id()`; write `admin`/`fleet_manager`; config tables (`anomaly_thresholds`) admin-only; `integration_credentials` service-role only. Offline RLS matrix `supabase/tests/rls.test.mjs` applies an **explicit migration list** — new migrations must be appended with assertions.

**Idling (reused, not rebuilt):** `packages/shared/src/idleScoring.ts::aggregateDriverIdle(rows)` → each `IdleScoreRow.score = max(0, round(100 − discretionaryPct))` (0–100, higher better; a **share**, already exposure-fair). Window is caller-controlled → a 7-day weekly idle score = pass that week's events. Backed by `idle_events` (0042, member-read/mgr-write) and `idle_settings` (0044).

**Drivers/identity (reused):** `drivers` (0003+0015) with `samsara_driver_id` (populated by `samsaraDriverSync.ts`) — **our join key** to both Samsara score endpoints (neither returns a reliable name). `organizations.operating_hours->>'tz'` (default `America/Chicago`) → the **week-boundary timezone**.

**We add (nothing above modified destructively):** shared `driverPerformance/` module; 3 migrations; 2 Samsara fetchers; 2 API services + 1 route + scheduler tiers + diagnostics probes + 2 JobKinds; 4 web hooks + 2 pages + router/nav entries.

---

## 2. Samsara API contracts (verified; UNCONFIRMED items flagged for a live check)

### 2.1 Safety Score — `GET /safety-scores/drivers` (modern, primary)
- **Request:** `startTime`,`endTime` (RFC3339); `driverIds` (comma-sep, **max 100/call** → batch 150–200 into 2 pages); `after` cursor. `pagination{endCursor,hasNextPage}`.
- **Response `data[]`:** `driverId` (string); `driverScore` (int **0–100, higher=safer**); `driveDistanceMeters` (int64 **meters**); `driveTimeMilliseconds` (int64 **ms**); `behaviors[]{behaviorType,count,scoreImpact}` (types incl. `acceleration/braking/harshTurn/crash`); `speeding[]{speedingType,durationMilliseconds,scoreImpact}`.
- **Scope:** *Read Safety Events & Scores*. **Rate:** 100/min. No name → join on `samsara_driver_id`. **Exposure (miles, drive-hours) come from here** → Safety must be present to rank.
- **UNCONFIRMED (verify live, task B0):** exact modern field spellings (single-source), min window, latency. Fallback `GET /v1/fleet/drivers/{id}/safety/score` has dedicated `harsh*Count/crashCount/totalDistanceDrivenMeters` but is per-driver (min 1 h).

### 2.2 Driver Efficiency — `GET /driver-efficiency/drivers` (BETA, graceful-degrade)
- **Request:** `startTime`,`endTime` (RFC3339, **hour-truncated**; start **≥1 day** before end; end **≤3 h before now**); `dataFormats=score,raw` (default `score`); `driverIds`; `after`.
- **Response `data[]`:** `driverId`; `scoreData.overallScore` (**STRING** `"0"`–`"100"` **or** `"A"`–`"G"` per org config; higher=better) + per-behavior scores; `rawData{engineOnDurationMs,idlingDurationMs,…}`; `percentageData{idlingPercentage,…}`.
- **Scope:** *Read Driver Efficiency*. **Rate:** 10/s. **BETA** ("not for production until GA"). **Latency:** last **72 h** may still be processing → current week's efficiency is provisional (drives the settle delay §3.6).
- **Graceful degrade:** feed 401/error/unavailable or **letter grade** → null the efficiency component, flag it, grade on present components (renormalized weights §3.4). `engine_on_hours` from `rawData.engineOnDurationMs` when present, else Safety `driveTimeMilliseconds` for the gate.
- Not used for the grade: `/fleet/reports/drivers/fuel-energy` (MPG/cost, **no score**) — optional context later.

---

## 3. Scoring model (exact, fair, transparent)

All three inputs are 0–100 higher-is-better and already exposure-normalized by their producers. Remaining fairness risks — spread dominance, small-sample luck, missing components — handled explicitly. Tuned for a 150–200 driver fleet.

**3.1 Per-driver weekly inputs** (driver *d*, ISO week *W* Mon–Sun in org tz): `safetyScore`(0–100) + exposure `miles=driveDistanceMeters/1609.344`, `driveHours=driveTimeMilliseconds/3.6e6`; `efficiencyScore`(0–100 or null) + `engineOnHours` if present; `idleScore`= `aggregateDriverIdle(idle_events in W).score` for *d* (eligible driver, drive activity, zero scored idle → `idleScore=100`; no idle data → null).

**3.2 Eligibility gate** (configurable): rankable iff `miles ≥ min_distance_mi (500)` AND `exposureHours ≥ min_drive_hours (10)` AND Safety present. `exposureHours = engineOnHours ?? driveHours`. Ineligible drivers still see all sub-scores (coaching) but are excluded from ranking; `ineligible_reason` recorded (`below_min_miles`|`below_min_hours`|`no_safety`).

**3.3 Normalization — fleet-relative percentile** (`method=percentile`, default). Within week *W*, over the eligible cohort that has that component, Hazen mean-rank percentile (ties share mean rank):
`pct(x) = 100 × (meanRankAscending(x) − 0.5) / N`.
Puts all three on an identical, bounded, outlier-robust footing so **no wide-spread metric dominates** (core fairness fix), and reads naturally ("82nd percentile on safety"). Configurable alternatives, same interface: `zscore`, `raw` (documented as unfair, parity only). Below `min_cohort_for_percentile (20)` eligible, auto-fall back to `zscore`.

**3.4 Weighted combine + missing-component renormalization:**
`weekFinal(d) = Σ_i(wᵢ·pctᵢ(d)) / Σ_i wᵢ` over present components. Defaults **Safety 0.50 / Efficiency 0.25 / Idling 0.25** (configurable, renormalized at compute). Missing component → its weight drops out; **Safety must be present** (else not rankable), so no one wins by suppressing their weakest feed.

**3.5 Trailing 3-week ranking:** `trailingFinal(d,W) = mean(weekFinal over the last ≤trailing_weeks(3) eligible weeks)`. Suppresses one-week luck/gaming, rewards consistency, still picks a top-3 every week. **Winners** = top `reward_top_n(3)` eligible by `trailingFinal`. **Tie-break ladder:** Safety pct → total miles → Idling pct → prior-week trailingFinal → lexical `driver_id`.

**3.6 Settling & freezing:** week *W* is provisional until `now ≥ weekEnd(W) + settle_hours (96)`, then frozen into `driver_performance_weeks`. Current week always renders live; settled past weeks render frozen rows verbatim → auditable, immune to late Samsara data.

**3.7 Transparency:** page shows raw sub-scores + percentiles + exposure + a "how scoring works" panel (weights/method/gate/window), mirroring the Idling page's explainer.

---

## 4. Reusable shared module — `packages/shared/src/driverPerformance/`

Self-contained folder (mirrors `recon/`), pure + unit-tested, re-exported via `export * from "./driverPerformance/index.js"`.

| File | Exports | Test |
|---|---|---|
| `types.ts` | `PerformanceWeights`, `NormalizationMethod`, `PerformanceSettings` (+`DEFAULT_PERFORMANCE_SETTINGS`), `DriverWeekInput`, `WeekLeaderboard`, `LeaderboardRow` | — |
| `parse.ts` | `parseSafetyScores`, `parseDriverEfficiency`, `parseEfficiencyOverall` (num or A–G→null), `metersToMiles`, `msToHours` | `parse.test.ts` |
| `normalize.ts` | `percentileRanks` (Hazen, mean-rank ties), `zScoreScaled`, `normalizeComponent(values,method)` | `normalize.test.ts` |
| `combine.ts` | `combineWeek(inputs, settings): WeekLeaderboard` — eligibility → normalize over eligible cohort → weighted renormalized combine | `combine.test.ts` |
| `trailing.ts` | `rankTrailing(weekFinals, settings): LeaderboardRow[]` — trailing avg, ranking, tie-break, winners | `trailing.test.ts` |
| `weekWindow.ts` | `weekWindow(nowMs,tz,weekStartsOn=1)`, `recentWeeks(nowMs,tz,n)` — reuses shared `zonedWallTimeToUtcIso`/`stateTimeZone` | `weekWindow.test.ts` |
| `index.ts` | re-exports | — |

Test rigor mirrors `idleScoring.test.ts`: parse happy/empty/malformed + letter-grade; percentile correctness incl. ties + `<20` fallback; combine incl. missing-component renorm + "Safety required"; gate boundaries (499 vs 500); trailing over 1/2/3 weeks; full tie-break; deterministic ordering.

---

## 5. Data model — 3 migrations (+ deploy companions + RLS-matrix updates)

**`0053_driver_performance_settings.sql`** (admin-only write, like `anomaly_thresholds`): `org_id pk`, `weight_safety(0.50)`, `weight_efficiency(0.25)`, `weight_idling(0.25)`, `normalization_method('percentile')`, `min_cohort_for_percentile(20)`, `min_distance_mi(500)`, `min_drive_hours(10)`, `reward_top_n(3)`, `trailing_weeks(3)`, `settle_hours(96)`, `efficiency_enabled(true)`, `week_starts_on(1)`, `week_timezone(null→org tz)`, `updated_at` + trigger.

**`0054_driver_scores.sql`** (current/provisional Samsara components per driver-week; member-read / mgr-write): `id`, `org_id`, `driver_id`, `samsara_driver_id`, `week_start`, `week_end`, `window_start/end`; Safety: `safety_score`, `drive_distance_mi`, `drive_time_hours`, `harsh_accel_count/harsh_brake_count/harsh_turn_count/crash_count`, `speeding_ms`, `safety_raw jsonb`; Efficiency (nullable): `efficiency_score`, `efficiency_grade_letter`, `engine_on_hours`, `idling_pct`, `efficiency_raw jsonb`; `synced_at`; **unique(org_id,driver_id,week_start)**; index (org_id,week_start).

**`0055_driver_performance_weeks.sql`** (frozen settled week + winners = rewards ledger; member-read / mgr-write): `org_id`, `week_start`, `week_end`, `driver_id`, `driver_name` (denormalized), `safety_score/efficiency_score/idle_score`, `safety_pct/efficiency_pct/idle_pct`, `week_final`, `trailing_final`, `drive_distance_mi`, `drive_time_hours`, `eligible`, `ineligible_reason`, `rank`, `is_winner`, `weights_used jsonb`, `method_used`, `settled_at`; **pk(org_id,week_start,driver_id)**; indexes (org_id,week_start),(org_id,is_winner). Companions `_deploy/apply_0053..0055.sql`.

---

## 6. API — fetchers, services, route, scheduler, diagnostics, env

- **`lib/samsara.ts`:** `makeSamsaraSafetyScoreFetcher(env,token)→(startIso,endIso,driverIds?)` (batch ≤100 ids, cursor); `makeSamsaraDriverEfficiencyFetcher(env,token)→(…)` (`dataFormats=score,raw`, enforce hour-trunc/≥1-day/≤3h-before-now, cursor).
- **`services/driverScoreSync.ts`:** `syncDriverScores(admin,env,orgId,{weekStart?})` — resolve week window (org tz), map `samsara_driver_id→driver`, fetch Safety (required) + Efficiency (best-effort, letter→flag+null), upsert `driver_scores` on `(org,driver,week_start)`. Mirrors `idleSync.ts` tolerance.
- **`services/driverPerformanceSnapshot.ts`:** `snapshotSettledWeeks(admin,env,orgId,{nowMs})` — for each week ended with `now ≥ weekEnd + settle_hours` and not frozen: ensure `driver_scores` for it + prior `trailing_weeks−1` weeks, compute weekly idle per driver from `idle_events`, `combineWeek` per week + `rankTrailing`, upsert `driver_performance_weeks` + winners + audit.
- **`routes/integrations.ts`:** `POST /samsara/sync-driver-scores` (admin+mgr, jobs `sync_driver_scores`, audit); `POST /driver-performance/snapshot` (admin, jobs `snapshot_driver_week`); fold `syncDriverScores` into the `/sync-vehicles` best-effort chain.
- **`services/samsaraScheduler.ts` + `jobs.ts`:** JobKinds `sync_driver_scores`,`snapshot_driver_week`; driver-score tier (`SAMSARA_DRIVER_SCORE_SYNC_HOURS`, 6 h); hourly settled-week snapshot check.
- **`services/samsaraDiagnostics.ts`:** probes for `/safety-scores/drivers` + `/driver-efficiency/drivers` (scope + raw sample) — **the live schema verification** that resolves §2 UNCONFIRMED items.
- **`env.ts`/`.env.example`:** add `SAMSARA_DRIVER_SCORE_SYNC_HOURS(6)`. Token scopes: *Read Safety Events & Scores* + *Read Driver Efficiency*.

---

## 7. Web — hooks, pages, router, nav

New `apps/web/src/features/drivers/`: `useDriverPerformance.ts` (current week live: `driver_scores` last `trailing_weeks` + `idle_events` + settings → `combineWeek`+`rankTrailing`), `useDriverPerformanceWeeks.ts` (settled weeks + winners), `useDriverPerformanceSettings.ts` (admin read/update, like `useThresholds`), `useSyncDriverScores.ts`.

Pages: `DriverPerformancePage.vue` — header + Sync now (admin); week selector ("This week (live)" + settled weeks); top-3 winner cards; leaderboard `DataTable` (rank, driver, Safety score+pct, Efficiency score+pct, Idling score+pct, Final, exposure, eligibility badge, sortable); "how scoring works" + coverage panels. `DriverPerformanceSettingsPage.vue` — weights/method/gate/top-N/trailing/settle/efficiency toggle (admin), like `ThresholdsPage`, shared Zod `performanceSettingsFormSchema`.

Router `/driver-performance` (Analysis nav, `TrophyIcon`, `canManage||readOnly`); `/settings/driver-performance` (admin, parent `/settings`). Nav item in `layouts/AppShell.vue` beside Idling.

---

## 8. Verification
- **shared:** 5 test files in `driverPerformance/`.
- **api:** `driverScoreSync.test.ts` (mapping, Safety-required, efficiency degrade incl. letter grade, upsert); `driverPerformanceSnapshot.test.ts` (deterministic percentiles/ranks/winners + settling gate + idempotent re-run).
- **RLS matrix:** append `0053/0054/0055` to `rls.test.mjs` list + assertions (member-read / admin-only settings write / mgr write scores+weeks / cross-org denied).
- **Gates:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` green; design-token check passes; `_deploy/apply_0053..55.sql` produced.

---

## 9. Blockers & required confirmations (build-time, owned)
1. **Modern Safety-Score field names single-source** → resolve first (task B0): diagnostics probe on the live org, lock the parser to the real sample (legacy per-driver endpoint is the coded fallback).
2. **Efficiency 0–100 vs A–G + `dataFormats` omission** → same probe confirms org config; parser handles both, so cannot block — decides whether `efficiency_enabled` ships on/off.
3. **Token scopes** → *Read Safety Events & Scores* + *Read Driver Efficiency*; diagnostics reports 403 per feed.
4. **`jobs.kind` DB constraint** → read `0027_jobs.sql`; if `kind` is CHECK/enum, extend it; if plain `text`, TS union suffices.
5. **`driverIds` cap** → Safety 100/call (batch of 2); Efficiency undocumented → 100-chunk batching + `after` pagination.
6. **Week-tz utility** → confirm `zonedWallTimeToUtcIso`/`stateTimeZone` in `@fuelguard/shared` cover arbitrary IANA zones; else `weekWindow.ts` adds a small tested helper.

No remaining assumptions in the scoring logic (fleet size, ranking basis, efficiency handling, gate, normalization, weights all decided as defaults).

---

## 10. Build checklist (small, ordered tasks — keep in order)

### Phase A — Shared module + schema (no external deps; fully unit-testable)
- [ ] A1 · `driverPerformance/types.ts` — contracts + `DEFAULT_PERFORMANCE_SETTINGS`
- [ ] A2 · `driverPerformance/parse.ts` (+ `parse.test.ts`) — safety/efficiency parsers, unit conversions, A–G handling
- [ ] A3 · `driverPerformance/normalize.ts` (+ `normalize.test.ts`) — percentile (Hazen), z-score, method switch
- [ ] A4 · `driverPerformance/combine.ts` (+ `combine.test.ts`) — eligibility, normalize-over-cohort, weighted renorm
- [ ] A5 · `driverPerformance/trailing.ts` (+ `trailing.test.ts`) — 3-week trailing, ranking, tie-break, winners
- [ ] A6 · `driverPerformance/weekWindow.ts` (+ `weekWindow.test.ts`) — tz week bounds (confirm shared tz util, §9.6)
- [ ] A7 · `driverPerformance/index.ts` + export from `packages/shared/src/index.ts`
- [ ] A8 · Migrations `0053/0054/0055` + `_deploy/apply_0053..55.sql`
- [ ] A9 · Append `0053/0054/0055` to `supabase/tests/rls.test.mjs` list + assertions
- [ ] A10 · Gate: `pnpm --filter @fuelguard/shared test`, `pnpm typecheck && pnpm lint && pnpm build` green → **commit**

### Phase B — API (starts with the live-schema gate)
- [ ] B0 · **Verification gate:** extend `samsaraDiagnostics.ts` with the two probes; run against the live org; confirm §9.1–9.3 and `jobs.kind` (§9.4); lock field mappings
- [ ] B1 · `lib/samsara.ts` — `makeSamsaraSafetyScoreFetcher` + `makeSamsaraDriverEfficiencyFetcher`
- [ ] B2 · `services/driverScoreSync.ts` (+ test)
- [ ] B3 · `services/driverPerformanceSnapshot.ts` (+ test)
- [ ] B4 · `jobs.ts` JobKinds + `routes/integrations.ts` endpoints (+ fold into sync-vehicles) + audit
- [ ] B5 · `samsaraScheduler.ts` driver-score tier + hourly snapshot; `env.ts`/`.env.example`
- [ ] B6 · Gate: api tests + `pnpm typecheck && pnpm lint && pnpm build` green → **commit**

### Phase C — Web
- [ ] C1 · `features/drivers/` hooks (performance, weeks, settings, sync)
- [ ] C2 · shared `performanceSettingsFormSchema` (Zod) + export
- [ ] C3 · `pages/DriverPerformancePage.vue` (winners + leaderboard + panels)
- [ ] C4 · `pages/DriverPerformanceSettingsPage.vue` (admin)
- [ ] C5 · `router/index.ts` routes + `layouts/AppShell.vue` nav item
- [ ] C6 · Gate: `pnpm typecheck && pnpm lint && pnpm build` + design-token check green → **commit**

### Phase D — Settling + full verification
- [ ] D1 · End-to-end dry-run on the live org (sync → provisional current week → settle → freeze)
- [ ] D2 · Full RLS matrix + `pnpm test` + all gates green
- [ ] D3 · Update this doc's checklist + a short "built" note → **commit**

---

## 11. Parameter reference (defaults; all configurable in Settings)
| Parameter | Default | Meaning |
|---|---|---|
| weight_safety/efficiency/idling | 0.50/0.25/0.25 | Combine weights (renormalized over present components) |
| normalization_method | percentile | percentile \| zscore \| raw |
| min_cohort_for_percentile | 20 | Below this eligible count → auto z-score |
| min_distance_mi / min_drive_hours | 500 / 10 | Weekly exposure gate |
| reward_top_n | 3 | Winners frozen per week |
| trailing_weeks | 3 | Weeks averaged for ranking |
| settle_hours | 96 | Delay before a week is frozen (clears the 72 h efficiency lag) |
| efficiency_enabled | true | Include the Samsara efficiency component |
| week_starts_on / week_timezone | 1 (Mon) / org tz | ISO week boundaries |
| SAMSARA_DRIVER_SCORE_SYNC_HOURS | 6 | Current-week refresh cadence (env) |

---

## 12. Sources
Samsara: [Get driver safety scores](https://developers.samsara.com/reference/getdriversafetyscores) · [v1 driver safety score](https://developers.samsara.com/reference/v1getdriversafetyscore) · [Safety Score calc (KB)](https://kb.samsara.com/hc/en-us/articles/360045237852-Safety-Score-Categories-and-Calculation) · [Driver efficiency by drivers](https://developers.samsara.com/reference/getdriverefficiencybydrivers) · [Driver Fuel Efficiency Scores (KB)](https://kb.samsara.com/hc/en-us/articles/360062066752-Driver-Fuel-Efficiency-Scores) · [safety-sample](https://github.com/samsarahq/safety-sample). Fairness: [Geotab Driver Safety Scorecard](https://www.geotab.com/white-paper/driver-safety-scorecard/) · [OECD Composite Indicators](https://www.oecd.org/content/dam/oecd/en/publications/reports/2005/08/handbook-on-constructing-composite-indicators_g17a16e3/533411815016.pdf) · [Empirical Bayes shrinkage](http://varianceexplained.org/r/empirical_bayes_baseball/).
