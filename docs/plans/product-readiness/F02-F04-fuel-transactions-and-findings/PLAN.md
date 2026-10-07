# F02 + F04 plan — fuel transactions, cards, findings and alerts

**Status:** BUILDING. Step 1a merged (#1328, 0435 on staging); 1b (the writer) in review. Q-F5 and Q-F6 open.

Findings are in `AUDIT.md` (IDs U, N, W, S, A, D, P). This plan does not copy the approved
card-fraud plan (`docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md`, D-CF1..9). It puts that plan's
remaining phases in order with this feature's other fixes.

---

## Owner questions

**Q-F1. Who owns the fuel-security queue? RULED 2026-10-06: (a), Miroslav Jokovic.** Nobody has acted on an alert since 08-14, and 0 of
158 money findings are assigned (AUDIT §0.7).
- (a) One named person reviews alerts and findings every working day. Everything is assigned to
  them by default.
- (b) Each truck's dispatcher reviews their own trucks.
- (c) Nobody reviews. The product only notifies on card fraud, and the queue is removed.
- **Recommendation: (a).** Name the person. One owner and one short daily list is the only shape
  that has a chance with today's 1-of-12 weekly sign-ins. This also answers Q-PR3 for F02 + F04:
  the task walk is done with Miroslav.

**Q-F2. Money findings nobody can recover: keep them in a queue? RULED 2026-10-06: (a).** 138 of 157 open findings are
buying habits (avoided state, out of network, avoided brand), worth ≈ $19.5k. No vendor credits
them (AUDIT §0.6, N8).
- (a) Move them out of the queue into Fuel Costs (F03) as a monthly "buying habits" report, per
  driver and truck. The queue keeps only what can be disputed: invoice mismatch and paid above
  Pilot's quote.
- (b) Keep them in the queue, with a "Talked to the driver" close action.
- **Recommendation: (a).** A queue item with no possible action is noise, and the totals then
  mean what they say.

**Q-F3. Card status messages (1,422 in 30 days, 17% read). RULED 2026-10-06: (a).** Cards go HOLD around 8–10 am CT
and back to ACTIVE in the afternoon, on 108 cards in 10 days (AUDIT W8, D4).
- (a) Stop the per-change message. Send one daily summary, and send an immediate message only
  for a card made ACTIVE outside working hours or marked FRAUD.
- (b) Keep per-change messages, but only to one named person.
- (c) Keep as is.
- **Recommendation: (a).** Also: is the daily HOLD/ACTIVE rhythm someone in the office, or an
  EFS rule? You will know; the data can't tell. *(Still unanswered; Step 3 does not depend on it.)*

**Q-F4. Tools with no user: hide them from the sidebar until someone needs them? RULED 2026-10-06: as recommended.** Recall audit
(never used), Card control "check" (an engineering tool), Anomaly thresholds, Detection coverage,
Reefer coverage. Use the Q-PR2 method (surface grants, nothing retired).
- **Recommendation: hide all five for every role except admin.** The admin can still reach
  them by URL.

**Q-F5. Which day does a fill belong to? OPEN.** EFS's date (`tran_date`), or the station's local
date (`business_date`)? Pages and finance disagree on 41 fills since 08-01, one of them across a
month ($639.24, AUDIT N3).
- (a) EFS's date everywhere. It matches the EFS statement and McLeod.
- (b) The station's local date everywhere.
- **Recommendation: (a).** Reconciling with EFS and McLeod is the point. A station-local time
  can still show beside the date.
- *2026-10-06:* the owner answered "this is regulated by permissions". The question is not about
  who may see a fill. It asks which calendar date a fill is counted on when the two dates differ.
  Re-asked in plain words.

**Q-F6. The "Log fill-up" button (used 0 times in 17,955 fills). OPEN, re-asked in plain words.**
- **Recommendation:** move it into the page's "…" menu. Do not remove it; cash fills may need it
  one day.

---

## Rulings already given (2026-10-06, "proceed as proposed")

- **Q-PR1:** F02 + F04 first, as one audit (this folder).
- **Q-PR2:** hide Tier C from the sidebar through the existing surface grants (`startsOnFor` /
  section). Retire nothing.
- **Q-PR4:** build X1 (page-view count) early.
- **Q-PR3:** still open. Q-F1 asks it for this feature.

---

## The PRs, in order

Each PR is small and merges on its own. A migration number is picked only right before merge,
after checking the NAME on `origin/main`. A column and its first reader ship in separate merges.

### Step 0 — this PR (docs only)
AUDIT.md + PLAN.md. FEATURE-INVENTORY.md §6 and its Log record the Q-PR1/2/4 rulings.
- **Accept:** `lint:release-train` and `lint:comment-claims` pass, and CI is green.

### Step 1 — X1, page-view count (cross-cutting, ruled Q-PR4)
Two merges, because staging can serve code before the migration applies: **1a** the table and
`record_surface_views` (0435) with its matrix; **1b** the API route and the router hook that call
it. The day is the org's calendar day (`todayInZone`), and the role comes from the server's auth
check, never from the browser.
A daily count per surface key and role, with no user id and no query string. Written from the
router's after-each hook through one small API call, batched.
- Needs a new table with RLS, an entry in `scripts/table-modules.json`, and an owner module of
  `org`.
- **Accept:**
  - A matrix pins (surface, role, day) as unique, so a second view adds to the count instead of
    adding a row.
  - A unit test proves no path or query string is stored.
  - After one day on staging, the fuel pages show counts.

### Step 2 — Q-PR2, hide Tier C (cross-cutting)
Set the surface grants for Hazmat, Inventory, Messages, driver-app duty and Ask AI so the sidebar
does not show them. Same mechanism, no new code path.
- **Accept:** `SidebarPreview` for each role no longer lists them. Each URL still opens for admin.

### Step 3 — stop the card-status flood (after Q-F3)
In `efsCardStatusPoll.ts`, send the per-change message only for the cases Q-F3 names. Add one
daily summary through the existing digest. Name the card by **truck and driver**, with the last
four digits second (N7).
- **Accept:**
  - Replaying the 10-05 production change list in a test sends ≤ 1 summary per recipient, plus
    0 immediate messages.
  - A FRAUD transition still sends immediately.
  - The title names the truck.

### Step 4 — card fraud CF2, rebuilt from main (D-CF1, D-CF2)
Rebuild #1216's incident fold and table **from current main**. Do not merge #1216: it carries
migration 0410 and deletes the idle burn-rate code. Then close #1216 with a link.
- **Accept:** the card-fraud plan's own CF2 check. The PGlite matrix and unit tests pin the 5
  real cards (7 incidents) and the 4 proximity rows that must NOT open one.

### Step 5 — CF5, approved-fill rules become notes (D-CF3, D-CF4)
Weights in `catalog.yaml` (`pnpm gen:rules`), with a `SCORING_VERSION` bump. Only
`tank_fill_short` stays a Review.
- **Accept:** re-scoring the last 60 days in a test gives 0 alerts from `tank_space_exceeded`,
  `odometer_mismatch` or `card_multi_vehicle`.

### Step 6 — CF0, the reset (D-CF9), as one audited act
Set the detection epoch and retire the 81 open cases per Q-CF1. Also fix AUDIT A3: a rebuild must
never delete a case a person has touched.
- **Accept:**
  - The Alerts page shows only cases on or after the epoch.
  - A matrix proves a rebuild leaves human-closed cases and their `anomaly_transitions` in place.
  - One audit row names the actor, the epoch and the counts.

### Step 7 — one fuel-security inbox, one sidebar group (W1, after Q-F1 and Q-F2)
"Findings" and "Alerts" become one page under FUEL, called **"Fuel problems"** (wording to
confirm). It lists card-fraud incidents, `tank_fill_short` reviews and disputable money
findings. Every item opens its own drawer on this page, so the theft-case click that does
nothing for a dispatcher goes away. Default owner per Q-F1. The old paths redirect.
- **Accept:**
  - Each role in the matrix opens every row it can see.
  - Closing an item takes ≤ 3 clicks.
  - The open count on the page equals the dashboard's.

### Step 8 — move buying habits to Fuel Costs (after Q-F2 = a)
The three habit kinds leave the queue and become a monthly table in F03's Fuel Costs, per driver
and truck. The Findings tiles become **Can be disputed / Disputed / Credited back**, over
disputable kinds only.
- **Accept:**
  - The tile total equals the sum of the disputable rows, to the cent.
  - The habits report total for September equals the sum of those `fuel_exceptions.amount`
    values for September.

### Step 9 — numbers on the Fuel Log (N5, N6, N9)
- "Flagged" counts fills with an **open** case and links to them. A cleared fill is not
  "needs review".
- Add an **Amount** column (`total_cost`), and format Gallons.
- Every tile shows "—" and "Not available" while loading or on error, never $0 or 0. This
  applies on Findings too.
- **Accept:** a test with a dismissed case shows Flagged = 0, and a failed totals query renders
  "—".

### Step 10 — one day for a fill (N3, after Q-F5)
Fuel pages, exports and the finance tie-out use one date definition, from `packages/shared`.
- **Accept:** the September total on the Fuel Log equals the EFS line total for September
  ($1,317,898.79 by `tran_date`, if Q-F5 = a).

### Step 11 — wording pass (W2–W7)
- Remove repo paths, environment-variable names and engineering words from all eleven pages.
- Fix the Fuel Log tab texts (the data is fetched, not uploaded).
- Use MM/DD/YYYY in the Findings scope line.
- Turn decline errors into plain reasons, with the vendor text in the hover.
- Replace the Alerts segmented buttons with `AppTabs`, or remove them.
- One plain sentence per page header.
- **Accept:** a reviewer reads every label aloud as a non-native speaker. `lint:date-format`
  passes. No string contains `docs/`, `_MINUTES` or "anomaly engine".

### Step 12 — hide the unused tools (after Q-F4)
Surface grants for Recall audit, Card control check, Thresholds, Detection coverage and Reefer
coverage, per Q-F4. "Log fill-up" moves to the menu (Q-F6).
- **Accept:** `SidebarPreview` per role, and each URL still opens for admin.

### Step 13 — tests and coverage pages (A2, N10)
- A behaviour test for `POST /api/anomalies/:id/transition`: org scope, version conflict, a role
  without `safety: manage` refused, and the audit row. Mutate the org filter and watch it fail.
- Move the two coverage pages' sums into SQL, only if Q-F4 keeps them visible.
- **Accept:** the mutation turns the test red, and the coverage numbers equal the SQL to the
  unit.

### Step 14 — reconcile with an outside source, and the runbook line (N1, N2, P3)
- When F14 refreshes the McLeod FUEL sweep, tie September's card fuel to McLeod GL FUEL and
  record the difference here.
- Add one runbook line to `docs/DEPLOYMENT.md`: "EFS feed older than 2 hours: who is told, what
  to check."
- **Accept:** the difference is recorded in this plan's log, with an explanation of any gap
  over $50.

### Then — the task walk (definition of done)
The person named in Q-F1 does the top tasks (AUDIT §3) without help, while X1 counts. The
feature is DONE when every AUDIT finding is fixed, ruled won't-fix, or moved by name.

---

## Not in this plan (moved, by name)

- McLeod FUEL sweep freshness (D3, N2) → **F14**.
- Buying-habits report design → **F03** (Step 8 only moves the data).
- Card-write machinery size (A1): no change while card control has a user. Revisit if Q-F4 hides
  it.
- `fuel_cards.status` vs `efs_cards.status` (A4): traced to a screen first. A fix only if a page
  reads the wrong one.
- "Finance job failed" alarm cause (D2): stopped 09-30. Reopen if it returns.

---

## Log

- 2026-10-06: Audit measured and written (AUDIT.md). Plan drafted. Waiting on Q-F1..Q-F6.
  Q-PR1/2/4 rulings recorded in FEATURE-INVENTORY.md.
- 2026-10-06: Owner ruled Q-F1 (a): Miroslav Jokovic owns the queue. Also ruled Q-F2 (a), Q-F3 (a)
  and Q-F4 as recommended. Q-F5 and Q-F6 were re-asked in plain words.
- 2026-10-07: Step 1a built: `surface_page_views` + `record_surface_views` (0435), matrix
  `surface-page-views.test.mjs` (21 checks; four mutants each turn it red), RLS hand-seed added.
- 2026-10-07: Step 1a merged (#1328); `migrate-staging` applied 0435, production waits for the release.
  Step 1b built: `POST /api/page-views` (org + role from the token, day from the org's clock, unknown
  keys dropped), `lib/pageViews.ts` queue, router `afterEach`. Read the counts with
  `select day, surface_key, role, views from surface_page_views where org_id = … order by day desc`.
