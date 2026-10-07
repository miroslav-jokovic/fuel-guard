# F02 + F04 audit — fuel transactions, cards, findings and alerts

**Findings only.** Fixes are in `PLAN.md`. Measured 2026-10-06 from `origin/main` @ `5938cdb` and the
production database, for the real fleet (org `86d6b3ea…`). Every query below was read-only.

Finding IDs: **U** use, **N** numbers, **W** UI and wording, **S** frontend structure, **A**
architecture and API, **D** data feeds, **P** production readiness.

---

## 0. The key question: why does nobody review findings and alerts?

**Short answer.** People did review alerts for six weeks. Almost every alert turned out false, so
they stopped. Nobody owns the queue, so the backlog stays. The "0 findings reviewed" figure also
measures the wrong table.

1. **The "0 dispositions" figure counts the wrong thing.** `fuel_txn_dispositions` holds
   **Recall audit** verdicts (`clean` / `missed`), not finding reviews. Recall audit means sampling
   fills the engine *cleared*, to measure what it misses (migration `0035_recall_audit.sql:1-5`,
   writer `apps/api/src/modules/org/routes/audit.ts:138-152`). 0 rows means the Recall audit page
   has never been used. Reviews of findings and alerts live in two other tables:

   | Queue | Table | Open | Closed by a person, ever | Last human action |
   |---|---|---|---|---|
   | Money findings (Findings page) | `fuel_exceptions` | 157 | **1** (dismissed) | 09-02 |
   | Theft cases (Alerts page) | `anomalies` | 81 | 105 rows still exist; 410 audit rows | **08-14** |

2. **People did review alerts, until 08-14.** `audit_logs` holds 410 `anomaly.status_changed` rows
   by a person, from 07-01 to 08-14: 361 dismissed, 28 resolved, 21 "investigating". The 105
   surviving rows were all closed by **one admin** (`2607d9c1…`) between 08-03 and 08-14. After
   08-14 there is no human action on either queue.
3. **The alerts were noise.** Of the 105 surviving human verdicts, 3 were confirmed, 7 explained
   and 95 false alarms: **2.9% precision**. The false alarms came from `odometer_mismatch` (41),
   `card_multi_vehicle` (25 + 5 explained) and `fuel_while_driver_home` (5). Query:
   `anomalies ⋈ fuel_transactions.case_signals` grouped by `disposition` and `ruleId`.
4. **The machine now closes almost everything itself.** Since 08-31, 1,929 cases were dismissed
   automatically as `benign_explained` (`resolved_by` null; median 0 hours after creation). The
   inventory's "1,807 alerts in 30 days" is mostly this: 1,754 of them were auto-dismissed. Today's
   scorer flags **11 fills in 30 days** (7 review, 4 alert; scoring version 3 on every fill).
5. **What is open is old, from rules the owner already ruled out.** All 81 open alerts were
   created 08-10 → 09-30. Their fills carry `tank_space_exceeded` (53) and `tank_fill_short` (35).
   The approved card-fraud plan makes the first a note (`docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md`
   D-CF3). Nothing has applied that yet (CF5 not built).
6. **Most money findings cannot be acted on one by one.** Of 157 open, 138 (≈ $19.5k of ≈ $22k
   "identified") are buying habits: *Fuelled in an avoided state* 79, *Out of network* 46,
   *Fuelled at an avoided brand* 13. No vendor credits those, so "Claimed" and "Recovered" can
   never move for them. Only 14 (≈ $2.6k) are disputable with the vendor: invoice mismatch
   (`recon_*`) 10, *Paid above Pilot's quote* 4.
7. **Nobody owns either queue.** 0 of 158 money findings are assigned. Closing an alert needs
   `safety: manage` (`anomalies.ts:132`), which means admin, fleet manager or safety manager
   (`packages/shared/src/auth.ts:139-146`). Money findings need `fuel: manage`. The org has 6
   admins, 1 safety manager and no fleet manager. Q-FUI4 (2026-09-06) chose aging over a default
   owner (`FuelExceptionsPage.vue:236-237`), and aging has not made anybody act.

**Verdict on the question.** All three causes are real, in this order: **noise** (2.9% precision
drove the only reviewer away), **missing ownership** (no named person, 0 assignments), and
**workflow** (two queues on two pages in two sidebar groups, and most money findings have no
action a person can take).

---

## 1. Real use and benefit (§4.1)

- **U1. Who uses it is unknown (Q-PR3 is open).** 1 of 12 office members signed in during the last
  7 days. Fuel pages only read, so reading cannot be measured (X1).
- **U2. Card control is barely used.** `efs_card_mutations`: 11 rows ever, the last on 10-01.
  Audit log, 30 days: 3 unlocks, 3 deactivations, 1 lock, 1 prompt change, 4 mileage overrides.
- **U3. "Log fill-up" has never been used.** Every one of 17,955 fills came from the card feed:
  `fuel_transactions.source = 'fuel_card'` and `entered_by` is null on all of them. It is still the
  page's primary button (`FuelLogPage.vue:128`).
- **U4. Recall audit has never been used.** `fuel_txn_dispositions` = 0;
  `fuel_transactions.audit_verdict` is set on 0 rows.
- **U5. Notifications are mostly unread.** 30 days, sent → read:
  card status 1,422 → 237 (17%); declines 685 → 118 (17%); system 462 → 95; fuel alerts 18 → 3.
  Six people get every card-status message (`efsCardStatusPoll.ts:207, 248-271`).
- **U6. The benefit that can be named.** Theft caught: 3 confirmed cases ever. The stolen card the
  week of 09-22 was scored `alert` and notified, but it drowned in the volume (card-fraud plan §1).
  Money: ≈ $2.6k disputable is open; $0 claimed or recovered ever.
- **Verdict:** keep the transaction feed and the Fuel Log. Simplify the alerts to the card-fraud
  incident. Simplify findings to the disputable kinds. Hide the tools nobody uses (Recall audit,
  Card control check, Thresholds) until they have a user.

## 2. Numbers and precision (§4.2)

### 2.1 Reconciliation against an outside source

**EFS lines vs fills, week 09-28 → 10-04 (internal copy).** It matches exactly. `efs_transactions`
ULSD 416 lines, $284,145.40, 50,502.4 gal, plus ULSR 15 lines, $1,726.11, 306.9 gal. That equals
`fuel_transactions` tractor 416 fills / reefer 15 fills with the same dollars and gallons. Every
line has a `transaction_id`, and none is non-canonical.

- **N1. This is our copy against our copy.** `efs_transactions` is what the poller stored, so it
  cannot catch a transaction EFS has and we never fetched.
- **N2. The outside source we can reach is stale.** McLeod's GL FUEL totals (`mcleod_gl_totals`,
  the D-FIN12 tie-out in `apps/api/src/modules/financial/fuelTieOut.ts`) were last swept
  **09-10**, and only through **July**. August and September cannot be tied to McLeod. Calling EFS
  directly from a laptop is not possible: only the `fleetguardapi` host is WEX-whitelisted.
- **N3. One fill lands in different days and months on different pages.** Since 08-01, 41 fills
  have `business_date ≠ tran_date`. One crosses a month: $639.24, NV, EFS `tran_date` 10-01 00:12,
  `business_date` 09-30. Month totals by `tran_date` vs `business_date`: Sep $1,317,898.79 vs
  $1,318,538.03, Oct $229,797.93 vs $229,158.69, a $639.24 gap each way. Pages use
  `business_date` (`fuel_range_totals`, 0315), the finance tie-out uses `tran_date`
  (`efsLineItems.ts`), and Declines uses "Central time" (Declines tab footnote).
- **N4. DEF and other items are not on the Fuel Log.** Same week: DEF $11,467.47 (299 lines),
  scales $1,623.00, oil, washer fluid and other items. These are in Source records only, and no
  tile totals them.

### 2.2 Every number on the pages in scope

| Page | Number | Source and formula | Window | Finding |
|---|---|---|---|---|
| Fuel Log → Fills | Flagged | `fuel_range_totals.flagged` = count `has_anomaly` | `business_date` | **N5** |
| | Clear | count not `has_anomaly` | same | |
| | Gallons / total cost | sum `gallons`, `total_cost`, canonical only (SQL) | same | |
| | Avg MPG | `useFleetMpg`, one definition (D-MPG1) | same; dash under a driver filter | OK |
| | Row: Miles, MPG, $/gal, Gallons | stored `miles_since_last`, `computed_mpg`, `price_per_gal` | per fill | **N6** |
| Fuel Log → Declines | Count, Risk | `declined_transactions` + `declined_txn_scores` | Central-time day | N3 |
| Fuel Log → Source records | Qty, Amt, Fees | raw `efs_transactions` | `tran_date` | N3 |
| Cards | Card count, status | `efs_cards` (309) mirror of EFS | now | **N7** |
| Findings | Identified / Claimed / Recovered / Still open | `exceptionTotals` over `fuel_exceptions` only | `occurred_on` | **N8, N9** |
| | Row Amount, Age | `fuel_exceptions.amount`; age in days | | |
| Alerts | Count | `anomalies`, status filter | `fueled_at` or `created_at` | |
| Detection coverage | Blind, Telematics %, Location %, Odometer %, Attributed % | browser, paging every fill for 90 days (`useDetectionCoverage.ts:27-34`) | 90 days | **N10** |
| Reefer coverage | Reefer gal, spend, share, vs fleet, cadence | browser, paging fills (`useReeferCoverage.ts:19-24`) | 90 days | **N10** |
| Recall audit | Estimated recall | `/api/audit/recall-metrics` | all time | U4: no data |

- **N5. "Flagged — anomalies need review" counts fills a person already cleared.** 137 fills have
  `has_anomaly = true`. **56** of them have no open or investigating alert, so the tile disagrees
  with the Alerts page. Text: `FillsTab.vue:395-397`.
- **N6. A fill row shows no amount paid.** The columns are When, Driver, Odometer, Miles, Gallons,
  $/gal, MPG, Status (`FillsTab.vue:320-330`). The total cost exists only as a tile sub-line.
  Gallons render raw (`{{ row.gallons }}`, `FillsTab.vue:442`), not through `fmtNum`.
- **N7. A card is named by its last four digits, and those are not unique.** 59 four-digit endings
  are shared by 246 of 309 cards. Card-status messages read "Fuel card ••••7977 is now HOLD". On
  10-05 that title came from two different cards (`61954ffe…` at 13:22, `5969ea73…` at 13:42).
- **N8. "Identified" adds money nobody can recover to money that can be disputed.** ≈ $19.5k of
  the ≈ $22k is buying habits (§0.6). Beside "Claimed $0 / Recovered $0", it reads as $22k owed
  back.
- **N9. Loading or failure shows $0.** With the API unreachable the four tiles render "$0 / 0
  money findings" (screenshot `findings-1440.png`). Code: `usd(t?.identified ?? 0)`,
  `FuelExceptionsPage.vue:164-167`. A missing number must read "unavailable", never 0 (§4.2).
- **N10. Two coverage pages compute percentages in the browser.** They page through ≈ 5,900 fills
  per visit. Sums and percentages belong in SQL (D-FUI13); a second copy of "located" or
  "attributed" here can drift from the scorer's own.

## 3. UI/UX and wording (§4.3)

Screenshots: dev-bypass build at 1440 and 390 px. The API is unreachable in that build, so they
show layout, wording and empty/error states, not live rows. A signed-in walk with a real user is
still owed (Q-PR3). Click counts are counted from the code path.

**Top tasks and clicks**

| Task | Path today | Clicks |
|---|---|---|
| "Did truck 654 fuel this week, and how much?" | Fuel Log → Unit filter → pick → Dates → pick 2 days → read rows (no $ per row) | 6 |
| "Is anything wrong with fuel today?" | Alerts (Safety group) **and** Findings (Fuel group) **and** the bell | 2 pages + bell |
| "Close a false alarm" | Alerts → row → drawer → disposition → confirm | 4 |
| "Lock a card now" | Cards → search by last four (ambiguous, N7) → kebab → Lock → type-to-confirm | 5+ |
| "Why was this card declined?" | Fuel Log → Declines tab → find row → read raw `INVALID CARD\|GetCatScalesCard…` | 3 |

- **W1. The fuel-security work is split across two sidebar groups.** Findings is under FUEL;
  Alerts is under SAFETY (screenshot `findings-1440.png`). Findings also lists theft cases, but
  opening one sends you to Alerts. For a dispatcher (fuel view, no safety) the row click **does
  nothing** (`FuelExceptionsPage.vue:252-256`).
- **W2. Engineering text reaches office users:**
  - `/settings/efs-soap` names a repo file, `docs/plans/EFS-SOAP-INTEGRATION-PLAN.md`, and
    environment variables (`EFS_SOAP_REJECTED_POLL_MINUTES`).
  - `/settings/card-control` says "Prove EFS will accept our card changes — no-op change…", "QA
    endpoint", "Check echo only".
  - Recall audit: "Precision measures cases we raise; recall measures theft we miss…".
  - Coverage: "heavy blind coverage means 'we didn't flag it' carries less weight".
  - Thresholds: "Tune the anomaly engine".
- **W3. Fuel Log tab text is out of date.** "from your uploaded EFS Reject reports" and "from your
  uploaded EFS Transaction reports" (`FuelLogPage.vue:71-75`). Nobody uploads; the SOAP poller
  fetches both.
- **W4. The Alerts header and actions use jargon.** "Fuel-card alerts from anomaly detection —
  theft, misuse, and data-quality signals". It has a "Rebuild / Re-sync →" button for an admin
  maintenance task (`AnomaliesPage.vue`) and a hand-built segmented control instead of `AppTabs`.
- **W5. One Fills status cell holds up to four signals.** Status badge, ✓, "AI: …" and "n weak
  signals" or "ⓘ" (`FillsTab.vue:446-472`). The reason a fill was flagged is in a hover only.
- **W6. Raw ISO dates beside MM/DD/YYYY.** The Findings scope line prints `2026-07-09 →
  2026-10-06` next to the `07/09/2026 – 10/06/2026` picker (`FuelExceptionsPage.vue:297`; D-DS18).
- **W7. Declines show the vendor's raw error string,** e.g. `INVALID CARD|GetCatScalesCard: no
  card found|` (20 of 309 in 30 days). Card-fraud D-CF5/D-CF6 notes are not shown yet.
- **W8. Card-status messages say nothing a person can act on.** "Fuel card ••••7977 is now HOLD.
  It was ACTIVE…" (`efsCardStatusPoll.ts:263-264`). 108 cards changed in 10 days with a daily
  rhythm: HOLD around 13–15 UTC, ACTIVE in the afternoon (`audit_logs`
  `card.status_changed_externally`; per-card from/to is consistent, 1 mismatch in 240). These are
  real EFS changes, most likely the office's or EFS's routine, announced one by one to 6 people.
- **W9. Counts of controls:**
  - Findings: 4 tiles, 5 filters, 2 export buttons, a bulk-assign bar.
  - Alerts: 2 view buttons, 4 filters, a search, 3 bulk actions, a 4-item kebab.
  - Cards: 7 filters.
  - Fuel Log: 3 tabs, 2 header buttons, 4 tiles.

## 4. Frontend structure (§4.4)

- **S1. Pages near the 500-line budget:** `FuelCardsPage` 472, `EfsSoapPage` 449,
  `FuelExceptionsPage` 439. Components: `CardOperationDrawer` 495, `FillsTab` 485, `DeclinesTab`
  448, `CardOperationInputs` 417. `lint:filesize` passes, but any change to these lands on the
  warning line.
- **S2. Comment weight.** `FuelLogPage.vue` is 165 lines, and 44 of them are the header comment. Others
  are similar. This is the repo's register, but it makes small pages slow to change.
- **S3. Two pages page all fills into the browser** (N10).

## 5. Architecture and API (§4.5)

- **A1. The EFS module is mostly card-write machinery.** 112 files, 22,870 lines (non-test):
  - `lib/` 5,423;
  - harness 1,288;
  - capabilities 1,045;
  - orchestrator 1,225;
  - the probe, experiment, prove, scan, promote and restore routes 2,330.

  The transaction feed services are ≈ 2,800 lines. The write side has produced **11 card changes
  ever** (U2).
- **A2. The alert transition route has no behaviour test.** `POST /api/anomalies/:id/transition`
  (`anomalies.ts:129-184`) appears only in `routeGates.test.ts`. The `anomalies` module has 17 test
  files; 6 use `expectOrgScoped`.
- **A3. Rebuilds deleted reviewed alerts and their history.** 410 human status changes are in
  `audit_logs` (07-01 → 08-14), but `anomaly_transitions` starts at **08-09** (75 rows). The
  cases reviewed before that are gone, along with their transitions (cascade from `anomalies`),
  even though `anomalies` is in `RETENTION_FORBIDDEN`. That rule bars prune rules, not rebuild
  deletes (card-fraud plan §4).
- **A4. Two card tables, two `status` columns.** `fuel_cards` (194 rows, all `status = 'active'`,
  `assignment_source = 'learned'`) is the learned card→truck link. `efs_cards` (309: 135 ACTIVE,
  124 INACTIVE, 49 HOLD, 1 FRAUD) is the EFS mirror. A reader of `fuel_cards.status` would call
  inactive cards active. Not traced to a screen in this audit.
- **A5. `fuel_transactions` has 47 non-test readers across 9 modules**, including scoring,
  fuel-spend, financial, idle, insights, org and roster. Any change to a fill's meaning (N3) has
  that blast radius.

## 6. Data feeds and jobs (§4.6)

- **D1. The EFS feed is healthy and fresh.** The last line landed 17 minutes before the
  measurement. `efs_processing_runs` in 30 days: 5,024 posted + 396 rejected runs, all
  `succeeded`, 0 errors. 50–83 fills a day.
- **D2. One failure alarm ran for weeks.** "Finance job failed: efs soap posted" was sent 287 times
  in 30 days to 7 people, from 09-07 until **09-30 19:21 UTC**. The body was `TypeError: fetch
  failed`. Why it stopped is not identified (no matching commit 09-28 → 10-02).
- **D3. The McLeod FUEL sweep is stale** (N2). Owned by F14; recorded here because it blocks this
  feature's reconciliation.
- **D4. The card status poll announces every external change** (W8): 1,422 messages in 30 days,
  rising (204 on 10-01, 468 on 10-05, 330 on 10-06).

## 7. Production readiness (§4.7)

- **P1. Plan status lines have drifted.** `CARD-FRAUD-ALERTS-PLAN.md` §7 ends at "Plan written…
  Nothing built". CF1a (#1213, migration 0408) and CF1b (#1214) are merged, and CF2 (#1216) is
  stalled with a stale migration.
- **P2. Human changes are audited.** Card writes, alert transitions, finding moves and mileage
  overrides all write `audit_logs`. Machine closes (1,929 auto-dismissals) leave no human audit
  row, which is correct, but they are not visible as a count anywhere on the page.
- **P3. No runbook line for "the fuel feed stopped".** Freshness is computed
  (`efs/routes/feedFreshness.ts`); who is told, and what they do, is not written down for this
  feature.

## 8. Open questions for the owner (§4.8)

See `PLAN.md` §Owner questions. They are about who owns the queue, whether money findings that
cannot be recovered stay a queue, card-status messages, and the hidden tools.

---

## Evidence index

- Production queries: run through `supabase db query --linked` on 2026-10-06 between 23:30 and
  00:30 UTC. The counts above are their results.
- Screenshots (not committed; regenerate with a `VITE_DEV_BYPASS=true` build + `vite preview`):
  `fuel-log`, `fuel-log?tab=declines`, `fuel-log?tab=source`, `fuel-cards`,
  `settings/card-control`, `settings/efs-soap`, `findings`, `anomalies`, `settings/thresholds`,
  `recall-audit`, `coverage`, `reefer-coverage` at 1440 and 390 px.
