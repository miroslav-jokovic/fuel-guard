# Roadside repair flow — from a violation to its work order and its receipt, fast and reliable

Owner, 2026-11-18: on the roadside inspection page "we can see work order numbers but we are not able to
see the work order itself, and we can't see whether a receipt is attached — this should be done and help
us make this process fast and reliable"; then "plan, research and build this without any assumptions".

This plan follows INSPECTION-CHALLENGE-PLAN IC11 (the repair record, D-IC14, Q-IC12–Q-IC16) and
FLEETPAL-INTEGRATION-PLAN F16 (D-FP28, Q12, Q13). Everything below §1 was MEASURED on 2026-11-18
(production, read-only; FleetPal's live API, read-only); nothing is inferred.

## 0. Already shipped on 2026-11-18

| PR | What | State |
|---|---|---|
| #2535 | Work order drawer shows each invoice's scanned bill (live from FleetPal); the Repair card opens the work order | merged |
| #2536 | FleetPal spec copy refreshed (Q13); `attachments` under the contract gate | merged |
| #2537 | 0631 — `roadside_repair_bill` document kind | merged; on staging |
| #2539 | Certification freezes each vendor bill beside the repair record (Q12) | in CI |

So "see the work order" and "see the receipt" are answered. What remains is **fast and reliable**, and the
measurements say that is a different problem: almost nobody decides repairs at all.

## 1. Measured — production, 2026-11-18

### 1.1 The repair record is not being used

Each violated unit's newest `inspection_repairs` row (166 units, rows since the engine's first pass on
2026-10-16, inspections back to 2025-10):

| Newest row | Units | Past the 15-day due day |
|---|---:|---:|
| engine: one candidate | 59 | 57 |
| engine: no candidate | 57 | 54 |
| engine: several candidates | 31 | 31 |
| engine: repaired at the scene | 16 | (closed) |
| person: accepted | 2 | — |
| person: repaired outside FleetPal | 1 | — |

**3 person decisions ever, all on 2026-11-18. 3 certifications.** 147 units wait on a person. No unit came
out `unit_not_ours` or `no_fleetpal_unit` — identity matching is not the problem.

By inspection month the backlog is spread over the whole year the first pass read (6–21 units a month);
the live part — inspections since the feature went live in mid-October — is 18 units, 15 undecided.

### 1.2 The alerts reach people who do not act on them

`roadside_repair_due` since 2026-10-19: **197 alerts to 9 people, 27 read.** By role: 7 admins 149 alerts /
27 read; 1 fleet manager 24 / 0; **1 technician 24 / 0**. Admins receive it because an admin manages every
section (`usersWhoManage("maintenance")`), not because they name repairs.

### 1.3 Why 57 units have no candidate

The engine offers work orders opened from the inspection day through the due day (15 days). For the 57,
the unit's nearest non-cancelled work order outside that window:

| Next work order after the due day | Units |
|---|---:|
| 16–30 days after the inspection | 21 |
| 31–60 days | 10 |
| more than 60 days | 15 |
| none at all | 11 |

21 are a repair opened late — invisible to the screen today, so the only honest answer a person can give
is "repaired outside FleetPal", which is false for them.

### 1.4 Do the proposed work orders fix the violation?

A sample of 25 shows both: "brake adjustment" against 393.47E brake out of adjustment, and "Oil change"
against 393.45D audible air leak. **Every FleetPal job carries a VMRS component** (14,433 of 14,433; 317 of
317 on the candidates). Resolving the 61 components on candidate jobs (FleetPal `/v1/vmrs-components`,
code only — D-FP8) and cross-tabulating against the unit's violation sections:

| Violation section | VMRS system the jobs carry most | Next |
|---|---|---|
| 393.75 tires (34 units) | **017** tires: 44 jobs | 013: 17 |
| 393.45 / .47 / .48 / .53 brakes (16 / 15 / 3 / 12 units) | **013** brakes: 15 / 18 / 3 / 13 | 017 |
| 393.9 lighting (9 units) | **034** lighting: 9 | 017: 6 |
| 393.205 wheels (6 units) | **018** wheels: 4 | 043: 2 |

Every other section is too thin to map (393.95 emergency equipment, 393.60 windshield: ≤ 6 units, no
dominant system) — they stay unmapped rather than guessed. Applying only the four rows above to the 90
units with candidates:

| | Units |
|---|---:|
| a violation in a mapped section | 72 |
| — exactly one candidate, and it matches | 35 |
| — several candidates, at least one matches | 23 (11 with exactly one match) |
| — **no candidate matches** | **14** |
| — date order puts a non-match first | 3 |
| no mapped section | 18 |

**Q-IC14 (2026-10-16) ruled this ranking — "VMRS component agreeing with the violation, then the nearest
date" — and it was never built:** `propose.ts` sorts by date only. The mark matters more than the order: 35
units become a glance-and-confirm, and 14 are flagged as "nothing here fixes this", which today look the
same as a good match.

### 1.5 Receipts on the candidates

80 of the 120 distinct candidate work orders have at least one vendor invoice in our tables. Whether a
*scanned bill* is attached is known only by asking FleetPal (D-FP28). **Unmeasurable today:** whether
attaching a file in FleetPal changes the invoice's `updated` time — the timestamp in FleetPal's file names
is the vendor document's own date (median 2.7 days BEFORE the invoice was created), not the upload's. So a
sweep-kept "bill attached" flag cannot yet be proven fresh. See Q-RR4.

## 2. Build steps — already ruled, no new question

### RR1 — the match mark and ranking Q-IC14 ruled
- `readWorkOrdersOnUnits` carries each job's `component` id; the pass resolves ids to VMRS codes through
  `describeComponents` (1 h cache, codes only, D-FP8) with the org's key.
- A pure `violationSystems(viol_code)` in `packages/shared`, holding EXACTLY the four measured rows of §1.4
  and nothing else; its header cites this measurement. An unmapped section yields no mark.
- `proposeRepair` ranks candidates matching first, then by date (Q-IC14); each `RepairCandidate` gains
  `matches: string[] | null` (systems matched; null when no violation of the unit is mapped). Engine version
  bumps, so the next pass re-proposes every open unit — no migration (candidates are jsonb).
- The Repair card and the Shop's "Roadside repairs due" list say "Matches the violation: brakes", or "No job
  on this work order matches the violation" — never pre-selects (Q-IC14: proposed, never accepted).
- Test against the 25-sample shapes above; mutation: dropping the match from the sort / the mark.

### RR2 — receipts on each candidate, from our own tables
Each candidate shows how many vendor invoices FleetPal records against it ("2 vendor invoices"), read from
`fleetpal_purchase_orders` + `fleetpal_po_invoices` once for the whole list. **A count, never a total**:
adding several invoices up is what D-FP27 forbids (corrected while building, 2026-11-18 — this step first
said "count and total"). Each invoice's own amount and its scanned bill stay in the drawer. Whether a scan
is attached stays in the drawer until Q-RR4.

## 3. Open questions — each needs the owner

- **Q-RR1 — Offer work orders opened after the due day?** 21 of the 57 "no candidate" units have one 16–30
  days after the inspection. (a) List them under the candidates as "Opened after the due date (late)" —
  accepting one records a late repair truthfully, and the certification states the dates; (b) keep the
  window at 15 days; the person writes "repaired outside FleetPal". *Recommended: (a)* — (b) forces a false
  statement into a federal record for those 21.
- **Q-RR2 — The year of history.** 142 undecided units are past due; most come from inspections before the
  feature existed (2025-10 to 2026-10). (a) A dated cut-off: units inspected before 2026-10-16 move to a
  "Before the repair record" list, kept and decidable, out of the overdue count and the bell; (b) work through
  all of them; (c) leave as is. *Recommended: (a)* — a list that is 90% history hides the live repairs, which
  is why 15 of 18 recent ones are undecided. (a) changes no record: it is a read-side split by inspection date.
- **Q-RR3 — Who receives the repair alerts?** Today: every maintenance manager, which includes all 7 admins
  (149 alerts, 27 read); the technician read 0 of 24. (a) Name the people who decide repairs (a per-org list
  in Settings → Notifications, defaulting to today's set); (b) only roles whose maintenance level is
  explicit, excluding admins unless they opt in; (c) unchanged. *Recommended: (a)* — the matrix answers who
  MAY decide, not who DOES; only the owner knows the second.
- **Q-RR4 — "Bill attached" on the lists, without a FleetPal call per row.** Needs one fact we cannot
  measure from data: does attaching a file to an existing invoice in FleetPal change its `updated`? (a) The
  owner (or shop) attaches any file to one existing invoice in FleetPal and tells us which; we read it back —
  two minutes, settles it; (b) ask FleetPal support. If yes, the sweep keeps `attachment_count` (a count,
  never a link) and the lists show "Bill attached". *Recommended: (a).*

## 4. Progress log
- **2026-11-18 · Plan written from the measurements in §1.** RR1 and RR2 build next (both already ruled);
  Q-RR1–Q-RR4 wait on the owner.
- **2026-11-18 · Owner ruled Q-RR1 (a), Q-RR2 (a), Q-RR3 (a)** ("proceed as recommended"). Q-RR4 (a) is the
  owner's own act — attach any file to one existing invoice in FleetPal and say which — and waits on it; no
  write to FleetPal is made from here. Build order: RR3 late work orders (engine, after RR1), RR4 the history
  split, RR5 the named repair-alert recipients.
