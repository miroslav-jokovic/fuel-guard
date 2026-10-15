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
- **D-IC13 — The officer's report is read, and the driver it names is compared, never trusted alone
  (added 2026-10-15).** Measured that day: none of the six FMCSA datasets carries a driver name,
  licence number or date of birth — FMCSA strips them before publishing — so the only document that
  names the driver is the officer's report itself (the paper or PDF the driver is handed). An
  uploaded `roadside_inspection_report` is read by `document-reading` under a new profile
  `roadside_inspection_report`: report number and state, inspection date and times, level, driver
  name, licence number and state, unit VINs and plates, each violation's code and unit. The read is
  then compared three ways — report number/state against the FMCSA row (it is the same inspection,
  or it is not), VIN against `roadside_inspection_units`, and driver name + licence against the IC5
  Samsara reading and our roster (`drivers.cdl_number`). The comparison is a FINDING stored with the
  read's hash, not a new attribution source: agreement raises confidence, disagreement opens a task
  for the safety office, and whether agreement may confirm without a person is Q-IC11. A report
  whose number matches no FMCSA row is kept and matched when the feed catches up (D-IC1).
- **D-IC14 — A maintenance violation is closed by its repair, and the repair is FleetPal's record
  (added 2026-10-15).** 49 CFR 396.9(d), eCFR point-in-time 2026-10-01 (sha256 b22fc7bf…ea49c0):
  "(2) Motor carriers and intermodal equipment providers shall examine the report. Violations or
  defects noted thereon shall be corrected in accordance with § 396.11(a)(3). Repairs of items of
  intermodal equipment placed out-of-service are also to be documented in the maintenance records
  for such equipment. (3) Within 15 days following the date of the inspection, the motor carrier or
  intermodal equipment provider shall— (i) Certify that all violations noted have been corrected by
  completing the 'Signature of Carrier/Intermodal Equipment Provider Official, Title, and Date
  Signed' portions of the form; and (ii) If requested by the issuing State agency, return the
  completed roadside inspection form to the issuing State agency at the address indicated on the
  form and, in all instances, retain a copy at the motor carrier's principal place of business […]
  or where the vehicle is housed for 12 months from the date of the inspection." So every
  inspection with a vehicle violation (Parts 393/396) gets a **repair record**: a 15-day clock from
  the inspection date, the FleetPal work orders on that unit proposed as the repair (unit via
  `fleetpal_units`, opened on or after the inspection date), the person who accepts one, and the
  certification. FleetPal's API has no attachment, file or PDF endpoint (its OpenAPI, 2026-10-15),
  so the "work order and receipt" attached to the inspection is OUR rendering of FleetPal's record —
  work order, jobs, parts and labour, purchase-order invoice number, date and amount — filed as a
  document that says so, with the FleetPal ids and the sync time it was rendered from; a photo of a
  paper receipt is a separate upload (Q-IC12). A violation the officer marked repaired at the scene
  (`defect_verification_id` 1) needs no work order and says why. Post-event by definition, a repair
  is never evidence that a defect did not exist (D-IC4's temporal rule); it closes the record, it
  does not argue the case.
- **D-IC15 — The driver sends the report from the cab (added 2026-10-15).** 396.9(d)(1) already
  requires the driver to deliver the report to the carrier — within 24 hours when not at a terminal.
  The driver app photographs it through the existing scanner and files it to the inspection's
  documents; the uploader is a known driver on a known truck at a known time, which is itself an
  attribution signal, and the read (D-IC13) starts within minutes instead of when someone in the
  office remembers. It shares its intake with Q-IC4's ticket photograph.

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
| ~~`sms_violation_definitions`~~ | — | **Not a table (IC3, 2026-10-11).** Appendix A is the same for every carrier and is only read by the pure calculator, so it ships as versioned data inside `packages/sms-engine/datasets/`. It is generated from FMCSA's workbook and checked against it by `lint:codegen`, the same way `@hazmat/data` works. |
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
| **IC10** | Report reading + identity comparison (D-IC13): `roadside_inspection_report` profile in `@silvicom/shared`'s `DOCUMENT_PROFILES`, read on upload, the three comparisons stored as findings, mismatch → safety task, the result on the inspection's driver card | IC2, IC5, Q-IC11 |
| **IC11** | Repair record (D-IC14): migration for `inspection_repairs` (append-only versions: violation → proposed/accepted FleetPal work orders, due date, certified by/at), proposal from `fleetpal_units` + `fleetpal_work_orders`, rendered repair document, 15-day clock in the inbox and the bell, certification action | FleetPal units sync (2026-10-15), Q-IC12, Q-IC13, Q-IC14 |
| **IC12** | Driver-app intake (D-IC15): photograph the officer's report (and a ticket, Q-IC4) to the inspection; a report with no FMCSA row yet waits for it | IC10, Q-IC4 |

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
- **Q-IC3 — CVSA material. Researched 2026-10-13, owner's call on the purchase.** OP 14 and OP 15 are
  free, but cvsa.org now refuses automated downloads (403 on the policies page, 404 on the old
  `wp-content` PDFs), so a person downloads them once in a browser and they are committed here with
  their sha256. OP 15 matters beyond IC8: § 396.3(a)(1) may be cited only for an OOSC imminent hazard
  or a condition an operational policy names, and our record carries that code (`396.3A1-BOS`). The
  2026 electronic OOSC was not priced in what we could read; earlier electronic editions were $45
  (member) / $50. *Recommendation unchanged: OP 14 + OP 15 now; the OOSC when IC8 starts.* Was: The OOSC 2026 (licensed) and OP 14/15 plus the bulletins (public, but the
  links moved) are needed for R-DUP1 and R-OOS1. Buy the electronic OOSC licence and download OP 14
  from cvsa.org? *Recommendation: yes for OP 14 now (free). Decide on the OOSC after IC4–IC6 show how
  many OOS candidates actually appear.*
- **Q-IC4 — Paid tickets. Researched 2026-10-13, owner's policy call.** FMCSA's job aid
  (`AdjudicatedCitations2025.pdf`) counts only a CONTESTED citation as adjudicated, and only "not
  guilty/dismissed" (removed) and "different charge" (severity 1) change SMS — so a paid fine keeps
  the violation at full weight for its 24 months and on the driver's PSP. Measured: 210 current
  violations carry a citation number, 63 of them in the last year, and only 21 have a court result.
  *Recommendation: (b) of Q-IC2 as the intake — a ticket photographed in the driver app opens a task
  for the safety office with the court date, and the app says "don't pay before safety has seen it";
  the office, not the app, decides whether to contest.* Was: Should the driver app warn before a driver pays a ticket ("paying is a
  conviction of the original charge")? It is a policy question for the office, not a technical one.
- **Q-IC5 — ANSWERED 2026-10-13 from FMCSA's data dictionary** (`MCMIS_Vehicle_Inspection_File_Data_Dictionary_Rev05.pdf`, p. 5):
  1 = A, repaired at scene · 2 = B, towed/escorted to repair · 3 = N, non-OOS / driver non-OOS ·
  4 = D, other · 99 = U, unknown/unverified. It records what happened to an OOS defect, so a rule may
  read it (e.g. "repaired at scene" beside a disputed OOS order). The same dictionary names the
  inspection levels (1 Full, 2 Walk-Around, 3 Driver-Only, 4 Special Study, 5 Terminal) and every
  violation category (p. 7), which the inspection page can now show. Was: `defect_verification_id` (3: 1,131 · 99: 186 · 1: 79 · 4: 24 · 2: 2). Not documented in
  the dataset metadata. Find FMCSA's code table before any rule reads it.
- **Q-IC6 — ANSWERED 2026-10-13 by measurement: no horizon inside FMCSA's window.** GPS history
  answered for trucks we have held since 2017 at every probe from 2023-07-10 to 2026-01-10 (up to
  1,300 points in two hours); the empty windows were parked trucks, and 2024-10-01 returned 657–942
  points on three trucks. Driver–vehicle assignments and HOS logs answer back to 2023-11. So every
  inspection still on the record can be attributed with telematics — for a truck Samsara still
  carries (Q-IC8). Was: Samsara history horizon. GPS returned data for 2025 but nothing for 2024-10-01 on a
  truck we hold. Is that a retention limit on our plan, or did that unit's gateway arrive later?
  Measure across the backfill. It decides how much of 2023–24 can ever be challenged with telematics.
- **Q-IC7 — ANSWERED 2026-10-13: the endpoint is `GET /dvirs/stream`** (and `/defects/stream`),
  without the `/fleet` prefix; our read-only token reads both, back to 2023-10 at least. Each DVIR
  carries vehicle, trailer, submission time, odometer, address, safety status and signature. Was: DVIR endpoint. `/fleet/dvirs/stream` returns 405 on API version 2026.05.06. Identify the
  current DVIR history endpoint (and whether our read-only token covers it) before IC5.
- **Q-IC8 — ANSWERED 2026-10-13: not owner-operators.** The 228 unmatched units are 73 machines:
  - **Tractors: 41 VINs, 153 sightings, the last on 2025-08-06** — none in the past year. Sequential
    Freightliner Cascadia VINs under our own unit numbers (495–597): a fleet generation sold before our
    roster was built (`vehicles` starts 2026-07-01). All 41 are in McLeod's `tractor` table (54 rows,
    all `service_status = 'I'`); none is in Samsara, which deleted them at sale, nor in FleetPal.
  - **Trailers: 32 VINs.** 20 are in McLeod's `trailer` table. The rest are other companies' trailers
    we pulled (Stoughton `TA215874`, `WHT/H194`, "UNIT 3757") and two officer typos (a tractor VIN on a
    trailer line). 9 of the 75 are from the last year.
  - **Fix (D-FC0 consistent: membership is McLeod's):** import McLeod's retired tractors and trailers
    as `status = 'retired'` rows, so 0458 matches them by VIN on its next run. A foreign trailer stays
    unmatched and is labelled as one. Attribution of the retired tractors cannot use Samsara (gone);
    McLeod's dispatch history (`movement`) still names the driver. Was: Leased/owner-operator units. If the 227 unmatched units are owner-operators under our
  authority, they are ours for FMCSA purposes. Attribution must then read the lease roster, not only
  `vehicles`. IC1 measures it first.
- **Q-IC9 — ANSWERED 2026-10-13 from the methodology; one rule to add.** SMS Methodology (June 2026)
  §2.2 excludes violations "(1) a result of a crash; (2) assigned exclusively to another entity such as
  a shipper or IEP", and footnote 8: on a post-crash inspection only pre-existing violations count —
  those flagged "Y" or "U" as crash-related do not. Neither flag is in the open-data violation file
  (checked against the Rev 05 dictionary). So:
  - **The 14 HM codes** are shipping-paper, marking, labelling and placarding duties the HMR puts on
    the shipper (49 CFR 172 subparts C–F): explanation (a). They stay `verified: false`; an HM impact
    figure is shown only with "may be the shipper's" beside it, never as ours.
  - **The Unsafe Driving one** (392.2LC on 4179180099) is a post-accident Level 3 inspection: the crash
    exclusion. **The calculator needs the rule**: a moving violation (categories 12, 40–49) on a
    post-accident inspection is not scored. It touches 4 violations on our 6 post-accident
    inspections; with it, Unsafe Driving can be re-run for parity and verified. Was:
  Every violation FMCSA scored, we score with the same weights. The open question is these 15 extra:
  - **14 in HM Compliance:** shipping-paper, marking, label and placard codes (172.2xx, 172.3xx,
    172.4xx, 172.5xx, 173.24) on 7 placarded Level 1–2 inspections from 2024–26. Other violations
    on those same inspections were scored.
  - **1 in Unsafe Driving:** 392.2LC on 4179180099 (IL, 2024-10-19). It was ticketed and the feed
    has no court result.

  Candidate explanations: (a) FMCSA attributes these to the shipper rather than the carrier, using
  a flag the open-data violation file does not publish. (b) They were corrected in MCMIS without a
  change that reached the open feed. (c) There is a rule in the methodology that we have not found
  yet. *Recommendation:* until this is answered, HM Compliance and Unsafe Driving stay
  `verified: false` in `SMS_PARITY`, so no impact figure is shown for them (D-IC6). The next
  snapshot will add evidence: if the same codes drop out again on new inspections, (a) becomes
  likely. One RDR-free check is to ask the state analyst for one of the 7 inspections.

- **Q-IC10 — How former units become "ours" to the matcher (opened 2026-10-13, owner's call).** Q-IC8's
  fix said "import McLeod's retired tractors and trailers as `status = 'retired'` rows". On building
  it, that collides with a standing rule: `rosterRetire.ts` **never creates** a retired row ("a
  retirement record we never linked is meaningless"), and `vehicles` is not a list of every VIN we
  ever ran — 33 foreign keys and every Vehicles surface read it. McLeod holds ~470 retired tractor
  rows (2026-09-22); 41 of them appear on our inspections, all dated 2023-10 to 2025-08.
  - (a) **Retired rows in `vehicles`/`trailers`.** Smallest change to 0458; reverses the rosterRetire
    rule, puts ~470 dead trucks behind every `vehicles` reader and its cascades. *Not recommended.*
  - (b) **A former-equipment register owned by `mcleod`**: VIN, unit number, kind and McLeod's dates
    for every inactive tractor/trailer, mirrored like the roster. 0458 matches it as a fourth class
    (`former_unit`, shown "ours, retired — McLeod 597"), with no `vehicle_id`, so nothing that counts
    the fleet sees it. Cost: one migration, the agent's query on the McLeod VM (a package update Alex
    installs, as for #1437), and the projection change. *Recommended:* it says what is true — the
    truck was ours, is not now — and leaves the roster's rules alone.
  - (c) **Leave them unmatched**, labelled "not in our current roster". Zero cost; attribution (IC5)
    then has to work from the inspection's VIN alone for those 41 trucks.
  Either (b) or (c), attribution of a retired truck reads McLeod's dispatch history (`movement`), not
  Samsara, which deleted them at sale (Q-IC8).

- **Q-IC11 — May two agreeing sources confirm the driver without a person? (opened 2026-10-15, owner's
  call).** D-IC7 says a guessed driver never reaches a draft, and today every driver is Samsara's
  reading until a safety manager confirms it (459 high, 85 low, 74 no assignment of 625 on 10/15).
  The report (D-IC13) adds an independent second source.
  The licence key is there to match: 168 of 169 active roster drivers carry `drivers.cdl_number`
  (production, 2026-10-15; 188 of 300 including former drivers).
  - (a) **Auto-confirm when the report's licence number equals the roster driver's AND Samsara named
    the same driver**; recorded as a confirmation by the engine with both hashes, reversible by a
    person like any other. Name alone never confirms (spelling, middle names, shared names).
  - (b) **Raise confidence only**; a person still confirms every one.
  - (c) Auto-confirm on licence alone, even without Samsara.
  *Recommended: (a).* Two independent sources agreeing on a licence number is stronger than a person
  clicking "confirm" on one, and the disagreements — the cases that matter — still reach a person.
- **Q-IC12 — What is "the receipt" on a repair? (opened 2026-10-15, owner's call).** FleetPal's API
  serves no files. (a) **Our rendered repair document** from FleetPal's data (work order, jobs, parts,
  labour, PO invoice number/date/amount), labelled as rendered from FleetPal at a stated time.
  (b) (a) plus a required photo/PDF of the vendor's paper invoice when the repair was done outside
  our shop. (c) Upload only, no rendering. *Recommended: (a), with (b)'s upload offered but not
  required* — FleetPal is the maintenance record 396.9(d)(2) asks for; a vendor invoice image is
  evidence a person may add.
- **Q-IC13 — Who certifies, and is the signed report returned to the state? (opened 2026-10-15,
  owner's call).** 396.9(d)(3)(i) needs a carrier official's signature, title and date on the form;
  (ii) needs the form returned only "if requested by the issuing State agency", and a copy kept 12
  months in every case. Candidates: the `maintenance` section's managers certify the repair and the
  `safety` section files the form; or `safety` does both. And: does the product produce the signed
  form (the report image with the certification stamped and the signer recorded), or record that a
  person signed the paper? *Recommended:* maintenance accepts the work order, safety certifies and
  the product renders the certification page beside the report image; returning it stays a person's
  act, recorded with the date sent.
- **Q-IC14 — When does a work order count as THE repair? (opened 2026-10-15, measure first).** A truck
  in for a violation may have an unrelated PM the same day. Candidate rule: same unit, opened on or
  after the inspection date and within 15 days, ranked by VMRS component agreeing with the violation's
  part/section (e.g. 393.75 tyres → VMRS 017) and by a FleetPal defect/issue raised from the
  inspection. Proposed, never accepted automatically, until measured: after the units sync is live,
  take the last year's 126 inspections with vehicle violations and count how many have exactly one
  plausible work order. *Recommendation:* decide auto-accept only on that measurement.

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
- **2026-10-11 — IC3 (the SMS calculator).** New pure package `packages/sms-engine`. It has no
  workspace dependencies, takes the measurement date as an argument (no clock), and both rules are
  enforced by `lint:boundaries`. Appendix A v3.21 (2,412 violations) is generated from the committed
  workbook; the generator checks the workbook's sha256 against SOURCES.md, and `lint:codegen` fails
  if the generated data drifts.
  - **Rules found by measurement.** These were not in §0, and the parity test pins each one:
    - Codes are compared without punctuation. The SMS input writes `39375A3TAOL`.
    - Each BASIC counts only on its relevant inspection level. Vehicle Maintenance and HM need a
      vehicle inspection (Level 1, 2, 5 or 6); the driver BASICs need Level 1, 2, 3 or 6. Ten of our
      violations were on the wrong level.
    - HM counts only where placardable HM was carried. 23 of ours were not.
    - An inspection counts only if it reached MCMIS before the measurement date. Two did not.
    - A code counts once per inspection, and is out-of-service if any occurrence was. 37 of ours were
      repeats.
    - There is no OOS weight in Unsafe Driving or Controlled Substances.
    - A "different charge" conviction sets severity to 1 and drops the OOS weight.
    - FMCSA's `total_severity_wght` is severity plus OOS, before time weighting.
    - The time-weight boundaries fit snapshot date 2026-08-28 (a Friday), with each boundary
      counted in the newer bucket.
  - **Parity with FMCSA's 2026-08-28 snapshot**, run on our 2026-10-10 feed:
    - Compared: 735 scored violations. Seven inspections FMCSA changed after the snapshot are
      excluded; for example, 0298004281's violations were rewritten on 2026-09-26.
    - Every one of FMCSA's 735 is reproduced, with identical severity, OOS, time and total weight.
    - The scored inspection set and each inspection's time weight are identical.
    - Extra on our side: the 15 in Q-IC9.
    - Exact BASICs: Vehicle Maintenance, Hours of Service, Driver Fitness, and Controlled
      Substances/Alcohol.
  - **Mutation checks:** dropping the level rule, the different-charge rule or the placard rule
    fails the parity test. Dropping the MCMIS-loaded rule fails the unit test; the parity test cannot
    see it, because the same two inspections are also changed-after-snapshot.
  - **Not built:** a BASIC *measure* needs the power-unit count and the relevant-inspection
    denominator, and percentiles need every other carrier, which FMCSA does not publish. IC4 shows
    the per-violation impact (`basicPoints` with and without the violation) for verified BASICs
    only. The feed-freshness alert (IC1c) is still pending.
- **2026-10-13 — The Inspections inbox's first slice (§6), for FLEET-MANAGER-HOME-PLAN FM5 (Q-FM7 (a),
  owner).** This is the projection's first reader: `GET /api/roadside-inspections` and the page
  `/roadside-inspections`, in the `safety` section (D-IC12).
  - Every inspection FMCSA currently records, newest first. Records with `vanished_at` set are left
    out; showing removals is IC4's, as a filter of its own.
  - Filters: period, OOS kind, and search (report, state, location, unit).
  - Each unit shows the officer's company number or plate, and "not matched" when 0458 found no single
    roster match (D-IC7).
  - Not yet built: the "has candidate" and "needs task" filters (IC4), the driver column and filter
    (IC5 attribution), the SMS weight columns (IC3's impact, shown in IC4), and the inspection page
    (IC6).
  - The Operations tab's Roadside card counts this list through `summarizeRoadside`.
  - Measured: the three OOS counts overlap. On all 30 inspections where `oos_total` differs from
    `driver + vehicle + hazmat`, the hazmat order is also counted as a vehicle or driver order.
- **2026-10-13 — A row of the inbox opens its inspection (§6's Inspection page, first slice; owner's ask).**
  `GET /api/roadside-inspections/:id` and the page `/roadside-inspections/:id` (surface
  `safety.roadside-inspections.detail`, parented on the list, same `safety` gate). The list's row and
  its report number both open it, as a page rather than a drawer, so it can be linked and Back keeps
  the list's filters.
  - **Shown, as FMCSA wrote it:** date, the report's local start and end time, level (FMCSA's number),
    fixed site or roadside, location, post-accident, hazmat placard, gross weight and shipper. Then
    FMCSA's counts, every violation (who it is against — the driver or the report's unit by position —
    code, description, OOS, citation number and court result) and every unit (make, plate, VIN, CVSA
    decal, and "ours, by VIN / plate / unit number" or "not matched", D-IC7). A matched truck links to
    its vehicle page only for a reader the router lets in.
  - **Read with the same `vanished_at is null` as the list:** a removed inspection answers 404, and a
    violation or court result FMCSA removed is off the page.
  - **Measured on production, 2026-10-13:** 1,417 current violations, all with a description; 427
    against the driver, 995 against a unit. 21 citations carry a court result, at most one per violation.
  - **Not shown, on purpose:** the driver (not on FMCSA's public record; IC5), the violation group
    (`category_id`, which IC3 maps to a BASIC), the county (a FIPS code with no name table), the
    level's name (no source for it in `docs/regulatory/fmcsa/SOURCES.md`), the resolved instant
    (D-IC8, IC5), and cases, timeline and documents (IC4–IC6).
- **2026-10-13 — Open questions researched (Q-IC3–Q-IC9).** Five answered by measurement or by
  FMCSA's own documents, two left as owner decisions with the research behind them; each is under its
  question in §9. New source: the MCMIS data dictionary Rev 05, added to `docs/regulatory/fmcsa/` with
  its sha256. What it changes:
  - **IC5 is unblocked** (Q-IC6, Q-IC7): GPS, assignments, HOS logs and DVIRs all reach back past the
    oldest inspection on the record.
  - **The unmatched units are a roster gap, not a lease question** (Q-IC8): McLeod holds every one of
    the 41 old tractors; importing them as retired closes it.
  - **The calculator gains one rule** (Q-IC9): no moving violation on a post-accident inspection.
  - **The inspection page can name** levels, violation categories and defect verification (Q-IC5).
  - **Still the owner's:** buying the OOSC (Q-IC3) and the driver-app ticket policy (Q-IC4); a person
    must download OP 14 and OP 15 by hand.
- **2026-10-13 — The post-crash rule (Q-IC9's second half); Unsafe Driving verified.** `scoreSms` leaves
  out an Unsafe Driving violation on an inspection FMCSA marks post-accident (`crash_related`), and
  keeps every other BASIC's: Methodology §2.2 fn. 8 counts only violations that pre-existed the crash,
  and the open data has no per-violation crash flag, so the BASIC stands in for it. Measured on the
  2026-08-28 snapshot: 4179180099's lane change was not scored and UDLS002954's HM violation was. The
  parity fixture gains `feed-post-accident.json` (the six `post_acc_ind = Y` records, each at the
  version the set froze). Parity: Unsafe Driving reproduces 99 of 99 with none extra and is now
  `verified`, so five BASICs may show an impact figure; HM Compliance stays unverified (the 14
  shipper-attributed codes).
- **2026-10-13 — FMCSA's names on the inspection page (Q-IC5 applied).** The level reads "2 · Walk-Around"
  on the list and the page; each violation carries its MCMIS category ("Brakes, All Other Violations")
  and, beside an out-of-service order only, what became of the defect ("Repaired at scene"). All three
  tables live once, in `roadsideInspectionsContract.ts`, copied as printed from the Rev 05 dictionary;
  a code a later edition adds reads as its number, never a guess.
- **2026-10-13 — IC1c, first merge: the record says how current it is.** `roadsideFeedState` (shared)
  is the one definition of late: our last successful inspection-file fetch older than 36 h
  (`ours_late`), or FMCSA's own `rowsUpdatedAt` older than 72 h while ours is current (`fmcsa_late`),
  or no fetch ever (`never`). `GET /api/roadside-inspections/summary` carries it as `feed`; the
  Roadside card says "FMCSA's record as of …" under its figures and the list says it under its title,
  both turning to a caution when late. Migration 0470 adds the notification category
  `roadside_feed_stale`; its emitter (the scheduler's daily alert to safety readers) is the next merge,
  so the CHECK is on every database before anything inserts it.
- **2026-10-13 — IC1c, second merge: the alert.** Every scheduler tick, for every org with a USDOT
  number, asks `roadsideFeedState` — after a run, after a failed run, and when no run was due (`tickOrg`;
  a check inside the run would silence the org whose fetch keeps failing). When late, the safety
  section's managers (`usersWhoManage("safety")`) get a `roadside_feed_stale` warning that names the
  time on the org's clock and says whose side stopped. Deduped per state per UTC day, so a broken fetch
  is a daily reminder, not an hourly one. Recorded as the first sender of a feed-stale category:
  `efs_feed_stale` (0154) still has none.
- **2026-10-13 — Q-IC8's fix paused for Q-IC10.** Building "retired McLeod units as `vehicles` rows"
  met `rosterRetire.ts`'s rule that the roster never creates a retired row. Recorded as Q-IC10 with
  three options; recommendation (b), a former-equipment register matched as `former_unit`.
- **2026-10-14 — CSA points per violation on the Inspection page (IC3's calculator, first reader).**
  `GET /api/roadside-inspections/:id` now carries `sms`: the API runs `@silvicom/sms-engine` over the
  inspection on today's date in the org's zone (`modules/inspections/read/inspectionSms.ts`) and the
  page only says the answer — no rule is restated in the web (contract `roadsideSmsContract.ts`).
  - **Per violation:** points = (severity + 2 when out of service) × time weight, before the cap, with
    how they were reached beneath ("Vehicle Maintenance: severity 4 + 2 out of service, × 3"). A
    violation SMS leaves out shows "None" and the engine's reason (wrong level, crash-related, HM not
    placardable, dismissed in court, counted once, not in Appendix A, older than 24 months, not yet
    loaded).
  - **Per BASIC:** the card "CSA points" gives each BASIC's sum, the 30-point cap when it bites, × the
    time weight. The per-violation points are before the cap, and the card says so.
  - **HM Compliance is withheld (D-IC6):** its rows say "Not shown" and why — FMCSA leaves out the
    shipper's duties by a flag its public data does not carry, so our figure could be higher (Q-IC9).
  - **Inputs read for it:** each violation's adjudication code (`roadside_citations.citation_code`,
    latest `adjseq`), and the MCMIS load date, which 0458 did not type — read from the inspection's raw
    record through `raw_row_id`. A record without one is read as loaded (the feed served it).
  - The shared keys (`SMS_BASIC_NAMES`, `SMS_EXCLUSION_TEXT`) are held equal to the engine's
    `SmsBasic` / `ExclusionReason` at compile time (`SmsKeysAgree`): a reason added on one side only
    fails typecheck. Mutation-checked both ways.
  - **Measured on production, 2026-10-14**, the real read over all 1,391 current inspections: every
    violation carries an entry; 651 scored, 110 HM withheld, 656 excluded (477 outside the window,
    111 not in Appendix A, 35 counted once, 22 HM not placardable, 8 wrong level, 2 dismissed,
    1 crash-related). Three inspections hit the 30-point cap.
  - **Not built:** the list's points column (it reads no violations today, and 1,417 of them cross
    PostgREST's 1,000-row page — a paged read of its own), and "points if removed", which is IC4's case
    impact.
- **2026-10-14 — IC5, first merge: who was driving, and when (the engine; the page is the next merge).**
  Migration 0473: `inspection_attributions` and `inspection_evidence_snapshots`, both append-only
  (`IA010`) and RETENTION_FORBIDDEN, plus the private bucket `inspection-evidence`. The scheduler's
  hourly FMCSA tick now also attributes up to 25 inspections without a reading at the current engine
  version (`ATTRIBUTION_ENGINE_VERSION`, D-IC5), newest first; the three-year backlog clears in about
  two and a half days. Code: `apps/api/src/modules/inspections/attribution/`.
  - **The instant (D-IC8).** The report's state proposes the zones (`stateTimeZoneCandidates`: the
    dominant zone EFS already used, plus the second zone of TX, KY, TN, IN, FL, MI, ND, SD, NE, KS, ID,
    OR and AZ's Navajo Nation; all five mainland zones for a federal "US" report). The GPS chooses: the
    candidate in which the truck spent at least half the interval under 3 mph. Then the GPS position's
    state is checked against the report's (`confirmed`, `other_state`, `unplaced`, `moving`, `no_gps`).
  - **Measured, and why the rule is a share.** The first rule ("every fix under 3 mph") called 49 of
    145 real inspections moving: trucks reposition at a scale, and the officer's end time often falls
    after the truck has left. Time-weighted, the right zone reads 0.9–1.0 stopped and the wrong one
    0–0.4; a few trucks were parked through both candidates, and those stay unresolved.
  - **The driver (D-IC7).** Samsara's driver–vehicle assignments on the truck within two hours. One
    driver covering or bracketing the settled interval is a strong reading — measured on 698 at the
    Erwinville scale (2026-09-22): Samsara closed the HOS assignment at 18:04Z and reopened it at
    18:42Z around the stop, so "during" alone would find nobody. Two drivers, a passenger (a team) or
    nobody goes to a person. Confidence is `high` only when the reading cannot be wrong about *when*:
    the zone settled and the GPS did not contradict it, or the zone unresolved but the same driver
    covers or brackets every candidate while the truck stood still in the state.
  - **The evidence (D-IC4).** Frozen BEFORE the reading is written, and read from the frozen bytes:
    the GPS and engine state ±2 h, the assignments ±2 h, the one driver's HOS log a day either side,
    and the fleet's DVIRs from 16 h before to 8 h after (`/dvirs/stream` ignores `vehicleIds`; the
    summary lists this truck's reports, each before or after the inspection). Each answer is hashed as
    received and stored gzipped under the org's prefix; the row keeps hash, size, request and status.
    A refusal or an empty answer is frozen too. The DVIR photo links Samsara signs expire in a day;
    freezing the photos themselves is not built.
  - **No `drivers` FK.** The reading names Samsara's driver id and name (the evidence); our driver is
    resolved through `drivers.samsara_driver_id` when read. An append-only table cannot sit in
    `merge_driver`'s move list.
  - **Dry run on production data, 2026-10-14** (199 inspections spread over three years, real Samsara
    answers, nothing written): 132 high (73% of the 182 whose truck Samsara knows), 21 low, 28 no
    assignment (mostly 2024), 1 two drivers, 16 unit not ours (Q-IC10), 1 truck without a Samsara id.
    Seven low readings have the GPS putting the stopped truck in another state than the report's —
    the first "not my truck / wrong information" leads for IC6.
  - **Not built:** showing the driver on the inspection page with a "confirm" action (next merge);
    EFS, annual-inspection and credential snapshots (D-IC4's other kinds, with the rules that read
    them, IC6); freezing DVIR photos.
- **2026-10-14 — IC5, second merge: the driver on the Inspection page, and a person's decision.**
  `/roadside-inspections/:id` gains a Driver card (§6): the engine's latest reading with its
  confidence, the instant on the inspection's own clock with its zone, the GPS location check, and a
  person's latest decision. `POST /api/roadside-inspections/:id/attribution` records the decision; it
  needs the `safety` section's manage level. Code: `read/inspectionAttribution.ts`,
  `attribution/decide.ts`, `apps/web/src/features/roadside/InspectionDriverCard.vue`.
  - **Two decisions.** *Confirm* stands behind a reading of one driver as it is. *Choose a driver*
    names one of our drivers, former ones included (an inspection may be years old), with a required
    note saying what shows it was them. Naming the driver the reading already resolves to is refused as
    a correction (it is a confirmation). A reading of several drivers, nobody, or a unit not ours can
    only be decided by choosing.
  - **A decision is a new row that restates the reading.** The person's row copies the engine's latest
    reading column for column and adds `decided_by`, the note, and for a correction `driver_id`; 0473's
    checks hold for it as for the engine's row. The page sends back the row it showed (`basedOn`, the
    newer of the reading and the decision, computed by the API); a decision over a row that is no
    longer the latest is refused (409 `changed`) and the page says someone else decided first. Each
    decision writes an audit row (`roadside.attribution_confirmed` / `_corrected`) with the previous row.
  - **Measured on production, 2026-10-14: the roster cannot name most Samsara drivers.** Of the 1,117
    Samsara drivers in our HOS history, 916 have no `drivers` row with their Samsara id (all last seen
    in September, so former drivers the roster never took in); 97 of our 299 drivers have no Samsara
    id. So the card shows Samsara's name with "in Samsara, not on our roster" — never a roster row with
    a similar name (D-IC7) — and an older inspection will usually read that way.
  - **A corrected driver later merged away** (`merge_driver` deletes the duplicate, and `driver_id`
    has no FK, 0473) shows as "a driver record that has since been merged". The decision itself stands.
  - **Not built:** the driver column and filter on the inbox (§6), which need the reading on the list
    read; the timeline from the frozen evidence.
- **2026-10-15 — IC2, first merge: `documents` can hold an inspection's paper (schema only).** Migration
  0476 widens two CHECKs: subject `roadside_inspection` (subject_id = `roadside_inspections.id`, no FK,
  as every subject in 0146) and §3's five kinds — `roadside_inspection_report`, `citation`,
  `court_disposition`, `dataqs_packet`, `dataqs_correspondence`. Its first writer, the upload on the
  Inspection page, is the next merge (§3: the widening and its writer in two merges).
  - **A document belongs to the inspection, not to one violation.** Measured on production
    2026-10-15: 155 inspections carry a citation number, 12 on more than one violation, 5 with two
    different ticket numbers. Which violation a court result answers is recorded by IC4's disposition
    record citing the document — the `certifications.document_id` shape.
  - **The upload cannot ride `/api/compliance/documents`:** that route is gated on the `roster` section,
    and a roster manager is not a safety reader. The next merge adds the inspection's own route behind
    `safety` (D-IC12), and keeps the compliance route refusing the new subject.
  - Matrix `roadside-documents.test.mjs` (12 checks), mutation-checked: dropping a new kind, an old kind
    (`psp_report`), an old subject (`load`) or the new subject each fails it.
- **2026-10-15 — IC2, second merge: the ticket and the court's result on the Inspection page.** A
  Documents card on `/roadside-inspections/:id` lists the inspection's paper and, for the `safety`
  section's managers, takes a file and asks what it is: Citation (ticket), Court result, or Officer's
  inspection report. The two DataQs kinds are IC4's to write and are not offered. Viewing is
  `DocumentPreview`, the one viewer. Code: `modules/inspections/documents/inspectionDocuments.ts`,
  shared `roadsideDocumentsContract.ts`, web `features/roadside/InspectionDocumentsCard.vue`.
  - **Its own routes, behind `safety` (D-IC12):** `GET`/`POST /api/roadside-inspections/:id/documents`
    and `GET …/documents/:documentId/download`, filing through `evidence`'s `registerDocument`
    (`inspections -> evidence`). Each asks first that the inspection is ours and on the record
    (`vanished_at is null`), since `documents.subject_id` has no FK; the download also asks that the
    document is THIS inspection's, because a document id alone would otherwise hand a safety reader
    any of the carrier's documents, a medical card included.
  - **The compliance route keeps it out.** `/api/compliance/documents` is gated on `roster`; its register
    and list schemas now take only the DQ file's subjects and kinds (`COMPLIANCE_DOCUMENT_SUBJECT_TYPES`,
    `COMPLIANCE_DOCUMENT_KINDS`), and its download answers an inspection's document as not on file.
    `DOCUMENT_KINDS`/`DOCUMENT_SUBJECT_TYPES` stay the table's whole vocabulary; the matrix holds them
    equal to 0476's CHECKs.
  - **One upload path.** `useCompliance`'s register → PUT is now `uploadDocumentFile(file, register)`;
    the DQ file and the inspection each pass their own register call, so the type check, the hash and
    the signed PUT are decided once. `DocumentPreview` gains `downloadPath`, defaulting to the DQ file's.
  - Not built: the court-result task list (IC2 → IC4's next step), linking a court result to the
    violation it answers (IC4's disposition record), and the driver app's ticket intake (Q-IC4, owner).
- **2026-10-15 — Audit: freshness, the driver's name, and the repair (D-IC13–15, IC10–12, Q-IC11–14).**
  Measured on production the same day:
  - **The feed is current.** All six datasets succeeded at 15:31 UTC, no failure in 7 days; our latest
    inspection is 10/13, which is also the latest FMCSA has published for any carrier. Publication lag
    over the last 180 days (`mcmis_add_date − insp_date`, 246 inspections): median **2** days, 90th
    percentile **5**, worst 92 — so most inspections arrive with 10+ of 396.9(d)'s 15 days left.
  - **Attribution (IC5):** every inspection of the last year is attributed; 625 total, 459 high, 85
    low, 74 no assignment; 442 of 544 named Samsara drivers resolve to our roster. ~770 older
    inspections still in the 25-an-hour backfill.
  - **No driver name in FMCSA's data.** Every key of every payload in `fmcsa_raw_rows` was listed: no
    name, licence or date of birth in any dataset. Hence D-IC13: the name comes from the report.
  - **Vehicle violations:** 126 inspections in the last 365 days carry a Part 393/396 violation (36 in
    the last 90 days, ~12 a month); 18 violation-unit rows were repaired at the scene.
  - **FleetPal could not answer.** `fleetpal_units` was empty in production — the sweep never walked
    `/v1/units/` (FLEETPAL-INTEGRATION-PLAN §8, 2026-10-15). Fixed on `claude/fleetpal-units-sweep`;
    Q-IC14's measurement waits for it to reach production.
  - **Uploads:** zero roadside documents in production yet; IC2's writer reaches production with the
    next release.

