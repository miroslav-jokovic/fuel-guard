# McLeod vs Silvicom360-TMS — video comparison brief

**Updated:** 2026-10-27

**Purpose:** Give the video team verified, appropriately qualified material about maintenance,
accounting and billing in McLeod LoadMaster against the separate `SILVICOM360-TMS` project. This is
a dated video brief, not a replacement for either project's specifications or a claim that the
sandbox or new TMS is production-ready.

## Executive readout

McLeod does contain maintenance-related money: a 15-account maintenance-and-tires GL family with
monthly net totals and postings through AP, driver settlements and other modules. It does not
evidence a FleetPal-style shop work-order record in the inspected SQL snapshot. Billing history is
already unusually useful at truck/driver level; general-ledger lines themselves are not truck-coded.

`SILVICOM360-TMS` is a separate, actively developed replacement—not the already-running
FuelGuard/Silvicom 360 application. Its strongest advantage is a design direction: operational facts
and money posting through one controlled ledger, with repair attribution and invoice provenance
made explicit. Some core code exists, but the full Shop, Payables, Settlements, reporting and
production cutover remain planned work. The video should sell that destination without presenting
queued features as live or claiming McLeod lacks documented features it already offers.

The strongest truthful video message is therefore: **Silvicom 360 connects operating and financial
facts, shows what is supported by source data, and makes missing attribution or reconciliation
visible instead of inventing it.** Do not imply that McLeod contains FleetPal's shop workflow, that
the GL knows cost per truck, or that unlike financial lifecycle rows can be summed as separate costs.

## What was inspected

- Read-only SQL inspection of `lme_analytics`, scoped to company `TMS`; no production `lme` queries
  and no McLeod writes.
- The sandbox is a frozen restore, most recently restored **2026-10-09 13:13 UTC**. Its latest
  observed billing date is 2026-10-09, GL date 2026-10-07, and settlement date 2026-10-09. This is
  newer than the September documentation, but it is still not live production data.
- Used the agent's read-only billing, expenses and ledger summaries, a direct aggregate of the 15
  signed maintenance GL accounts, a full table/column-name scan, and aggregate/table-metadata
  queries. No invoice descriptions, employee details or other row-level PII are included here.
- App status below is based on repository code, not a live production/staging read. Whether the
  current deployed service has ingested these exact sandbox rows was not checked.
- Read the sibling TMS repository's current handoff, feature register, project-state registry,
  specifications, accounting coverage audit and the actual launch-film script/render. The TMS
  checkout has a pre-existing local change in `apps/desktop/src-tauri/Cargo.toml`; it was left
  untouched.

**Correction from the previous draft:** I withdraw the `$202,006.31` “unclassified AP account”
claim. It was calculated from `voucher.ap_glid`, which repository documentation identifies as the
AP payable control account, not the expense account. It cannot classify maintenance spend.

## Findings

### Maintenance

**McLeod's maintenance money:** The 15 signed accounts in the repository's `maintenance` GL family
do record repairs and tires by month and posting module. Using that exact account list and summing
the GL's signed `net_amount` in this sandbox gave:

| GL billing month | Net maintenance-family amount | Lines |
|---|---:|---:|
| June 2026 | $234,170.16 | 402 |
| July 2026 | $265,633.05 | 355 |
| August 2026 | $141,538.84 | 212 |
| September 2026 | $520.70 | 1 |

September is only one line in this snapshot and must not be presented as a full-month total. July's
current sandbox total consists of $188,325.26 AP, $76,176.39 DRS, $1,061.73 OFF, $716.93 RJ,
$53.97 FUEL, and -$701.23 CASH.

**Important unreconciled difference:** the October 4 maintenance money-control plan reports the
existing Silvicom `mcleod_gl_totals` staging value for July as **$219,301.48**, including **$141,993.69
AP**. The direct July query against the sandbox restored October 9 gives **$265,633.05**, including
**$188,325.26 AP**; DRS is $76,176.39 in both. The **$46,331.57** difference is unresolved. These
measurements are from different snapshots/surfaces, so neither should be quoted in a video as the
current reconciled total until the source-to-staging variance is explained.

**What is not in the SQL evidence:** A full metadata scan found no dedicated maintenance work-order,
repair-job, shop, or tire-transaction table. `fuel_stop` has `minor_repairs` and `tire_repair`
catalog fields, but both are blank across the 4,253 `TMS` rows checked. `vcard_trx_history` has no
rows. The populated `servicefail` table is dispatch/stop service-failure data, not a shop work-order
ledger. This does not prove which McLeod modules are licensed or visible in its user interface.

**What Silvicom already does with this:** Code implements a FleetPal per-unit repair-cost surface and
a maintenance coverage endpoint that compares FleetPal invoice evidence against the McLeod GL
maintenance family. The July 2026 production measurement in the FleetPal plan was explicitly a
lower bound: “at least 58.2%,” based on 57 unambiguous invoice-number matches; 160 invoice numbers
matched no voucher and 4 of the 57 matched amounts disagreed. This is not a complete repair-money
reconciliation or a current sandbox ratio. The newer `MAINTENANCE-MONEY-CONTROL-PLAN.md` records
FleetPal payment/item collection as built, but as of its October 4 log the McLeod voucher-expense
and repair-deduction collection (C2/C3) and monthly four-way control (K1) were still unbuilt. M-1,
M-2, M-3, M-6 and M-11 were open; the October 4 handoff also listed the EFS check measurement
(M-5/C4) as next. Current production status was not verified.

**Where the maintenance story actually comes from:** The existing 24/7 Maintenance video uses
FleetPal data read on 2026-10-07: 3,220 completed work orders over Sep 2025–Aug 2026, the 15/75/46
open-queue counts, and $2.12M in net vendor PO invoices. Those are FleetPal measures, not McLeod
measures.

**Equipment attribution and AP risk:** The dated July staging analysis found that only 4 of 15
maintenance accounts name an equipment type; its estimate that **81.5% of spend was
equipment-blind** used the older $219,301.48 staged total, so it is not a current-sandbox
percentage. The current YTD sandbox query found no tractor or trailer values on any of 214,169
`gl_ledger` rows.
The staged AP voucher header has no expense dimension: `ap_glid` is the payable control account, not
the repair expense account. Prior analysis found unit-like text in voucher descriptions, but parsing
that text into a truck assignment is prohibited guesswork. The month-level GL family is useful;
neither the AP header nor the GL can supply a reliable truck-level repair cost by itself.

The FleetPal external invoice stream and McLeod AP/DRS can describe overlapping repair dollars.
The repository's October 4 plan treats matching as unfinished work, not an established duplicate
count. Do not add FleetPal totals to McLeod totals or claim they reconcile until the payment-level
control is built and the unresolved source/staging difference is explained.

**Video direction:** Keep maintenance operational workflow tied to FleetPal, and identify that
source on screen. Do not show exact McLeod monthly totals until each period has been checked against
current production staging; July already has an unresolved source/staging difference. Do not depict
McLeod as containing the FleetPal work-order, defect or preventive-maintenance workflow based on
this sandbox evidence.

### Accounting and expenses

**General ledger:** In the current snapshot, the 2026-01-01 through 2026-10-09 `gl_ledger` population
contained **214,169 lines and zero populated tractor fields**. The GL is useful as an accounting
control total; it cannot support a direct per-truck expense report without a separately approved
allocation rule.

**June 2026 AP and fuel sample:**

| McLeod slice | Rows | Value | What the data supports |
|---|---:|---:|---|
| Non-fuel AP voucher headers | 203 | $481,991.14 | All non-fuel AP in this window, not a maintenance total |
| Fuel-card AP vouchers | 35 | $1,010,966.35 | Overlaps the fuel-purchase lifecycle; do not add as a second fuel expense |
| Fuel purchase detail | 2,259 | $1,017,601.81 payable | Reconciled exactly to the fuel payable leg for this period |

McLeod records the same economic event in more than one place: an accrual, a payment, AP/GL
postings and, for fuel, the external card feed. The video should show one canonical cost plus its
reconciliation trail, not add every McLeod module total together. EFS remains the fuel-purchase
authority; McLeod fuel is useful for reconciliation and the reefer/DEF split.

**Do not treat the `expenses.mjs` AP `topAccounts` output as expense categories.** That code groups
voucher headers by `ap_glid`; the maintenance plan and integration contract identify `ap_glid` as
the AP control account. The earlier `$202,006.31` “unclassified” figure is therefore withdrawn and
must not appear in the video.

**Do not use “11% of costs covered” as a headline.** A legacy standalone ledger CLI reports module
throughput coverage, not the share of unique costs. It does not count the billing claim now present
in the API coverage implementation, and GL modules include multiple lifecycle views of the same
money. Its percentage is not a measure of missing costs.

### Billing and revenue

Billing is the best truck-level financial fact in this inspection:

- For bill dates 2025-09-01 through 2026-09-30 (query bound `2026-10-01`, exclusive), the sandbox
  returned **18,185 billing rows**, with no duplicate source IDs. **18,103** rows had a tractor and
  **18,103** had a driver. The only observed `canceled` / `rebilled` combination was `N` / `N` in
  this date window.
- For June 2026, all **1,640** billing rows had a `BILL` posting key/module; **1,639** had a tractor
  and **1,639** had a driver, and all 1,640 had `distance`. The separate loaded-distance and
  empty-distance fields were unpopulated/zero on all 1,640 rows.
- June billing summed to **$5,490,961.97 charges + $147,083.96 other charges = $5,638,045.93**.
  Applying the API's monthly/account-level one-sided GL calculation to the same sandbox rows gives
  **$5,216,145.58** for `BILL`, a **$421,900.35** difference on those respective measures. The
  legacy standalone CLI's daily grouping rounds to a different result ($5,216,145.70), so do not
  copy its figure into a video. Neither comparison is proof of an extraction defect: finance needs
  to confirm the amount definitions, account population and date basis before any revenue total is
  used as a claim.

**Correct use / traps:** Keep billing joined to the order's operations user for dispatcher
attribution. The tested alternative through movement dispatchers expands 1,640 bills to 3,408 rows
and nearly doubles the charges. Use the populated `distance` field where the report needs billed
miles; do not use `billing_loaded_distance` or `billing_empty_distance` in this sample. Preserve the
bill/posting date distinction, and keep taxes collected for government separate from carrier
revenue.

The codebase already has a McLeod billing extractor and billing/accounting read surfaces, including
the invoice lookup and billing activity. This session did not establish the freshness or completeness
of the deployed feed. For a product demonstration, show the invoice-to-order/truck/dispatcher
traceability, but label the data period and avoid presenting the June billing/GL difference as
reconciled.

## McLeod vs SILVICOM360-TMS

This comparison treats three things separately: measured McLeod data, TMS code that exists, and
the TMS target that is still queued. “In code” does not mean deployed, tested against McLeod, or
ready to cut over.

The TMS repository describes its phase as `implementing`, not production. Its generated registry
lists 11 modules; the current handoff identifies F01 and F28 as coded but still “verified pending
McLeod.” F21 Shop, the full Billing and Ledger features, Payables, Settlements, Reporting, and the
McLeod cutover work are not complete. The comparison below is therefore “incumbent now vs.
replacement design/current slice,” not two production systems. The handoff still lists hosting and
production operations as open; I did not inspect a deployed TMS.

| Area | McLeod today: evidence from this review | SILVICOM360-TMS: current state in its repository | Defensible advantage if delivered |
|---|---|---|---|
| Repair operations | Monthly maintenance-and-tires GL postings exist, but this SQL snapshot has no dedicated shop work-order ledger. The GL has no truck/trailer fields; the July source/staging total also differs by $46,331.57. | The native Shop, parts, truck inventory, maintenance purchasing and FleetPal history import are queued (F21, F47–F50). This is not in the current TMS code. FuelGuard's separate FleetPal maintenance surfaces are not the TMS Shop. | Link defect/PM → work order → parts/labour/vendor invoice → vehicle file → ledger posting. Show the McLeod monthly family as a control, not as job-level proof or a truck-cost figure. |
| Accounting | McLeod has a functioning GL and source ledgers. In the measured sample, GL rows carry no equipment dimensions, while AP voucher headers have no expense account dimension. The existing staging and sandbox disagree on July maintenance total. | A balanced, append-only Ledger kernel and dimension infrastructure exist in code; F28 is “verified pending McLeod.” The complete Ledger (F11), Payables (F15), Settlements (F14), Cash, and reporting (F30) remain queued. | Design a first-party posting trail with explicit dimensions, account mappings, period controls and reversals instead of inferring truck cost from an untagged GL. Do not promise truck/driver profitability until the posting rules and source coverage are complete. |
| Billing | The sandbox already contains customer invoices with strong vehicle/driver attribution: 18,185 rows across Sep 2025–Sep 2026, 18,103 with tractor and 18,103 with driver. McLeod vendor material also documents document-gated Rendition Billing; that is parity, not a unique TMS innovation. | F01’s narrow order→invoice→ledger slice is built in code but still “verified pending McLeod.” Full Billing (F10) is queued. | The designed distinction is an invoice artifact tied atomically to delivery, the rate version and a balanced Ledger posting, with immutable correction and explicit refusal reasons. This is not yet a full deployed replacement or a completed McLeod shadow comparison. |
| Integration and cutover | McLeod is the live operating system in the researched workflow. The sandbox is a snapshot, not a live mirror. | The TMS McLeod extract/import (F03) and cutover readiness (F17) are listed after the go-live block. The TMS repository says its own McLeod comparison is still owed. | The proposed replacement can be tested against the incumbent to the cent, but the film’s “before we switch” promise needs the roadmap to put that verification before cutover. Do not imply the TMS is currently connected to McLeod. |

### What “better” can mean without overclaiming

- **Best near-term proof point:** a single delivered order moves through the coded F01 slice to an immutable invoice and balanced ledger entry. Say “the slice is built; McLeod verification remains,” not “the whole billing department is replaced.”
- **Best maintenance distinction:** McLeod's measured SQL data exposes monthly repair-account totals, but not a shop work-order trail; the TMS roadmap proposes a native Shop and cost-posting chain. It is a future advantage until F21/F47–F49 are implemented and tested.
- **Best accounting distinction:** make provenance, dimensions, period state and mismatches visible. Avoid claiming McLeod cannot do a function unless the customer’s installed workflow and permissions were inspected.
- **No unsupported savings claim:** the July maintenance source/staging discrepancy and June billing/GL difference are unresolved; neither supports a percentage-savings promise.
- **A real trade-off:** the owner withdrew external accounting connectors (F36). “Own books” may suit a carrier choosing the TMS as its accounting system, but it is not an advantage for a buyer who requires QuickBooks/NetSuite/Dynamics/Sage synchronization.

**Video-safe positioning:** “McLeod already moves loads, bills customers and records the general ledger. Silvicom 360 TMS is being built to connect each operational event to an accountable invoice and ledger posting—and to show exactly what is still unmatched.” Then show a single order-to-invoice-to-entry path. Keep the maintenance improvement in future tense until Shop is built and its repair-money match has passed the McLeod comparison.

### Claims the launch film should not make yet

- McLeod lacks document-gated billing: the TMS specification cites McLeod’s own Rendition Billing as a market baseline.
- Every TMS accounting, AP, payroll, tax, maintenance, AI, reporting, bank or integration feature is live. Many related FEATURES rows are queued.
- Silvicom 360 TMS already produces full per-truck maintenance cost or has completed the McLeod to-the-cent comparison.
- Every figure universally requires two independent sources. The TMS requirements are for source lineage and controlled reconciliations where a valid control exists; a second independent source is not available for every fact.

## Review of the TMS launch film

The actual launch-film asset is
`/Users/miroslavjokovic/Projects/SILVICOM360-TMS/presentation/output/silvicom360-tms-launch-film-final.mp4`:
5:34, 1920×1080, 24 fps. Its SHA-256 matches `launch-film-v2.mp4`. The film brief marks v2
owner-approved and says any change is a v3. I reviewed its v2 script, source scenes and a frame
contact sheet; it is a polished, text-led leadership vision film, not a walkthrough of the running
application.

**Material fact drift from the current TMS project record:**

- The closing card and voice say **10 modules** and **15 July 2027**. The current generated project
  registry lists **11 modules**, and the current FEATURES/HANDOFF schedule lists **24 November
  2027**. Update these only as an owner-approved v3; the final v2 was deliberately left untouched.
- The project handoff says the accepted v2 is final and any change is a v3. The TMS repository is
  dirty in `apps/desktop/src-tauri/Cargo.toml`; I did not modify it or any TMS/video-project file.
- The voice repeatedly uses present tense for features that the current FEATURES register still
  queues: the full Shop, Payables, Settlements, bank connections, taxes, full reporting, AI,
  integrations and production readiness. This conflicts with the film brief’s own rule: “will” for
  unbuilt features and “is” only for what runs today.
- The “Built for Silvicom” scene uses FuelGuard’s live-feature list, but says those tools “will work
  hand in hand” with the TMS. The TMS handoff still lists the FuelGuard-overlap choice as an owner
  item; the recommended build-independent path is not a settled interface contract.
- “Before we switch, every figure will be checked against McLeod” conflicts with the current feature
  order: F03 (the full McLeod shadow extract) and F17 (cutover readiness) are listed after the
  go-live block, while F01 and F28 remain “verified pending McLeod.” Resolve the roadmap or revise
  that promise before the film is reused as a current status report.
- Scene 19 says a figure is trusted “only when two independent sources agree.” That overstates the
  ledger design and is not a universal rule in the TMS specifications. Safer: “Where an independent
  control exists, we compare it. When the sources disagree, we show the difference and its
  provenance.”
- The script file still labels v2 “draft” while the film brief calls the render final; the brief is
  the project’s authority for the accepted artifact.

The separate 3:58 `FuelGuard/output/maintenance-video/...Maintenance-Proposal.mp4` is a FleetPal
staffing/pilot proposal, not this TMS launch film. Its figures and recommendation should remain
clearly separate from McLeod and from TMS roadmap claims.

## Suggested product-video sequence

1. **Start with McLeod honestly:** show that the incumbent already handles loads, customer billing
   and a general ledger. In this carrier's sample, billing is well attributed to truck/driver; GL
   expense lines are not.
2. **Show the TMS difference as a build goal:** “From delivered order, to readiness check, to
   invoice and ledger posting—with the source, rate version and correction trail preserved.”
   Label F01 as implemented locally and still pending the McLeod verification.
3. **Use maintenance as the clearest future advantage:** “McLeod gives us a monthly repair-dollar
   control; the planned TMS Shop will connect the work order, unit, parts and posting.” Show no
   exact total until the source/staging mismatch is resolved and F21 is built.
4. **Close with honest status:** use the current module count and go-live date only after the
   owner approves a v3; say “being built” for queued modules. Do not present the current TMS as a
   deployed replacement or claim that every financial figure has already passed McLeod shadow
   verification.

## Source trail

- `docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md` — maintenance source boundary, GL attribution,
  billing schema and extraction traps.
- `docs/plans/mcleod/FINANCIAL-STORE-PLAN.md` — duplicate-payment lifecycle, canonical-cost policy,
  billing-to-GL question and FleetPal/McLeod repair overlap.
- `docs/plans/mcleod/MCLEOD-COLLECTOR-PLAN.md` — sandbox restore behavior and why sandbox figures
  must carry a restore date.
- `docs/plans/maintenance/FLEETPAL-INTEGRATION-PLAN.md` — the FleetPal-to-McLeod coverage bound,
  D-FP17's AP control-account distinction, and the July 2026 measurement.
- `docs/plans/maintenance/MAINTENANCE-MONEY-CONTROL-PLAN.md` — newer repair-money findings,
  source/staging status and open reconciliation measurements.
- `docs/plans/maintenance/HANDOFF-2026-10-04-MONEY-CONTROL.md` — dated release and collector status
  at the handoff; not a current production check.
- `packages/shared/src/tmsCost/glFamilies.ts` — exact 15-account maintenance family used for the
  direct sandbox aggregates.
- `tools/mcleod-agent/billing.mjs`, `expenses.mjs`, `ledger.mjs` and `queries.mjs` — read-only
  extraction and summary logic used for this inspection.
- `apps/api/src/modules/financial/ledgerCoverage.ts` and `apps/web/src/pages/BillingPage.vue` —
  current code-level billing and coverage surfaces.
- `/Users/miroslavjokovic/Projects/SILVICOM360-TMS/docs/HANDOFF.md`,
  `docs/FEATURES.md` and `registry/project-state.yaml` — TMS build status and schedule.
- `/Users/miroslavjokovic/Projects/SILVICOM360-TMS/docs/audits/2026-10-24-accounting-coverage-vs-chatgpt.md`
  and `docs/slices/SLICE-01-order-to-posted-invoice.md` — accounting capability coverage and the
  implemented-but-not-McLeod-verified billing slice.
- `/Users/miroslavjokovic/Projects/SILVICOM360-TMS/specifications/billing/SPEC-BIL-001-invoicing.md`
  and `specifications/maintenance/SPEC-MNT-001-shop-and-vehicle-file.md` — billing design contract
  and planned Shop scope.
- `/Users/miroslavjokovic/Projects/SILVICOM360-TMS/presentation/docs/FILM-BRIEF.md`,
  `VO-SCRIPT-v2.md` and `presentation/output/silvicom360-tms-launch-film-final.mp4` — accepted
  launch-film version and its current claims.
- `output/maintenance-video/script.json`, `gen/transcripts.txt` and `src/data.ts` — current video
  narration and FleetPal source notes.
