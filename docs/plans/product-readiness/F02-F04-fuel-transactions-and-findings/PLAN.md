# F02 + F04 plan — fuel transactions, cards, findings and alerts

**Status:** BUILDING. Step 1 (X1) is DONE on staging (#1328, #1330). Chunk 2a (Hazmat, Messages)
is merged (#1337); Inventory (2b) waits on Q-F7. Chunk 3 is merged (#1339, #1340, #1341); release
3a–3c together. Chunk 4 (migration 0437) is merged. Chunk 5a (the incident fold) is built.

Findings are in `AUDIT.md` (IDs U, N, W, S, A, D, P). This plan does not copy the approved
card-fraud plan (`docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md`, D-CF1..9). It puts that plan's
remaining phases in order with this feature's other fixes.

---

## Rulings

- **Q-F1. Who owns the fuel-security queue? RULED 2026-10-06: Miroslav Jokovic.** He reviews
  alerts and findings, new items are assigned to him by default, and the task walk is done with
  him. This answers Q-PR3 for F02 + F04.
- **Q-F2. Money findings nobody can recover: RULED 2026-10-06: they leave the queue.** The 138
  buying-habit findings (avoided state, out of network, avoided brand; ≈ $19.5k) become a monthly
  report in Fuel Costs (F03). The queue keeps only what can be disputed: invoice mismatch and
  paid above Pilot's quote.
- **Q-F3. Card status messages: RULED 2026-10-06: one daily summary,** plus an immediate message
  for FRAUD and for a change made outside office hours.
  - *Who changes the cards, measured 2026-10-07:* 245 external changes since 09-30. 237 of them
    (97%) fall Monday–Friday, 7 am–6 pm Central. 8 do not, and none was FRAUD. The status poll ran
    around the clock (last 7 days: 773 polls at night and 592 at weekends, all `done`), so
    nothing was missed off-hours. Only 15 of 106 "now ACTIVE" changes were followed by a fill
    within 4 hours.
  - So the changes are people in the office working in the WEX portal during the day, not an EFS
    rule and not "unlock for one fill". Office hours are Mon–Fri 07:00–18:00 in the org's zone.
- **Q-F4. Unused tools: RULED 2026-10-06: hidden for every role but admin.** The tools are Recall
  audit, Card control check, Anomaly thresholds, Detection coverage and Reefer coverage. They
  are hidden through surface grants, and nothing is retired.
- **Q-F5. Which day a fill belongs to: DECIDED 2026-10-07 on the owner's instruction to analyze
  and solve: EFS's day, which is Central time.**
  - EFS's guide: "All our servers are central time" (p. 10). Reject `tranDate` is "Central Time
    zone" (p. 107), and `serverTime` is "based on the Central Time zone" (p. 133).
  - *Measured, September:* for 856 fills at stations outside Central, EFS's time read as Central
    lands on the Samsara-confirmed fueling moment (median 0 minutes off). Read as the station's
    zone, it is 60 minutes off.
  - *Measured, 08-01 → 10-05:* `(fueled_at at time zone 'America/Chicago')::date` equals EFS's
    `tran_date` on **4,601 of 4,601** fills. Today's `business_date` (the station's own date)
    differs on 42.
  - D-FUI11 (0287) chose the station's date as "the day EFS prints". The measurement shows EFS
    prints the Central day, so this change carries out D-FUI11's stated intent rather than
    reversing it.
  - The station's own clock time still shows, in the row's hover (F-H2).
- **Q-F6. The "Log fill-up" button: DECIDED 2026-10-07 on the same instruction: removed, together
  with the browser's write access to fills.**
  - Used 0 times in 17,955 fills.
  - Cash fuel is already keyed in McLeod (fuel-tax receipts, IP6, 0434) and reaches IFTA from
    there. A second door for the same receipt is a second source of truth.
  - The button writes **from the browser straight into `fuel_transactions`**
    (`useCreateFillUp.ts:54`), so no audit row is written.
  - The same database policies (`ftxn_insert`, `ftxn_update`, `ftxn_delete`) let an admin or fleet
    manager change or delete any EFS fill from the browser, without a trace. No app code uses
    update or delete.
  - If hand entry is ever needed, it returns as an audited API route.
- **Q-PR1, Q-PR2, Q-PR4** (2026-10-06): F02 + F04 first; Tier C hidden through surface grants;
  X1 built early (done).
- **Q-F8. How chunk 4 guards reviewed alerts: RULED 2026-10-07 (a), a migration.**
  - *Measured on production, read-only, 2026-10-07:* 416 alerts carry a human status change. All
    311 reviewed 07-01 → 08-05 are gone; all 105 reviewed from 08-06 on exist. The old scoring
    deleted and re-created cases; 0156/0158 (early August) replaced it. Today no code deletes an
    alert, and re-scoring only supersedes OPEN cases.
  - Correction to AUDIT A3: `anomaly_transitions` starting 08-09 is the day 0158 created it, not
    evidence of deletion. The 311 cannot be restored; `audit_logs` still says who changed each.
  - The door left open: deleting a fill cascades to its alerts, and the browser holds a fill
    delete policy (Q-F6). Nothing in the database refused it.
  - (a) chosen: a trigger refuses deleting an alert a person touched. (b) rejected: rely on
    chunk 12 alone, which leaves no database rule.
- **Q-F7. Inventory lives on the Shop page. OPEN (asked 2026-10-07).** Hiding Parts, Assets and
  Units is easy. But the Shop page (`/shop`) is the inventory home: Scan, Count shelf, Low stock,
  Short of kit, and "No parts on shelves yet". Only its Repair spend tile is not inventory.
  - Scan and Labels are inventory screens (they read stock lines, assets and shelf labels). They
    sit under the Shop page's key (`maintenance.repair-spend`), not under Parts.
  - The Repair spend ledger (F15, Tier B, not hidden by Q-PR2) sits under the same key.
  - Production stores no answer for any of these keys (checked 2026-10-07).
  - **(a) Recommended: hide the Shop page too.** Scan, Labels and the Repair spend ledger go with
    it. The Maintenance group then shows Annual inspections and Inspectors. An admin grant on Shop
    brings all of it back.
  - (b) Hide Parts, Assets and Units only. Shop stays, and shows an empty inventory page whose
    buttons are gone. Not recommended: a page that looks broken.
  - (c) Give the Repair spend ledger its own sidebar entry, then hide Shop. Keeps the ledger
    visible, but adds a sidebar row and a new key: its own small PR.

---

## How the work is cut

Each chunk is **one PR with one purpose**. Rules for every chunk:
- It is reviewed and merged before the next one starts.
- A schema chunk ships alone, and the code that uses it comes in the next chunk (the deploy
  window).
- A migration number is chosen right before merge, after checking the NAME on `origin/main`.
- Each chunk proves that its tests fail when its rule is broken (a mutation, recorded in the PR).
- Production gets a chunk only in a release you approve.

**Order and why.** Chunks 2–3 stop the noise people see today. Chunk 4 must come before chunk 6:
re-scoring history would otherwise delete reviewed alerts again (AUDIT A3).

### Done
- **1a** `surface_page_views` + `record_surface_views` (0435), #1328.
- **1b** `POST /api/page-views` + router hook, #1330. Counts are visible on staging.

### Chunk 2 — hide Tier C (Q-PR2)
Surface grants for Hazmat, Inventory, Messages, driver-app duty and Ask AI. No new code path.
- **Accept:** `SidebarPreview` per role no longer lists them, and each URL still opens for admin.
- **2a, built:** Placard calculator, Hazmat review and Messages get `startsOnFor: []`. Ask AI had
  it since 09-30. A detail page now starts the way its parent starts, so `/hazmat/loads/:id` hides
  with Hazmat review. Test: `tierCSurfaces.test.ts`; five mutants each turn it red.
- **2b, waiting on Q-F7:** Inventory (Parts, Assets, Units, and the Shop page question).
- **Driver-app duty: no switch exists, and none is built here.** The driver app's feature list
  (`featureCatalog.ts`) says the duty flow is core and "can never be remote-disabled", on purpose:
  a settings mistake must not stop a driver's day. It has no web sidebar entry either. Hiding it
  needs a new decision, not a grant.
- **The API does not ask these screens' grants.** Only Ask AI's endpoint asks `requireSurface`.
  Hazmat and Messages endpoints still ask the section, as before; the sidebar and the address bar
  follow the grant. Messages' endpoints also serve drivers, so a screen grant must not be added
  there without care. Hiding was the ruling, so the API is unchanged.

### Chunk 3 — card status messages (Q-F3)
- **3a** Per-change messages are sent only for FRAUD, or for a change detected outside office
  hours in the org's zone. Every change keeps its audit row.
  - Accept: replaying 10-01 → 10-06 from `audit_logs` (237 changes) in a test sends exactly the
    5 off-hours changes immediately, not one message per change per person (1,422 in 30 days). A FRAUD change sends immediately at noon on a Tuesday.
  - Built: `cardStatusUrgency.ts` (shared) decides; the status poll asks it. The replay holds all
    237 recorded changes and sends exactly the 5. Office hours are a constant, not
    `organizations.operating_hours`: that column is when the trucks run, and the real fleet's is
    24/7, so read as office hours it would have sent nothing. Only the zone comes from it.
  - ⚠ Until 3b ships, a daytime change has its audit row and no message at all. Ship 3a and 3b
    in the same release.
- **3b** One daily summary per fuel manager: "Yesterday 23 cards went on hold and 19 came back",
  with the cards listed by truck. It goes through the existing digest, not a new scheduler.
  - Accept: exactly one per recipient per day, and none on a day with no changes.
  - Built: `cardStatusSummary.ts` (shared: the words; efs: read and send). **It rides the status
    poll, not the weekly digest.** The digest is a weekly AI-written email to the org's addresses,
    not a daily message per person. It also lives in `org`, which `efs` already imports, so calling
    the card code from it would close a cycle. "No new scheduler" still holds: the poll runs every
    5 minutes and the summary runs at its end, between 07:00 and 12:00 on the org's clock.
  - Once a day per person: the key `card_status_summary:<day>` sits in the dedupe ledger (0432),
    which keeps a key per person forever. No migration.
  - It lists each card as "Truck 887 · driver · ••••1234" (EFS's own unit and driver, known for
    about half the cards), the shape 3c will reuse for titles.
- **3c** Titles name the truck and driver first, and the last four digits second (N7: 246 of 309
  cards share their last four with another card).
  - Accept: a test with two cards ending in the same four digits produces two different titles.
  - Built: `cardStatusChangeMessage` (shared) names the card with 3b's `cardLabel`, and the states
    in plain words ("On hold", "Fraud hold"). The truck and driver come from the roster row the poll
    already read, so no extra query. A card EFS knows no truck or driver for still reads "••••7977"
    (about half the cards).

### Chunk 4 — a rebuild never deletes a reviewed alert (AUDIT A3)
Rebuilds and re-scoring keep any case a person has touched, and its `anomaly_transitions`.
- **Accept:** a PGlite matrix runs a rebuild over a human-closed case. The case and its
  transitions survive, and removing the guard turns the matrix red.
- Built (Q-F8 (a)): migration 0437, a BEFORE DELETE trigger on `anomalies`. Refused: a case that
  is investigating, resolved or dismissed, has a disposition, or has a transition. A fill delete
  that would cascade onto one fails whole. Allowed: an untouched open or superseded case, and
  deleting the organization. Production: 2,041 rows protected, 250 not.
  Matrix `reviewed-alerts-guard.test.mjs` (29 checks); removing the guard turns 15 red.

### Chunk 5 — card fraud incidents (CF2, D-CF1/D-CF2), rebuilt from main
#1216 is closed with a link, never merged: it holds migration 0410 and deletes the idle code.
- **5a** Pure fold in `packages/shared` + unit tests. Five real cards → 7 incidents. The 4
  proximity rows open none.
  - Built: `cardFraud.ts` (shared). The fold decides D-CF1 itself: Samsara says the truck was away
    (`false`, not unknown), and no fill explains it. So the four proximity rows reach the fold and
    open nothing; they are not filtered out before it.
  - *Measured on production, read-only, 2026-10-07:* 13 declines in 09-02 → 10-02 kept
    `location_mismatch`, on 5 cards; the fold makes 7 incidents and 8 messages (7 openings, 1
    escalation) instead of 13 alerts. The four proximity rows (Avoca, Vandalia, Bowman, Corbin) had
    Samsara placing the truck at the station; the plan's "Gretna" and "Effingham" are where their
    follow-up fills were (85 and 7 minutes later).
  - ⚠ Card …07967 (truck 555) was tried again on **10-05**: Jacksonville twice and Baldwin, FL. Its
    third incident; the fold reads it as one opening and one new place.
  - Two choices beyond D-CF2's text: an approved fill where the truck is not escalates (fuel was
    lost; otherwise a fill at a place already in the incident would tell nobody), and a "repeat at
    the same place" needs a 6-hour gap (EFS writes one pump try as 2–3 rows in the same minute; the
    real returns were 11 h and 19 h later). The unit-number prompt is not an escalation: it is the
    everyday typo.
  - Sixteen mutants, each red; one first survived (an escalated incident falling back to "alert")
    and the test was strengthened.
- **5b** Migration: `card_fraud_incidents` with RLS and its matrix.
- **5c** The decline and fill scorers write incidents.
- **Accept:** each part's own tests, plus the card-fraud plan's CF2 check.

### Chunk 6 — approved-fill rules become notes (CF5, D-CF3/D-CF4)
`catalog.yaml` weights, `pnpm gen:rules`, and a `SCORING_VERSION` bump. Only `tank_fill_short`
stays a Review.
- **Accept:** re-scoring 60 days in a test raises 0 alerts from `tank_space_exceeded`,
  `odometer_mismatch` or `card_multi_vehicle`.

### Chunk 7 — the reset (CF0, D-CF9), one audited act
Set a detection epoch, and retire the 81 open cases per Q-CF1.
- **Accept:** the Alerts page shows only cases on or after the epoch, and one audit row names the
  actor, the epoch and the counts.

### Chunk 8 — one fuel queue with a default owner (Q-F1, W1)
- **8a** Schema: an org setting for the fuel queue owner. A new item is assigned to that person.
  Migration alone.
- **8b** Set it to Miroslav, and assign the open items to him (an audited act).
- **8c** One page, **"Fuel problems"**, under FUEL. It lists card-fraud incidents,
  `tank_fill_short` reviews and disputable money findings. Every row opens its own drawer on
  that page, so the theft-case click that does nothing for a dispatcher goes away. The old paths
  redirect.
- **Accept:**
  - Each role in the matrix opens every row it can see.
  - Closing an item takes ≤ 3 clicks.
  - The open count on the page equals the dashboard's.

### Chunk 9 — buying habits move to Fuel Costs (Q-F2)
- **9a** A monthly buying-habits table in Fuel Costs, per driver and truck.
  - Accept: September's total equals the sum of those `fuel_exceptions.amount` values, to the
    cent.
- **9b** The three habit kinds leave the queue. The tiles become **Can be disputed / Disputed /
  Credited back**.
  - Accept: the tile total equals the sum of the disputable rows.

### Chunk 10 — one day for a fill (Q-F5)
- **10a** Migration: `fuel_business_date` reads EFS's clock (`America/Chicago`, named as EFS's
  clock, not as the org's). Backfill the 42 moved fills and rebuild the spend days they touch.
  - Accept: a matrix pins a Nevada fill at 22:12 local on 09-30 to 10-01. In production, every
    fill's `business_date` equals its EFS `tran_date`.
- **10b** The Fuel Log's "When" shows office time, with the station's time in the hover. The
  footnotes "the day of the fill at the station" and "Central time" become one sentence on every
  tab.
  - Accept: September on the Fuel Log equals EFS's September line total (fuel lines, $1,317,898.79).

### Chunk 11 — Fuel Log numbers (N5, N6, N9)
- **11a** "Flagged" counts fills with an **open** case and links to them.
  - Accept: a fill whose case was dismissed is not counted.
- **11b** An **Amount** column, and Gallons formatted.
- **11c** A tile shows "—" and "Not available" while loading or on error, never $0, on the Fuel
  Log and on Findings.
  - Accept: a failed totals query renders "—".

### Chunk 12 — remove the browser's write door on fills (Q-F6)
- **12a** Remove "Log fill-up", `FillUpForm` and `useCreateFillUp`.
  - Accept: no web code writes `fuel_transactions`, and `table-writers.json` loses the entry.
- **12b** Migration: drop `ftxn_insert`, `ftxn_update` and `ftxn_delete`. Reads are unchanged.
  - Accept: the RLS matrix shows a fuel manager's browser insert, update and delete on a fill all
    refused, while the API's service-role writers still work.

### Chunk 13 — hide the unused tools (Q-F4)
Surface grants for the five tools, as chunk 2.
- **Accept:** `SidebarPreview` per role, and each URL still opens for admin.

### Chunk 14 — wording, one page group per PR (W2–W7)
- **14a** EFS integration and Card control settings: no repo paths, environment-variable names
  or test vocabulary.
- **14b** Fuel Log tabs and Declines: the data is fetched, not uploaded, and decline errors read
  as plain reasons, with the EFS text in the hover.
- **14c** Alerts and Findings leftovers not covered by chunk 8: MM/DD/YYYY scope lines, and
  `AppTabs` instead of hand-made buttons.
- **Accept, each:** a reviewer reads every label aloud as a non-native speaker, and
  `lint:date-format` passes. No string contains `docs/`, `_MINUTES` or "anomaly engine".

### Chunk 15 — alert transition test (A2)
A behaviour test for `POST /api/anomalies/:id/transition`: org scope, version conflict, a role
without `safety: manage` refused, and the audit row.
- **Accept:** mutating the org filter turns it red.

### Chunk 16 — reconcile with an outside source, and the runbook line
- When F14 refreshes McLeod's FUEL sweep, tie September's card fuel to McLeod GL FUEL and log the
  difference here.
- Add one line to `docs/DEPLOYMENT.md`: "EFS feed older than 2 hours: who is told, and what to
  check."
- **Accept:** any gap over $50 is explained in this log.

### Then — the task walk (definition of done)
Miroslav does the top tasks (AUDIT §3) without help, while X1 counts. The feature is DONE when
every AUDIT finding is fixed, ruled won't-fix, or moved by name.

---

## Not in this plan (moved, by name)

- McLeod FUEL sweep freshness (D3, N2) → **F14**.
- Buying-habits report design → **F03** (chunk 9 only moves the data).
- Card-write machinery size (A1): no change while card control has a user.
- `fuel_cards.status` vs `efs_cards.status` (A4): trace it to a screen first, and fix it only if a
  page reads the wrong one.
- "Finance job failed" alarm cause (D2): stopped 09-30. Reopen if it returns.
- Coverage pages computing in the browser (N10): won't fix while chunk 13 hides them. Reopen if
  they are shown again.

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
- 2026-10-07: Step 1b merged (#1330, 50525f0); staging serves it (`verify:live staging` matches).
- 2026-10-07: The owner asked for the open questions to be analyzed and solved. Q-F5 was decided
  as EFS's Central day (guide pp. 10, 107, 133; 4,601 of 4,601 fills match), and Q-F6 as removing
  the button and the browser's write policies. The Q-F3 pattern was measured: office staff, office
  hours. The plan was re-cut into single-purpose chunks; the A3 guard moved ahead of re-scoring.
- 2026-10-07: Chunk 2a built: Hazmat and Messages start off for every role but the admin, and a
  detail page starts as its parent does. Production stores no answer for any Tier C key, so this
  holds for every org. Inventory waits on Q-F7 (the Shop page is the inventory home). Driver-app
  duty has no switch by design.
- 2026-10-07: Chunk 2a merged (#1337, 2d04392); staging serves it. Q-F7 asked.
- 2026-10-07: Chunk 3a built: only FRAUD or an off-hours change is messaged at once. Replay of
  10-01 → 10-06 (237 changes from `audit_logs`) sends exactly the 5 off-hours ones. Seven
  mutants, each red (two first survived and the tests were strengthened: the weekday case needs a
  zone ahead of UTC, and a no-op mutant was replaced).
- 2026-10-07: Chunk 3a merged (#1339, ede9269); staging serves it.
- 2026-10-07: Chunk 3b built: one summary per fuel manager per day, on the status poll rather than
  the weekly digest (reasons in chunk 3b). A replayed morning of polls sends one per person. Seven
  mutants, each red; the UTC-day one first survived, because in Chicago the send window never
  crosses a UTC date, so a Tokyo case was added.
- 2026-10-07: Chunk 3b merged (#1340, 9f31966); staging serves it.
- 2026-10-07: Chunk 3c built: the urgent message title is "Truck 887 · driver · ••••7977 is now On
  hold". Two cards ending 7977 give two titles. Three mutants, each red.
- 2026-10-07: Chunk 3c merged (#1341, 7f575e7); staging serves it. Chunk 3 is complete.
- 2026-10-07: Chunk 4 measured: no reviewed alert lost since 08-06; the 311 lost were the old
  scoring. Owner ruled Q-F8 (a). Built migration 0437 and its matrix; five mutants, each red
  (removing the org exception refuses the org delete, which proves the cascade sees the org gone).
- 2026-10-07: Chunk 4 merged (#1344) and released (v2026.10.07.1). Chunk 5a built: the card fraud
  incident fold, from main (#1216 read for ideas only). The 13 declines of 09-02 → 10-02 fold into 7
  incidents; the four proximity rows open none. Card …07967 was tried again on 10-05.
