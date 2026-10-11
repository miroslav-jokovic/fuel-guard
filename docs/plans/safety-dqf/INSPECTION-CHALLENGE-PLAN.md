# Roadside inspection challenges (DataQs) — plan

**Status: PLANNED, 2026-10-10.** Decision IDs `D-IC*`, questions `Q-IC*`, steps `IC0…IC9`. Scope
decision: D-S360-8 (`docs/SILVICOM-360.md`).

**What this replaces.** `docs/Driver-Monitoring/Safety Compliance /compliance-challenge-intelligence-research(1).md`
(2026-09-04) is the research this plan stands on. Its architecture holds. Where this plan differs,
it is because something was **measured on 2026-10-10** against FMCSA's live data, our production
database, Samsara's API and the official documents, and the measurement disagreed. §1 lists each
correction. The research doc stays as background and is not a build document.

**Sources.** Every procedural claim below cites a file in `docs/regulatory/fmcsa/` (manifest
`SOURCES.md`, sha256 per file) or an endpoint verified the same day. The measurements were run
read-only against data.transportation.gov, production (`supabase db query --linked`) and Samsara
(GET only).

---

## 0. What was measured (2026-10-10)

### 0.1 Our FMCSA record — USDOT 1864495 (Silvicom Inc, `organizations.dot_number`)

| Fact | Value | Source |
|---|---|---|
| Inspections in the public feed | **1,390**, 2023-10-11 → 2026-10-07 (3 years, the feed's window) | `fx4q-ay7w` |
| By level | L2 682 · L3 422 · L1 284 · L5 2 | same |
| With ≥1 violation / with OOS | 702 (50.5%) / 230 | same |
| Hazmat placard required | 611 Y · 96 N · 683 blank | same |
| Top states | CA 159 · NM 154 · TX 79 · UT 75 · MO 62 · TN 59 · OH 54 · AZ 51 | same |
| Violations | **1,422**, 299 OOS | `876r-jsdb` |
| Units inspected | 2,763 (1,382 tractors type 11, 1,367 trailers type 9). VIN present on 2,760 | `wt8s-2hbx` |
| Current SMS snapshot | 953 inspections, **741 violations**, total severity weight **3,672** | `rbkj-cgst`, `8mt8-2mdr` |
| SMS weight by BASIC | Vehicle Maint. 2,228 · HM 535 · Unsafe 529 · HOS 331 · Driver Fitness 36 · CS/A 13 | `8mt8-2mdr` |
| Heaviest single code | `393.75A3-TAOL` tires leaking/under-inflated: **518** weight (14% of the whole score), 69 occurrences | same |
| Violations carrying a citation number | 210. Of these, 30 are "WARNING" and 13 "VERBAL", leaving **~167 real tickets** | `876r-jsdb.citation_number` |
| Citations with a recorded court result | **21**: 12 Not Guilty/Dismissed · 7 Conviction of a Different Charge · 2 Conviction of Original Charge | `qbt8-7vic` |
| Same code on the same unit twice in one inspection | 44 | `876r-jsdb` |

What this says:
- **The adjudication route already works for us, and almost nobody uses it.** 19 of the 21 recorded
  court results went our way. The SMS input reflects all 8 that fall inside its 24-month window,
  checked row by row by joining as in §0.4: the 4 dismissals are absent, the 2 different-charge
  violations carry severity 1, and the 2 original-charge ones keep 7 and 10. About **146 tickets
  have no recorded result.** Each is either still pending, was paid (which counts as a conviction,
  §0.3), or won without the result ever reaching DataQs. That last case is a correction FMCSA has
  agreed to make and nobody has asked for. This is the cheapest, most certain value in the plan, so
  it ships first (IC4).
- **The score is a vehicle-maintenance score.** 61% of the weight is Vehicle Maintenance, and one tire
  code is 14% of everything. Most of those violations are *real*. The engine's honest answer for them
  is "do not file". The lasting lever there is prevention: the same tables, read as "which units and
  which pre-trips miss what inspectors find". That belongs in a later plan (§9).

### 0.2 Can we tie an FMCSA inspection to our truck and our driver?

| Question | Result |
|---|---|
| Inspected unit → our `vehicles`/`trailers` by VIN | **2,481 / 2,763 (89.8%)** all-time. **1,632 / 1,707 (95.6%) since 2025-01-01.** Plate adds 39, company unit number adds 16. 227 match nothing (mostly 2023–24, so likely units no longer on the roster; to verify in IC1) |
| Driver at the inspection time from **our** `hos_duty_segments` (±30 min, tractors, inspections since 2026-04-10) | **76 / 243 (31%)**. The table starts 2026-04-07 and only 155k of its 1.6M rows carry a vehicle. **This is not a usable attribution source** |
| Driver from **Samsara** `GET /fleet/driver-vehicle-assignments` (assignmentType HOS) | Returned the driver for both 2025 test inspections, e.g. unit 601 on 2025-11-01 → one driver, 14:12–17:08Z. **This is the attribution source** (D-IC7) |
| Samsara GPS + ECU speed history at the inspection | 2025-07-08: 375 points/hour, `isEcuSpeed: true`, reverse-geocoded. 2025-11-01: 395 points. **2024-10-01: empty**, cause unknown (Q-IC6) |
| Samsara DVIRs | `GET /fleet/dvirs/stream` → **405** on API version 2026.05.06. A different endpoint is needed (Q-IC7) |

The inspection's time is local (`insp_start_time`, HHMM) with no zone. A state-to-zone map is right
for most of our states, but wrong at the edges: TX (El Paso is Mountain), KY/TN/IN/FL/OR/ID/ND/SD/NE/KS
all straddle two zones. So the zone is resolved against **Samsara's own GPS position at the
candidate times**, which at the same time proves the truck was where the inspection says (D-IC8).

### 0.3 What the official documents actually say (quoted, `docs/regulatory/fmcsa/`)

| Rule | Where |
|---|---|
| A state must review inspection RDRs for **3 years** from the inspection date (49 CFR 350.201(s)) | Analyst Guide §4.10 |
| One RDR plus one appeal. Further RDRs on the same data are at the state's discretion and should bring documentation not previously available, citing the earlier RDR number | §4.11 |
| A letter saying the data is wrong is *not sufficient*. No evidence means denied. 2012–13: inspection RDRs **with** documentation were corrected 78% of the time, without it 41% | §4.13, §4.14 |
| When the analyst asks for more, the filer has **14 calendar days**, or the RDR is closed with no correction | §4.15 |
| Violation codes are never applied retroactively | §4.17 |
| The **state** decides state-reported inspections. FMCSA "will not change State-provided data without State consent" | §3.2 |
| Ineligible: safety-rating disputes (→ 385.15/385.17), notice-of-claim allegations (→ 386.14), questions about CSA/SMS itself, crash preventability (→ CPDP) | §3.3 |
| Every submission certifies under **18 USC 1001**: up to $10,000 or 5 years for an intentionally false statement | §4.9 |
| FMCSA monitors adjudicated-citation RDRs "for patterns that might indicate routine masking of violations and frivolous RDRs" | §5.10 |
| Only violations recorded *in error* are removed. An adjudicated violation **stays**, with its outcome appended | §5.9–5.10 |
| Adjudication outcome codes: 3 Not guilty/dismissed → excluded from SMS and PSP. 2 Different charge → severity 1, shown on PSP. 1 Original charge → unchanged. 0 N/A → unchanged. **"Was the fine paid as a result of the violation?" → closed "Citation Results Entered"**: paying is a conviction | Adjudicated Citations job aid, Jul 2025 |
| Required fields for a citation RDR: report state, report number, inspection date, federal violation code and description, carrier name and country, the state citation/ticket, court outcome, explanation (court name) | same |
| Update cadence: Portal/MCMIS daily · SMS monthly, 2 years retained · PSP monthly, 3 years retained | same |
| Inspection RDR types: never received/lost report · citation associated violation · violation incorrect, listed multiple times, or missing IEP/shipper · not mine (wrong carrier) · not mine (wrong driver) · report contains incorrect information/other · duplicate inspection | RDR Type Definitions, Mar 2025 |
| The analyst's first step for an incorrect violation: confirm the requestor and the record, and verify **the vehicle against the original state report** | Analyst Guide §6.8 |
| SMS time weight: 3 (≤6 months) · 2 (6–12) · 1 (12–24). OOS adds 2. Severity × time per inspection per BASIC, **capped at 30** | SMS Methodology v3.21, Jun 2026 |
| Appendix A v3.21, snapshot 2026-05-15: one sheet per BASIC, columns *Section · Description · Group · Severity Weight · In DSMS · Comment ("Added in 3.x") · Footnote*. Codes are written inconsistently (`" 395.22G"`, `383.23(a)(2)`, `393.75A3-TAOL`), and the SMS feed writes them with no punctuation (`39375A3TAOL`) | the xlsx |
| A replacement methodology (Nov 2024, "compliance categories", severity 1/2) is **proposed, not in force**: v3.21 still uses the BASICs | Approved Updates Guide |

### 0.4 The feeds are joinable, but not by one key

- Inspection ↔ violation ↔ unit ↔ citation: `inspection_id`. In the citation feed, `vioseqnum` is the
  violation's `seq_no`. ⚠ `inspection_id` is *number* in `fx4q-ay7w` and `876r-jsdb` but *text* in
  `wt8s-2hbx` and `qbt8-7vic`. A numeric `in (...)` returns HTTP 400 there.
- The SMS input uses `unique_id`, which is **not** `inspection_id` (0 of 953 match). It joins on
  **(`report_number`, `report_state`)**: 953 / 953.
- `change_date` (`YYYYMMDD HHMM`) on every row is the incremental-sync watermark. All four feeds
  showed `rowsUpdatedAt` 2026-10-10 between 10:10 and 11:30 UTC.

### 0.5 What we already have that this builds on

| Need | Existing | Note |
|---|---|---|
| Permanent, hashed file storage | `evidence` module → `documents` (0146, append-only, sha256 NOT NULL, `compliance-docs` bucket), `registerDocument` | Needs new `kind`s and a new `subject_type` (IC2) |
| Reading a scanned inspection report or court disposition | `document-reading` module (0448–0455 sources, assemblies, reads, tier sizing) | A new read profile, not a new reader |
| Driver credentials on a date | `certifications`, `qualification_records`, qualification gate | Driver Fitness rules |
| Annual inspection on a date | `vehicle_inspections` (0280–0286) | `396.17C-PI` rule |
| Hazmat verdict for a load | `@hazmat/engine`, `hazmat_runs`, Roadside Defense Packet | HM rules |
| Fuel stops | `efs_transactions` (RETENTION_FORBIDDEN, kept forever) | Timeline corroboration |
| A driver's cross-carrier history | `psp` module | Different question (hiring). Not reused for detection |

---

## 1. Corrections to the research document

1. **Driver attribution from our HOS table does not work** (31%, §0.2). Use Samsara's assignments API
   at detection time.
2. **Retention would destroy the evidence before the challenge window closes.** Our telemetry is kept
   400 days or not at all (`vehicle_positions` has no rows). A violation counts in SMS for 24 months,
   and a state must hear the RDR for 36. Evidence is therefore **frozen at detection** into
   append-only snapshots (D-IC4).
3. **The best first rule is adjudication, not contradiction.** The research led with an ELD/GPS
   contradiction example. Measured, our largest *certain* win is ~146 citations without a recorded
   outcome (§0.1).
4. **"Fine paid" is a conviction** (Adjudicated Citations job aid). The engine must not draft a
   "citation" RDR for a paid ticket, and the driver app/office must learn that paying a ticket is a
   decision with an SMS consequence (IC4).
5. **SMS impact is checkable against FMCSA's own numbers.** The SMS input feed publishes
   `severity_weight`, `time_weight`, `oos_weight` and `total_severity_wght` per violation. Our
   calculator must reproduce all 741 exactly, or it does not ship (D-IC6).
6. **Regulation text by date is available and necessary.** The eCFR versioner serves any date, and
   §393.75 changed in 2026. A downloaded corpus would be wrong for older inspections.
7. **There is no DataQs API, and that is permanent for this plan** (research §40 confirmed, nothing
   found since). Filing is a person in the DataQs web app (D-IC3).
8. **CVSA OOS criteria and OP 14 are not in hand** (licensed, links 404). The rules that need them
   (duplicate/stacking, OOS-threshold) are gated behind Q-IC3. Everything else ships without them.

### 1.3 Out of scope for this plan

Crash records and CPDP (a separate program and ruleset, research §2.4) · safety-rating disputes ·
the proposed new SMS methodology until FMCSA puts it in force (the calculator is versioned, so it is
a new version, not a rewrite) · automated DataQs submission · state court representation.

---

## 2. Decisions

- **D-IC1 — Detection comes from FMCSA, not from an upload.** The daily open-data feeds create the
  case. A driver's or office's copy of the inspection report is *enrichment and a cross-check*
  (Analyst Guide §6.8: the analyst verifies against the original state report, so we must too). An
  uploaded report with no feed match yet is kept and matched when the feed catches up. That gap is
  measured, never assumed (publication latency, IC1).
- **D-IC2 — FMCSA rows are stored verbatim and append-only.** Every fetched row is kept as received
  (jsonb + sha256 + `change_date` + fetch run). Normalised tables are projections of it. When a row
  changes or disappears, that is a new version, never an overwrite. **A disappearance is the outcome
  signal**: a violation that vanishes after an RDR was granted is how we learn it worked, without
  trusting anyone's note.
- **D-IC3 — A person files, and the product records that they did.** The engine detects, freezes,
  decides, drafts and packages. A named user with a DataQs account copies the narrative and uploads
  the packet. Before the "mark filed" action, our UI shows the 18 USC 1001 certification verbatim and
  records who approved, when, the packet's hash and the RDR number. No headless browser, no stored
  DataQs password, no reverse-engineered endpoint.
- **D-IC4 — Evidence is frozen at detection.** When an inspection is detected, the worker fetches the
  window (±2 h GPS/ECU speed/engine state, HOS logs and assignments for the day, DVIRs, EFS
  transactions, the annual-inspection record, the driver's credentials on that date). It stores each
  one raw, with sha256, its source endpoint and retrieval time, in an append-only snapshot table on
  `RETENTION_FORBIDDEN`. Snapshots are **contemporaneous** or **post-event**, set by the evidence's own
  timestamp. Post-event evidence (a repair the next day) can never support a "did not exist" finding
  (research §18, Analyst Guide §5.10).
- **D-IC5 — Every rule and every authority is versioned by the inspection date.** CFR text from the
  eCFR versioner at the inspection date. SMS Appendix A by the snapshot in force. Rules by
  `rule_version`. Each assessment pins a `corpus_snapshot` (the exact authority versions plus rule
  versions plus evidence hashes) and can be reproduced byte for byte later. Never overwrite history.
- **D-IC6 — The SMS calculator must equal FMCSA.** It is a pure function in `packages/shared`. Its CI
  test is a frozen copy of our SMS input feed, and it must reproduce `severity_weight`, `time_weight`,
  `oos_weight` and `total_severity_wght` for every row, plus the 30-point cap, before any "impact" figure
  is shown. A mismatch is a failing build, not a warning.
- **D-IC7 — Attribution is evidence with a confidence, never a silent join.** Vehicle by VIN →
  plate+state → company unit number, each method recorded. Driver from Samsara HOS assignments on
  that vehicle at the resolved instant. Two drivers in the window, no assignment, or a unit that is
  not ours goes to a person. A guessed driver never reaches a draft.
- **D-IC8 — The inspection instant is resolved, not assumed.** The local HHMM is converted using the
  zone at Samsara's GPS position for that unit (a state map only proposes candidates). Agreement
  between the GPS position and the report's county/location is itself recorded as a finding:
  identity confirmed, or a mismatch, which is the "not mine / incorrect information" signal.
- **D-IC9 — The rules engine is deterministic and pure.** It lives in a workspace package with the
  hazmat engine's discipline: no `@silvicom/*` imports, no clocks, no randomness (`lint:boundaries`).
  Input is the normalised case plus the frozen evidence plus the corpus. Output is findings, each
  naming the propositions it rests on, the evidence ids and authority ids it cites, and the RDR type
  it implies. **AI never decides**: it drafts prose from findings that already exist.
- **D-IC10 — Two scores, both shown with their parts.** *Viability* (does the evidence defeat an
  element of the violation?) and *impact* (SMS weight removed or reduced, from D-IC6, plus PSP
  exposure). A high-impact, low-viability case gets "do not file". Only *viability ≥ the threshold
  and every essential piece of evidence present* reaches "ready to file". The threshold starts
  conservative and moves only on measured outcomes (IC9).
- **D-IC11 — The draft is checked sentence by sentence.** Every sentence in a generated narrative
  must cite a finding id, an evidence id, or an authority id, or be labelled as an inference.
  Unsupported sentences are removed before a person sees the draft. The model, prompt version and
  input hash are stored with the draft, as the document reader does.
- **D-IC12 — It lives in the `safety` section, as a new module.** API module
  `apps/api/src/modules/inspections/`. It files documents only through `evidence`'s
  `registerDocument` (`API_ALLOW`: `inspections -> evidence`) and reads Samsara only through the
  `samsara` module's client. Who may approve a filing is the section × role matrix, and the
  `safety` write permission. It does not get a new global boolean (CLAUDE.md, "No workarounds").

---

## 3. Data model (migrations, next free numbers at build time)

Every table: `org_id` NOT NULL with composite FKs, `enable row level security`, no client policies
(service-role only, deny-all), API queries org-filtered and asserted with `expectOrgScoped`.

| Table | Kind | Purpose |
|---|---|---|
| `fmcsa_fetch_runs` | ledger | One row per dataset per run: dataset id, watermark in/out, rows seen/new/changed/vanished, HTTP status, Socrata `rowsUpdatedAt`, duration |
| `fmcsa_raw_rows` | append-only, RETENTION_FORBIDDEN | `(dataset, natural_key, change_date, sha256)` unique; `payload jsonb`; `fetch_run_id`; `first_seen_at`; `vanished_at` is set by a later run's insert of a tombstone row, never an UPDATE |
| `roadside_inspections` | projection | One per FMCSA inspection: report number/state, date, local start/end, resolved instant + zone method, level, location/county, placard flag, OOS counts, current raw version |
| `roadside_inspection_units` | projection | Unit seq, type, VIN, plate/state, company number, decal → `vehicle_id`/`trailer_id` + match method |
| `roadside_violations` | projection | seq_no, raw code (kept verbatim), normalised code, part/section, unit, category, OOS, defect verification, citation number, BASIC + severity from Appendix A version, SMS-included flag |
| `roadside_citations` | projection | vioseqnum, adjseq, code, result |
| `sms_violation_definitions` | versioned reference | Appendix A rows per version: normalised code, BASIC, group, severity, DSMS flag, added-in, effective snapshot date, source sha256 |
| `regulatory_texts` | versioned reference, append-only | eCFR section text per `(section, effective date)`, source URL, sha256, retrieved_at. Fetched on demand and cached forever |
| `inspection_attributions` | append-only | inspection → driver: method, confidence, Samsara assignment payload id, confirmed_by/at for human confirmation. A correction is a new row |
| `inspection_evidence_snapshots` | append-only, RETENTION_FORBIDDEN | kind (gps_window, hos_day, assignments, dvir, efs_txns, annual_inspection, credentials, document), source endpoint, observed window, retrieved_at, sha256, payload or `document_id`, `temporal_class` (contemporaneous / post_event / context) |
| `inspection_cases` | append-only versions | one per (inspection, violation or citation): state machine §5, supersedes_id unique (a line, never a fork, as 0454) |
| `inspection_assessments` | append-only | rule-engine run: engine version, corpus snapshot hash, findings jsonb, viability + components, impact + components, recommendation, input hash |
| `inspection_filings` | append-only | packet document id + sha256, narrative version, approved_by, attestation text version, RDR number, filed_at, RDR type, state; later rows record status changes and outcome (feed-derived or entered) |

New `documents.kind`: `roadside_inspection_report`, `citation`, `court_disposition`,
`dataqs_packet`, `dataqs_correspondence`. New `subject_type`: `roadside_inspection`. Both are CHECK
widenings, safe in either deploy order. The first *writer* ships a merge later
(`lint:migration-ordering`). The `merge_driver` cascade list must include `inspection_attributions`
(see the merge_driver trap: a new table that references drivers must be listed).

---

## 4. The engine

### 4.1 Pipeline (worker, once a day, after the feeds refresh, ~12:00 UTC)

```
fetch (6 datasets, change_date > watermark, per USDOT) ─► fmcsa_raw_rows (verbatim, hashed)
   └► project ─► roadside_* tables ─► attribute units (VIN/plate/unit no.)
        └► NEW inspection?  ─► resolve instant (GPS zone) ─► attribute driver (Samsara HOS assignment)
                             ─► freeze evidence (D-IC4) ─► open cases (one per violation/citation)
        └► CHANGED/VANISHED ─► record version ─► if a filing is open: derive outcome
   └► run rules on every case whose inputs changed ─► assessment ─► queue for review
```

- **Scheduler ownership:** runs in the `api` service (RUN_SCHEDULERS_IN_PROCESS), registered per
  `docs/WORKER-DEPLOYMENT.md`. Exactly one fleet-wide. The FMCSA calls need no WEX allowlisting, but
  the Samsara freeze runs in the same tier.
- **Idempotent:** natural keys + sha256 make a replay a no-op. The watermark only advances after
  the run commits.
- **Backfill:** the first run takes the full 3 years (measured: 1,390 + 1,422 + 2,763 + 21 rows plus
  the SMS input). Evidence is frozen for every inspection Samsara can still answer for. The rest are
  marked `evidence_unavailable` with the API's actual response, not with a guess.
- **Freshness:** `fmcsa_fetch_runs` feeds the Data & Sync freshness UI. An alert fires if a dataset's
  `rowsUpdatedAt` is older than 72 h, or if our last successful run is older than 36 h.
- **Latency:** we record `insp_date → first_seen_at` per inspection, and report the measured
  distribution before promising anyone "you'll know within N days".
- **SMS input** is fetched monthly when FMCSA republishes (the job aid says SMS is monthly). It is the
  D-IC6 parity check run live, so a mismatch in production raises an alert, not just a CI failure.

### 4.2 Rules, first set (each is versioned, cites its authority, names its RDR type)

Ordered by measured value and certainty. **Gated** = cannot ship until its gating question is
answered.

| ID | Rule | Fires when | Output | RDR type |
|---|---|---|---|---|
| R-ADJ1 | Citation without a recorded outcome | violation has a citation number that is not WARNING/VERBAL, and no `qbt8-7vic` result after 60 days | **Task, not a filing**: get the court disposition. The draft is built only once a certified disposition is uploaded and read | — |
| R-ADJ2 | Adjudicated in our favour, not reflected | uploaded disposition reads dismissed/not guilty or different charge, and the feed shows no result | Ready-to-file candidate. All required job-aid fields are pre-filled from the feed | Inspection — Citation Associated Violation |
| R-ADJ3 | Paid ticket | disposition or office record says fine paid | **Do not file.** Explains outcome code 1 and the SMS effect | — |
| R-ID1 | Unit not ours on that date | VIN/plate/unit number matches no unit of ours with an active roster interval covering the date | Review → candidate | Not mine (wrong carrier) / Report contains incorrect information |
| R-ID2 | Location contradicts the report | Samsara GPS for the matched unit is > X mi from the report's county at every candidate instant | Review → candidate | Report contains incorrect information / Not mine |
| R-ID3 | Driver not ours / not driving | Samsara shows no HOS assignment of any of our drivers on the unit in the window, or another carrier's driver per feed | Review | Not mine (wrong driver) |
| R-DF1 | Credential valid on the date | Driver Fitness violation (391.41 medical card, 383.23 CDL, 391.11 qualification) and our `certifications`/`qualification_records` show it valid, with a document, on that date | Candidate if the document is contemporaneous | Violation is incorrect |
| R-VM1 | Periodic inspection current | `396.17C-PI` and `vehicle_inspections` shows a passing annual inspection within 12 months before the date | **Review, not candidate.** Whether proof *on board* was required is a §396.17/§396.21 reading on that date's text, which a person confirms | Violation is incorrect (if confirmed) |
| R-HOS1 | Hours limit contradicted | 395.3 violation and Samsara HOS logs for that driver/day, recomputed deterministically, do not exceed the limit | Candidate | Violation is incorrect |
| R-HOS2 | ELD present/operational | 395.22/395.24 violation and the evidence snapshot shows an ELD connected and recording at the instant | Review | Violation is incorrect |
| R-HM1 | Hazmat verdict says compliant | HM violation and a `hazmat_runs` verdict for that load covers the cited element | Review → candidate | Violation is incorrect |
| R-DUP1 | Same condition recorded twice | same normalised code + unit twice in one inspection (44 measured) | **Gated Q-IC3** (OP 14 decides when separate documentation is required) | Listed multiple times |
| R-OOS1 | OOS not supported by criteria | violation flagged OOS and the report's measurements do not meet the OOSC threshold | **Gated Q-IC3** (licensed OOSC) | Violation is incorrect (OOS designation) |
| R-NEV1 | Never filed | always runs | Rejects post-event evidence for "did not exist", rejects retroactive-code arguments (§4.17), rejects a second RDR on the same data without new documentation (§4.11), rejects anything older than 3 years (§4.10) | — |

R-NEV1 is a rule, not a comment: each refusal is a finding the reviewer sees, with its citation.

### 4.3 Violation elements

For each rule-bearing code, the elements are written once, as data (YAML → `*.generated.ts` via
`pnpm gen:rules`, as hazmat does): the regulation, its version source, and each element with the
evidence kinds that can support or defeat it. An assessment reports each element as *supported*,
*contradicted*, or *not evidenced*. Viability is computed from those, never typed.

### 4.4 AI drafting

Uses the `document-reading` module's model/tier plumbing and pins (`visionTier`, model ids, prompt
versions, usage ledger 0451). Input: the findings, the authorities' exact text at the date, the
evidence descriptions, and the job-aid field list for the RDR type. Output: a narrative in the
research doc's §38 register (factual, concise, respectful, no inference about the officer). The claim
verifier (D-IC11) runs before storage. Reading an uploaded inspection report or court disposition is
a new read profile on the existing reader, cross-checked field by field against the feed. The
report wins for narrative and measurements, the feed wins for identifiers, and any disagreement is a
finding.

---

## 5. Case lifecycle

`detected → evidence_frozen → assessed → (do_not_file | needs_evidence | needs_review) → approved →
filed → (info_requested → filed) → granted | partially_granted | denied → (appeal_filed → …) → closed`

- `info_requested` starts a **14-calendar-day** clock (§4.15): notification to the assignee at day 0,
  7 and 12, and on the bell.
- `denied` allows exactly one `appeal_filed` (§4.11). A further one needs a new evidence snapshot that
  was not in the first packet, and the UI enforces this.
- `granted` is confirmed by the feed (violation vanished or result appended). Until the feed agrees,
  the state shows "granted (reported), not yet in FMCSA data".
- Hard stop at 3 years from the inspection date (§4.10).

---

## 6. Interface (safety section)

- **Inspections inbox**: every inspection, newest first. Filters: OOS, has candidate, needs task,
  state, unit, driver. Columns show SMS weight now, and weight if removed (D-IC6). Dates are
  MM/DD/YYYY from the one definition.
- **Inspection page**: header (report, date, resolved time + method, level, location, units with match
  method, driver with confidence and a "confirm" action), the violations with their cases, the
  timeline built from the frozen evidence, and the documents.
- **Case panel**: elements table (supported / contradicted / not evidenced, each linked), both scores
  with components, missing-evidence checklist, the authorities quoted at their date, the draft, and
  "Approve for filing". Approval shows the 18 USC 1001 text, then hands over: copy narrative, download
  packet, open DataQs, enter RDR number.
- **Tasks**: court dispositions to obtain (R-ADJ1), sorted by SMS weight at stake and by days to
  expiry.

The pages are designed against `docs/DESIGN-SYSTEM-CONTRACT.md` and `packages/ui` at build time, and
are not specified here.

---

## 7. Reliability, security, audit

- **Correctness gates (CI):** SMS parity on the frozen SMS input (D-IC6). Feed-projection matrix (PGlite)
  covering insert, change and vanish versioning. Attribution matrix covering ambiguous drivers and
  units that are not ours. Rule golden cases built from our real inspections (anonymised, VINs kept)
  with expected findings. Every rule mutation-tested: a disabled rule must fail its test. A claim
  verifier test where an unsupported sentence must be removed.
- **Reproducibility:** `corpus_snapshot` hash plus the evidence hashes plus engine version mean an
  assessment re-run gives the same bytes, and a test asserts it.
- **Security:** service-role only, org-scoped, no client policies. The packet is an `evidence`
  document (signed-URL reads only). No DataQs credentials are stored anywhere. Driver PII in a packet
  follows the Analyst Guide §4.4 posture: shared only with the validated carrier user.
- **Audit:** approval, filing, appeal, attribution confirmation and "do not file" overrides each
  write an audit row with the actor, and with the previous value where there is one.
- **Failure behaviour:** FMCSA down means the run records failure, the watermark holds, and the next
  run catches up. Samsara down at detection means the freeze is retried with backoff for 7 days, then
  marked `evidence_unavailable` with the last error.
- **Budgets:** the rows are small (1,390 inspections in 3 years ≈ 1.3/day). Raw-row growth is
  measured and declared in `scripts/table-modules.json` at first write (D-LIFE1). GPS windows are the
  only bulky snapshot: about 400 points/hour, so ±2 h ≈ 1,600 points per inspection.

---

## 8. Build order

| Step | What | Depends on |
|---|---|---|
| **IC0** | This plan, the sources folder, D-S360-8 | — |
| **IC1** | Migration: `fmcsa_fetch_runs`, `fmcsa_raw_rows`, the four `roadside_*` projections, `sms_violation_definitions`. Fetcher + projector + scheduler + freshness. Backfill 3 years. **Measure:** publication latency, the 227 unmatched units (owner-operators? sold units?), what `defect_verification_id` codes mean (Q-IC5) | IC0 |
| **IC2** | `documents` kind/subject widening. Report + disposition upload into `evidence`. Read profile for both on the document reader | IC1 |
| **IC3** | SMS calculator in `packages/shared` + Appendix A v3.21 loader + **parity test against the frozen SMS input**. Impact columns in the inbox | IC1 |
| **IC4** | **Adjudication first**: R-ADJ1/2/3, tasks UI, case lifecycle, filing hand-off with attestation, packet render. The first real filings | IC2, IC3 |
| **IC5** | Attribution (instant resolution + Samsara assignments) and the evidence freeze, with backfill of every inspection Samsara can still answer for | IC1, Q-IC6, Q-IC7 |
| **IC6** | Rules package + elements YAML + `regulatory_texts` (eCFR by date). R-ID1/2/3, R-DF1, R-VM1, R-HOS1/2, R-HM1, R-NEV1. Assessments and inspection page | IC5 |
| **IC7** | AI drafting + claim verifier | IC6 |
| **IC8** | R-DUP1, R-OOS1 | Q-IC3 |
| **IC9** | Outcome learning: feed-derived outcomes, grant rate by rule/code/state, threshold review (D-IC10). Report the first 90 days | IC4 + 90 days of filings |

IC1 and IC3 can run in parallel. IC4 is the first step a user can act on, and should be reachable in
about three merges.

---

## 9. Open questions

- **Q-IC1 — RESOLVED 2026-10-11 (owner): (a), our own safety staff file in DataQs.** Was: Who files, under which DataQs account?** (a) Our safety staff, each registered as a
  Motor Carrier user validated with the USDOT PIN. (b) A third-party service in the "Public/Industry"
  role. *Recommendation: (a).* A validated carrier user sees PII the public role does not (Analyst
  Guide §4.3–4.4), the 18 USC 1001 attestation should be ours, and the product exists to make (a)
  fast.
- **Q-IC2 — RESOLVED 2026-10-11 (owner): (a), our safety office handles the tickets and obtains the dispositions.** Was: Who obtains court dispositions?** ~146 tickets have no recorded result. (a) The safety
  office requests them from each court. (b) The driver who received the ticket uploads it in the
  driver app. (c) A ticket-defense attorney network. *Recommendation: (a) with (b) as the intake.*
  The disposition must be certified (job aid), which usually means the court, not the driver.
- **Q-IC3 — CVSA material.** The OOSC 2026 (licensed) and OP 14/15 plus the bulletins (public, but the
  links moved) are needed for R-DUP1 and R-OOS1. Buy the electronic OOSC licence and download OP 14
  from cvsa.org? *Recommendation: yes for OP 14 now (free). Decide on the OOSC after IC4–IC6 show how
  many OOS candidates actually appear.*
- **Q-IC4 — Paid tickets.** Should the driver app warn before a driver pays a ticket ("paying is a
  conviction of the original charge")? It is a policy question for the office, not a technical one.
- **Q-IC5 — `defect_verification_id`** (3: 1,131 · 99: 186 · 1: 79 · 4: 24 · 2: 2). Not documented in
  the dataset metadata. Find FMCSA's code table before any rule reads it.
- **Q-IC6 — Samsara history horizon.** GPS returned data for 2025 but nothing for 2024-10-01 on a
  truck we hold. Is that a retention limit on our plan, or did that unit's gateway arrive later?
  Measure across the backfill. It decides how much of 2023–24 can ever be challenged with telematics.
- **Q-IC7 — DVIR endpoint.** `/fleet/dvirs/stream` returns 405 on API version 2026.05.06. Identify the
  current DVIR history endpoint (and whether our read-only token covers it) before IC5.
- **Q-IC8 — Leased/owner-operator units.** If the 227 unmatched units are owner-operators under our
  authority, they are ours for FMCSA purposes. Attribution must then read the lease roster, not only
  `vehicles`. IC1 measures it first.

---

## 10. Progress log

- **2026-10-10 — IC0.** Plan written. Downloaded 14 official documents to `docs/regulatory/fmcsa/`
  (manifest with sha256). Verified the six open-data datasets, eCFR point-in-time, and Samsara's
  history endpoints. All measurements in §0 were taken today. No code yet.
- **2026-10-11 — IC1, first half (the raw feed).** Migration 0457: `fmcsa_fetch_runs` and
  `fmcsa_raw_rows`, both append-only and RETENTION_FORBIDDEN, written through one function,
  `fmcsa_snapshot_record`. Collector `apps/api/src/modules/inspections/feed/`, on a daily
  scheduler, `FMCSA_FEED_HOURS`. **Changed from §4.1:** each run takes a full snapshot, and there is
  no `change_date` watermark. A watermark cannot see a deleted row, and D-IC2 depends on seeing
  deletions. Our whole record is small enough to fetch in full every day. Live run, 2026-10-11, no
  database writes:
  - 30 requests in about 7 s, every natural key unique.
  - Rows: 1,393 inspections, 1,422 violations, 2,763 units, 21 citations, 953 SMS inspections and
    741 SMS violations. The inspection snapshot is about 2 MB, and PostgREST accepted a 2.5 MB body.
  - **The child files lag the parent.** The inspection file was republished 2026-10-11 10:51Z with
    3 new inspections. The violation and unit files were last republished 2026-10-10. The SMS files
    were last republished 2026-09-13. The projector (IC1b) must therefore treat "an inspection with
    no units yet" as normal for a day, not as an error.
  - Not yet built: the `roadside_*` projections, `sms_violation_definitions`, and the freshness alert
    from §4.1. These are IC1b.
- **2026-10-11 — Owner decisions.** Q-IC1: our own safety staff file in DataQs. Q-IC2: the safety
  office handles the tickets, including getting the court results. IC4 therefore builds the
  disposition task for the safety office's queue. The driver-app upload is not needed for IC4.
- **2026-10-11 — IC1b (the typed record).** Migration 0458 adds four tables: `roadside_inspections`,
  `roadside_inspection_units`, `roadside_violations` and `roadside_citations`. All four are derived
  from the raw store by `roadside_project`. That function is set-based, idempotent, and runs after
  every feed run. A row whose record vanished is marked `removed` or `aged_out` and never deleted.
  I ran it in PGlite on the real record and the production roster (2026-10-11):
  - **Rows:** 1,390 inspections, 2,763 units, 1,422 violations and 21 citations on the first call;
    0 changed on the second. All 21 citations link to their violation, and 996 of the 996
    vehicle-side violations link to their unit.
  - **Speed:** about 4 s in WASM, after replacing the correlated per-unit scans (25 s) with hash
    joins.
  - **Unit matches:**

    | | VIN | Plate | Unit number | Wrong kind | No match |
    |---|---|---|---|---|---|
    | Tractors | 1,200 | 23 | 4 | 1 | 154 |
    | Semi-trailers | 1,263 | 15 | 12 | 2 | 75 |

  - **New method, `kind_mismatch`.** Matching found 4 units whose VIN or plate belongs to the wrong
    kind of roster record (a tractor's VIN on a trailer row, or the reverse). That is either an
    officer's typo or a roster row in the wrong table. D-IC7 rules out a silent join, so these are
    recorded and left unmatched. Tractors (type 11) match only vehicles and semi-trailers (type 9)
    match only trailers, by every method.
  - **Not built:** `sms_violation_definitions` moves to IC3 with the calculator that reads it. The
    feed-freshness alert from §4.1 is IC1c.
  - **Q-IC8 still open:** about 229 tractors and trailers have no match.
