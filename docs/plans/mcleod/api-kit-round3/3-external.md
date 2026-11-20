# Round 3, reviewer 3: external dependencies, 2026-11-20

Repo: `/Users/miroslavjokovic/Projects/FG-mcleod-api` @ `1c8ed3583`. Read-only. Sources read in full or at the cited
lines: COUNCIL-2026-11-20-API-KIT.md, api-kit-council/3-ops.md (all), 4-office.md (OF-8..OF-23), 5-redteam.md
(RT-7..RT-26), AUDIT-2026-11-20-API-KIT-SPECS.md, MCLEOD-API-KIT-PLAN.md (v1), HANDOFF-2026-11-19, specs C §3.1/§6/§7/§9,
D §MK2.1/MK6/App. C, B §3.6, mail.md, SILVICOM-GRANTS.sql, REQUEST-TO-ALEX-2026-11-13-FINANCE-ON-LME-AND-LUMPER.md,
LUMPER-REVISED-RC-PLAN.md (Q-LRC10, progress log), FINANCE-REPORTS-V2-PLAN.md §1.3, RELEASE-GATE.md Gate D, and the three
2026-11-11 meeting PDFs in the main checkout (text extracted with pdftotext; untracked, so cited by name + section).
Memory used as evidence where it records a measurement: `mcleod-sandbox-access` (11-17 grant re-measure, the two Alexes),
`aws-migration-position` (10-27 VM ingest URL), `apple-account-is-individual`, `it-requests-are-one-complete-list`.

---

## 1. Dependency table

Legend for **Scope**: PROGRAM = blocks every API step (MK0 onward); WRITES = blocks every McLeod write; FEATURE = one
step only; NONE = no build consequence. **If never answered** = the end state the plan must reach without stalling and
without a workaround.

| # | Who | Exact ask | Step that waits | Built meanwhile | Per-answer build (pre-decided?) | If never answered | Scope |
|---|---|---|---|---|---|---|---|
| X1 | McLeod (Ron) | Enable Direct-Hosted `/ws` on our 22.1 production (and test company); or say what version is needed | MK0 discovery, MK1+ | N1–N9, S0a–c, write-pipeline DB + routes dark (C PR-1..4), agent client vs `fakeMcleod`, MK2 finance (SQL) | Yes, C U1 (present / 404 / clearStop absent) | MK0+ never start; N-steps, S0, finance, docs to the office still ship. The 22.1→26.2 upgrade is an owner decision already open from the 11-11 meeting; no SQL write ever (6 Aug rule) | PROGRAM |
| X2 | McLeod | `/ws` base URL, TLS cert PEM + SHA-256, DNS name or not | MK0 step 2 (`set-mcleod-api.ps1 -Configure`) | same as X1 | Yes, C U2 (5 rows) + K2 | MK0 cannot be configured. Alex can read the cert from his own server (he owns it): **second source exists, see EXT-14** | PROGRAM |
| X3 | McLeod | `AnywhereCompanyID` for TMS..TMS4 + test company | every `/ws` call header | — | Yes, C U3 corrected by OPS-12; probe K4 decides by reads | Probe K4 (`/metadata`) answers it for free; the ask is a cross-check only | NONE once K4 runs |
| X4 | McLeod + Alex | Integration web user, type `Users` only, token mode; LoadMaster security profile denies money/order/delete; does user security apply to `/ws` | MK0 auth, every write | — | Yes, U4 + K3 + K5; OPS-11: money reachable → owner ruling before L3 | No user = no `/ws` = as X1. Security-profile answer never comes → K5 measures the deny list; owner rules residual risk (pre-decided) | PROGRAM (user), WRITES (profile) |
| X5 | McLeod | Token lifetime; does a login hold a licence seat; `LicensingAgent` value | auth mode | — | Yes, K3/K23: seat held → token mode mandatory | Token mode chosen by default (OPS-10) — no wait | NONE |
| X6 | McLeod + Alex | Write-capable test company / test server, with copies of drivers/tractors/customers | every write's `test` mode (D-MK3), P1–P6 | everything up to `--api-prove` | Yes, U8 (same server / separate server / none) | `stop_clear` only: live canary per OPS-2 (S2 sign-off + Alex OK + rehearsed undo). `drivers/create`, TableRowService updates, images, call-ins: **never switched on** until a test company exists; McLeod's written field answers let them be BUILT, not switched on | WRITES |
| X7 | McLeod | `clearStop` semantics: departure-only, out-of-order, second call, late stop without `delayCode`, same logic as a dispatcher's clear, refusal codes/text | MK3 | MK3 code (adapters both ways) | Yes, K13–K17, U10/U11 | Test-company probes K13–K17 answer every one; McLeod's text is a cross-check | FEATURE (MK3) |
| X8 | McLeod | Any `/ws` un-clear | MK3 undo help text | — | Expected "no" → LoadMaster steps (Alex) | Assume none (already the design) | NONE |
| X9 | McLeod | TableRowService writable fields of stop/driver/tractor/trailer; `stop/update eta` runs dispatch logic? | MK5, MK6 fallback | MK5 code | Yes, K21 per field: non-writable → field dropped by capability row | Test-company read-back decides per field; without test company → as X6 | FEATURE (MK5/MK6) |
| X10 | McLeod | `drivers/create` mandatory fields; is SSN required | MK5 create | create adapter | Yes, K20/D-59: SSN required → create stays off, office enters in McLeod | Create stays off; C-16 sweep linking keeps hires linked | FEATURE (MK5 create) |
| X11 | McLeod | Images: stored vs staged; latency; **does `/ws` images land in DocumentPower (MCLEODIMAGING `dta`) on our install, and does it need the "DocumentPower 3rd-party image retrieval" module** | MK4 | MK4 assembly, sends table | Partly: K19 decides stored/staged. **Where it lands and licence: not asked anywhere (EXT-9)** | MK4 stays off | FEATURE (MK4) |
| X12 | McLeod | Audit days-to-keep for movement/stop; `audit_log_tx` purge; `maxresultsize` | MK1 change leg | parity full-read | Yes, U5/U6/K7/K8 | Probes K7/K8 decide; SQL close read never retired if < 7 d | FEATURE (MK1 leg) |
| X13 | McLeod | Webhooks on 22.1 | — | — | U7: even if present, still polling | Irrelevant | NONE (drop, EXT-17) |
| X14 | McLeod | Symphony licensed | — | — | U16 "no effect"; Symphony `driverAvailable` is HOS, not home time (handoff §2) | Irrelevant to v2 | NONE (drop or mark informational) |
| X15 | McLeod | Rate limit; call volume charge | MK1 parity cadence | — | Yes, U15/K24 | 500 ms + 1 in flight stays | NONE |
| X16 | McLeod | API Kit terms in writing: what the ~$750/month covers (Direct-Hosted on 22.1? per-user / per-call charges?), named technical contact | contract certainty; who to escalate to | everything | Not pre-decided (EXT-8) | Program proceeds on the verbal quote; owner's commercial risk, not a build stop | PROGRAM (commercial) |
| X17 | McLeod | Do `/ws` calls stay stable across upgrades (meeting Q46) | none now; every upgrade | — | C U1: upgrade ⇒ re-run Phase A/B | Re-run discovery after every upgrade regardless | NONE (procedure) |
| X18 | McLeod + Alex | Call-in side effects: does `PUT /callins/create` send anything to a customer (EDI 214, e-mail, portal) on our install | MK6 ETA route | DB7 measurement | Yes, OF-15: yes → call-in route off, RowStop `eta` | ETA route = RowStop `eta` (O-8's ruled fallback) if K22 passes; else no ETA write | FEATURE (MK6) |
| A1 | Alex (**Lockwood** for the OK, Tzakov operates — EXT-2) | Written OK to change the 09-24 posture: 360 writes to McLeod through `/ws` (scope list), SQL login stays SELECT-only | MK0 (new LAN destination) and every write | N, S0, dark pipeline, finance SQL | Yes, U17 (yes / no) | **No `/ws` traffic at all**, reads included (the VM may reach only LME + our API under the 09-24 terms). Hard stop, recorded; no fallback exists that is not a workaround (Cloud-Hosted still writes Alex's McLeod) | PROGRAM |
| A2 | Alex | Firewall: VM → `/ws` host HTTPS (LAN); confirm VM's egress IP to the internet is static | MK0; C-7 egress-IP pin | — | Partly: static IP not asked (EXT-6) | MK0 cannot connect | PROGRAM |
| A3 | Alex | `clearStop` effects on OUR LoadMaster per stop type / first-last (EDI 214, notifications, ready-to-bill, pay, status, hub, service failure) + exact undo steps + can dispatchers tell an integration clear | MK3 canary (C-19, OPS-1) | MK3 code, test-company P1–P6 | Yes (C-19) | Fallback: McLeod's X7 answer + test-company observation (K18-T) of status/billing after a last-stop clear. If neither ⇒ MK3 stays off | FEATURE (MK3) |
| A4 | Alex | List of EDI customers; non-EDI, non-billable test customer; driver `S360TEST` excluded from settlements; yard tractor; test order; rehearse undo once by hand | MK3 rollout order and live canary (U8 = none) | — | Yes (OPS-2, OPS-18) | Rollout cannot be staged by customer ⇒ only pickups go live (no billing effect), never deliveries | FEATURE (MK3 deliveries) |
| A5 | Alex | Is an un-coded, non-reportable service failure acceptable to dispatchers (O-4/Q-2/RT-7) | MK3 deliveries | — | Yes, Q-2: not acceptable → pickups only until McLeod gives a clear-without-SF way | Pickups only | FEATURE |
| A6 | Alex | VM facts: who holds admin; NTP; task restart policy (`-Check`); count LoadMaster sessions before/after a login (K23) | MK0 PR-2 / C-21 | — | Yes (OPS-4, OPS-10) | Our RDP account runs `-Check` itself (owner already updates via RDP); NTP checked with `w32tm /query /status` from RDP | NONE (self-serve) |
| A7 | Alex | Where the McLeod credential lives (`mcleod-ws.env`), who may hold it | MK0 step 2 | — | Yes (OPS-17) | Default = person at hidden prompt, as 10-27 token | NONE |
| A8 | Alex | Remaining SQL grants: Part 4's 13 tables still refused + `drs_check`, `gl_summary` | MK2 finance only | F0 (owner, copy), F12b, C1 | Yes (spec D MK2, OF-12/13) | Finance stays on the frozen copy read by hand; MK2 stops at F0; no API program step waits | FEATURE (MK2) |
| A9 | Alex | Part 6 (`dta` imaging) + VM read access to imaging volume | revised-RC route (b); OF-8 double-capture count; OF-9 echo filter on route (b) | `fromApi` | Yes (spec D MK4.4 switch rule) | API route becomes the only route after its 14-day check (spec D :360-361) | FEATURE |
| A10 | Alex | Review of changed SQL routines before the VM runs them: B4 reference_number statements, finance F3/F7 statements, test-company parameter set | B4/V1, MK2.3, test-company read lane | code merges | Yes (mail.md "send the new SQL file before it goes live") | Each statement stays off the VM; its feature waits | FEATURE ×3 |
| A11 | Alex | `/ws` HTTP calls run on their own timer, concurrently with the one SQL connection — acceptable under "one program, one connection"? (RT-26) | MK1 parity, MK3 writes | — | Not pre-decided (EXT-11) | Serialize `/ws` behind SQL in the one job loop (C-20's starvation risk returns) | FEATURE |
| O1 | Owner | Q-1 (O-2 governs updates; create carries identity once) + Q-4/O-7 sentence, one reply | MK5 create + reactivate | everything else | Yes: switch row `off` until on file | Create/reactivate stay `off`; C-16 sweep links hand-entered hires; O-6 "Hire again" reopens 360 row but McLeod reactivation stays a by-hand act | FEATURE |
| O2 | Owner | Q-2 (service failure) | MK3 deliveries | MK3 pickups | Yes | Pickups only | FEATURE |
| O3 | Owner | Q-3 recruiter "Hire again" | OF-1 UI gate | RPC | Yes | Default to the narrower gate (managers) until ruled — see EXT-20 | FEATURE |
| O4 | Owner | Re-approve v2's D-MK rows marked CHANGED from v1 (RT-25) | v2 sign-off | — | Not in council Q-list (EXT-19) | v1-identical rows proceed on O-1; CHANGED rows wait | PROGRAM (paper) |
| O5 | Owner | Supply the 11-11 meeting notes and the 11-19 Ron email + reply (B-MK10) | context for X1–X17 | everything | Not in council Q-list (EXT-18) | Ask McLeod everything anew (the message does that already) | NONE |
| O6 | Owner | Release approvals: every nightly release PR carrying an MK step; standing OK for `release.yml` hotfix mode for agent-facing API changes during MK0/P-runs (RT-10) | every step reaching production | — | Standing OK not in Q-list (EXT-19) | One release per round-trip (budgeted in v2's rollout table) | PROGRAM (pace) |
| O7 | Owner | S1 per kind (first `test`→`live`), S2 (live canary if U8 = none) | each kind's go-live | — | Yes (C §9) | Kind stays `test` | FEATURE each |
| O8 | Owner | SSM writes (Claude is refused): `MCLEOD_WRITES_ENABLED` on api + the service serving `/api/tms`, `MCLEOD_AGENT_EGRESS_IP`; issue the write token (`issueMcleodToken.ts --scope=writes`) on the Mac; open VM prompt first | L1 on, C-7 | — | Yes | L1 stays off ⇒ no writes | WRITES |
| O9 | Owner | Conditional: OPS-11 residual-risk ruling if McLeod says user security does not apply to `/ws`; OPS-16 repo-private decision | L3 on (conditional) | — | Yes (pre-decided as conditional) | Writes stay off at L3 | WRITES (conditional) |
| S1 | Owner (Apple/Google) | Apple Organization conversion (D-U-N-S, support request); age-rating questionnaire; DSA trader status; privacy labels; Play Data Safety; review credentials + seeded review org; EAS project/keystore/APNs/ASC record (RELEASE-GATE P2.3); ASC API key | every driver-side benefit (N1–N3, N7, C-A2, MK3's value) — today **no driver uses the app** (2-driver :63) | all server-side work | Partly: memory `apple-account-is-individual` says external TestFlight / ad-hoc for pilots meanwhile; Android unaffected | Android store first (no Apple dependency); iOS drivers via external TestFlight pilot. MK3 writes for those drivers only | PROGRAM (driver side) |
| D1 | Dispatcher (named by owner) | V1: read 3 loads (P8-only, PU-only, both) and name the pickup-number field | B5 only | B4 (optional wire field) | Yes, outcomes A/B/C (B §3.6) | B5 never merges; PU stays hidden; nothing else waits | FEATURE |
| D2 | Billing clerk (named by owner) | 14-day readability trial, ≥ 98% of 360-filed BOL/POD readable (C-17), or scanner on stops | BOL/POD `live` | MK4 filing beside McLeod capture | Yes (OF-11) | BOL/POD never `live`; drivers keep McLeod capture | FEATURE |
| W1 | AWS (owner) | No new AWS-side external dependency: VM → `api.360` already works since 2026-10-27 18:29Z (memory `aws-migration-position`); Caddy must pass client IP (our config) | C-7 | — | — | — | NONE external |
| Z1 | Samsara | Write token for creating the Samsara driver at hire (v1 §6) | not in v2 | — | Not placed (EXT-21) | Out of scope, must be labelled | NONE (scope) |

---

## 2. Findings

### EXT-1 [BLOCKER] The plan has no "if never answered" end state for the two PROGRAM-level external asks
- Evidence: C U1 handles "/ws 404" and U17 handles Alex "no", but neither states what happens when there is **no
  answer**. AUDIT/COUNCIL do not time-box any external ask. The handoff says "the plan must close each with a defined
  action and per-outcome build" (HANDOFF :154-159) — silence is a third outcome.
- Fix text for v2 (§External asks): "Silence is an answer after 10 business days. McLeod silent ⇒ the owner chases Ron
  once, then the account escalation named in X16; meanwhile N1–N9, S0, the dark pipeline (C PR-1..4) and MK2 continue,
  and MK0+ are marked `waiting: McLeod` in the progress log. Alex silent on A1 ⇒ the owner asks Alex Lockwood directly
  (he set the 09-24 terms). There is no technical fallback for A1: every `/ws` route reaches Alex's McLeod, and SQL
  writes are forbidden (6 Aug). v2 states this as a hard stop, not a delay."

### EXT-2 [GAP] "Alex" is two people; the plan addresses one
- Evidence: memory `mcleod-sandbox-access` :80-81 — Alex Tzakov runs grants, restores and the VM; Alex Lockwood
  (Chicago Surplus IT) wrote the 09-24 conditions. The 11-13 request is To Tzakov, Cc Lockwood "(he set the finance
  conditions on 09-24)" (`REQUEST-TO-ALEX-2026-11-13…md:3`). 3-ops' Alex list, C §3.1 A1–A3 and COUNCIL say "Alex"
  throughout.
- Consequence: B-MK9 (posture change) is Lockwood's to approve; items A3–A6 are Tzakov's to do. Sending the posture
  change to the operator alone repeats the 09-24 pattern in reverse and risks an OK from someone who did not set the terms.
- Fix: one message, To Tzakov, Cc Lockwood, item 1 addressed by name to Lockwood ("your written OK"). Still one message.

### EXT-3 [ALREADY-ANSWERED] Part 5 and two of Part 4's tables were run on 2026-11-17; 3-ops item 12 asks for them again
- Evidence: LUMPER-REVISED-RC-PLAN.md progress log 2026-11-17: "Alex ran the two grants … all five lumper tables readable
  on `lme`". Memory `mcleod-sandbox-access` 11-17 re-measure: YES = billing_history, drs_deduct_hist, drs_pending_deduct,
  other_charge, other_charge_hist; STILL NO = 13 of Part 4 (gl_ledger, gl_ledger_hist, gl_account, gl_control,
  fiscal_year_dtl, voucher, voucher_hist, voucher_dist, drs_settle_hist, fuel_detail, fuel_detail_hist, fuel_tax_history,
  equipment_item). 3-ops item 12: "Parts 2/3/4/5 … incl. drs_check and gl_summary".
- Also stale: `SILVICOM-GRANTS.sql:57-67` still says Part 4 and Part 5 "WAITING TO BE RUN" / "NOT YET RUN" (:153, :179).
- The 11-17 "STILL NO" list also names `customer` and `driver`: those are **column** grants (Part 1 :80-83; the 18 driver
  columns), which an object-level HAS_PERMS reads as no. Not an ask.
- Fix: the Alex item is exactly "13 tables of Part 4 not yet run (names), plus two new lines `drs_check`, `gl_summary` —
  the SAME 11-13 request, not a new one". Update the grants file header (Part 5 run 11-17; Part 4: billing_history and
  drs_deduct_hist run 11-17) in the same PR as v2.

### EXT-4 [DUPLICATE] 3-ops item 12 re-asks things COUNCIL §2.12 and OF-12/OF-13 dropped
- "Part 2 re-run on `lme_analytics` for the finance comparison night": OF-13 makes the comparison run under two logins
  (`NikiAnalytics` already reads the copy) precisely so it does not depend on Part 2; COUNCIL §2.12 "The Part 2 additions
  are dropped". "Part 3": its four tables are inside Part 4 (`SILVICOM-GRANTS.sql:171-174`), so asking both is double.
- The 11-13 email also asked for a **copy refresh** (item 1). Spec D MK2.1 :909: "no copy refresh is asked: the copy stops
  mattering". The follow-up must WITHDRAW it in words, else Alex still owes it.
- Fix: the finance item says "Part 4 (13 tables + 2 new lines) on LME. Not needed any more: the copy refresh and Part 2 on
  the copy from my 11-13 email."

### EXT-5 [GAP] Part 6 (imaging) status is not carried; the merged Alex list neither repeats nor tracks it
- Evidence: Part 6 sent alone by the owner on 2026-11-18 (LUMPER plan :345-349; spec D :909 "not repeated"). On 11-17/18
  "no `dta` access". 3-ops' Alex list omits Part 6 entirely; nothing in COUNCIL records whether it ran.
- Consequence: OF-8 step 4 and OF-9's route-(b) half and spec D MK4.4's comparison depend on it.
- Fix: before the Alex message goes, run the CHECK block's Part 6 check (OF-12 adds it); the message carries one status line
  either "Part 6 — thank you, it is running" or "Part 6 — the 11-18 request, still open (same request)". Never a new ask.

### EXT-6 [GAP] C-7 pins claim/settle to the VM's egress IP, but nobody asks whether that IP is static
- Evidence: OPS-8 fix text: "refuses claim/settle from any source address other than the VM's egress IP recorded at issue
  (`MCLEOD_AGENT_EGRESS_IP` in SSM)". 3-ops Alex item 3 lists destinations only.
- Consequence: if the carrier's internet IP is dynamic or changes with an ISP change, writes stop with a 403 that looks like
  an attack. The value itself is measurable from our side (Caddy logs of `/api/tms` posts), so the only question is stability.
- Fix: Alex item "Is the public address our API sees from the VM fixed? If it changes, tell us the day before; writes stop
  until we update it." v2 adds an alert "claim refused: unexpected source IP" (W-series) so a change is visible in minutes.

### EXT-7 [GAP] Who creates the integration user and the token is assigned to both parties
- Evidence: 3-ops Alex item 5: "McLeod creates it, you set its security". McLeod item 4: "A dedicated integration web user".
  Mail.md shows Alex creates SQL logins himself; self-hosted LoadMaster user admin is Alex's (the v1 table: token "made in
  LoadMaster", MCLEOD-SELF-HOSTED-INTEGRATION.md :59-97).
- Fix: McLeod enables `/ws` and states the steps and whether user security applies to `/ws` (their product question);
  **Alex** creates the `Users` web user (`S360API`), its security profile and its token in LoadMaster (his install). Each
  message says who does it. Two parties each expecting the other is the most likely stall in MK0.

### EXT-8 [GAP] The McLeod list asks nothing commercial; the purchase exists only as a verbal quote
- Evidence: v1 "quoted verbally at about $750/month"; meeting QUESTIONS PDF §8 asked "Is the API module licensed for us? What
  do Direct-Hosted and Cloud-Hosted each cost?" and wanted "Named McLeod contacts … integrations"; "Notes from the meeting"
  is blank in all three PDFs. RT-24 asked to add "is there a call-volume limit or charge"; 3-ops McLeod #14 asks limit only.
- Fix: McLeod item "Please confirm in writing what the API Kit order covers: Direct-Hosted `/ws` on our 22.1, any per-user,
  per-seat or per-call charge, the test company, and the named technical contact for enablement."

### EXT-9 [GAP] MK4's biggest McLeod unknown is not asked: where a `/ws` image lands on OUR install
- Evidence: LUMPER plan Q-LRC10 (:293-297): LME's own `image`/`image_type` are empty and `imaging_control` hosts are NULL;
  documents live in DocumentPower on a separate host `MCLEODIMAGING` (`dta`..`dta6`). WS.md:241 (Symphony card): "The posting
  of driver-captured images into LoadMaster (requires DocumentPower 3rd Party image retrieval)". 3-ops McLeod #11 asks only
  stored-vs-staged.
- Consequence: a 2xx from `POST /images/O/{order}` may land in LME's unconfigured image tables, where billing never looks
  (billing reads `bolimgd`, D :79-80) — "confirmed" but invisible. OF-8's seen-rule would then never see it and the office
  gets `filed_seen_ambiguous`/expired forever.
- Fix: McLeod item "On our install, does `POST /images/{rowType}/{rowId}/{documentTypeId}` file into DocumentPower (the
  imaging server billing uses), and does it need the DocumentPower third-party image module? If not licensed, what does it
  cost?" Per answer: lands in DocumentPower ⇒ MK4 as written; lands only in LME tables ⇒ MK4 stays off (no workaround);
  needs the module ⇒ owner buys or MK4 stays off. Add a K-probe on the test company: after a 2xx, Part 6's `bolimgd` (route
  b) shows a new row for that order — the independent check of where it landed.

### EXT-10 [GAP] Two Alex questions the council itself required are missing from 3-ops' Alex list
- C-18 / OF-15: "Alex confirms the customer-message point in writing" — does a call-in send anything to a customer? Not in
  3-ops items 1–13 (item 7 covers stop clears only).
- RT-7 / Q-2: "is an un-coded, non-reportable service failure acceptable?" — item 7 lists service failure as an effect but
  does not ask acceptability, and Q-2's recommendation depends on that answer.
- Fix: both go into the merged Alex list (items 9 and 10 below).

### EXT-11 [GAP] "One program, one connection" vs a separate write timer is not put to Alex
- Evidence: RT-26: "The separate timer must still never run `/ws` and SQL in parallel if Alex reads 'one at a time' as
  covering HTTP — say it in the Alex message." AUDIT §2.7 / C-20 put writes on their own timer. 3-ops #10 says "one at a
  time" about `/ws` calls only.
- Fix: Alex item states plainly "the McLeod API calls run on their own timer, so one API call may run at the same time as
  the one SQL statement. Still one program, still one SQL connection. Is that within what you agreed?" Per answer: yes ⇒ as
  designed; no ⇒ `/ws` jobs join the SQL job loop and v2 records C-20's starvation cost (finance at 02:00 holds writes).

### EXT-12 [GAP] SQL review owed to Alex is under-listed
- mail.md:93-95: "When you add … send the new SQL file before it goes live". New statements in this program: B4's three
  `reference_number` statements (B :256-263), finance F3/F7 statements reading `drs_check`/`gl_summary` (spec D :873), the
  test-company parameter set (COUNCIL §2.13). 3-ops #12 names only "the reference-number routine review (B's file)".
- Fix: one regenerated `SILVICOM-READ-ROUTINE.sql` covering all three, attached to the one Alex message, each part marked
  with its apply-after date. Statements that are not yet written are named, with "the file comes before it runs" (the 11-13
  wording, which Alex accepted for Part 5).

### EXT-13 [GAP] Store distribution is a program-level dependency for every driver-side benefit, with no owner ask placed
- Evidence: 2-driver :63 "Net: today no driver uses the app at all"; RELEASE-GATE :132 Apple Individual "the open launch
  blocker" (conversion needs D-U-N-S, ~2 weeks+); age-rating, DSA trader status, privacy labels, Data Safety, review
  credentials all "owner action" (:133-136, :141). X.md §6.1 "real phone / stores / Approve and run — not placed".
  COUNCIL C-11 fixes the build gate but no owner ask exists.
- Consequence: MK3 writes come from driver taps; without a distributed app there is nothing to write.
- Fix: owner list item "start Apple Organization conversion now (D-U-N-S, support request), answer age-rating and DSA trader
  status, fill privacy labels and Play Data Safety, create the review org and credentials". Per answer: Android store first
  (no Apple dependency) and iOS pilot via external TestFlight (memory `apple-account-is-individual`); v2's MK3 canary
  names Android drivers.

### EXT-14 [GAP] McLeod is asked things our own server answers; asking only McLeod makes them slower
- `useServerTimezone`, `maxresultsize` (3-ops McLeod #2), audit days-to-keep (#12), the TLS certificate (#2): on a
  self-hosted install these are vmparams / config on Alex's server, and probes K6/K7/K8/K2 read them. Company ids (#3): K4.
- Fix: keep them in the McLeod list as "confirm", but mark in v2 that MK0 proceeds on the probe result and never waits for
  McLeod's text on these five. Only the cert fingerprint comparison needs a person (K2) — Alex can read it on his server.

### EXT-15 [GAP] 3-ops McLeod item 5 (operations list) misses reads other findings depend on
- Missing: TableRowService `GET /equipstatus/…/search` (OF-17 H1), `GET /callin/search` (OF-15 seven-day read),
  `GET /images/{id}` (spec D App. C #4, full file for the revised-RC API route), TableRowService `GET /stop/{id}` (spec D
  MK6 step 2), the driver options/code table for `reason_for_leaving` (OF-7 labels), `GET /stops/{id}` of the test company.
- Fix: list them in McLeod item 5 (merged list below). K5 still measures what is actually reachable.

### EXT-16 [GAP] Upgrade stability (meeting Q46) is dropped from the McLeod list
- Evidence: v1 B-MK2 "Are calls stable across upgrades? (meeting Q46, unanswered)"; GUIDE PDF Q46; 3-ops McLeod list has no
  such item. The 22.1→26.2 upgrade is live on the owner's table (QUESTIONS PDF §1).
- Build consequence is pre-decided (C U1: re-run Phase A/B after any upgrade), so this is a GAP in the ask, not in the build.
  Add one line; also v2 states "every LoadMaster upgrade = MK0 re-run before writes resume; writes switch `off` the night
  before an upgrade" (Alex tells us the date — add to the Alex list).

### EXT-17 [DUPLICATE] Webhooks (McLeod #13) and Symphony (#15) have no build consequence
- C U7: webhook present ⇒ "still polling … Recorded, not built". C U16: Symphony "no effect on this spec"; handoff:
  `driverAvailable` is HOS, not home time; Q-MK4 "Got it" to McLeod "not planned". Asking costs vendor attention and implies
  a dependency that does not exist.
- Fix: drop #13; keep Symphony only as one clause of the commercial item (EXT-8), labelled "for a later plan".

### EXT-18 [GAP] B-MK10 has no owner in the council's question list
- v1 B-MK10 and HANDOFF :159 "ask the owner for them once"; X.md:207 "OPEN — no spec closes it". COUNCIL §4 Q-1..Q-4 omits
  it. The 11-11 PDFs confirm: "Notes from the meeting" is blank in QUESTIONS, PREP and GUIDE.
- Fix: owner list item; consequence pre-decided: if not supplied, the McLeod message asks everything anew (it already does).

### EXT-19 [GAP] Owner decisions the council raised but did not put in its §4 list
- RT-25: O-1 approved a list that did not exist; v2's CHANGED D-MK rows need a ruling.
- RT-10: a standing OK for `release.yml` hotfix mode for agent-facing API changes during MK0/P-runs, or one nightly release per
  round-trip (budgeted).
- OPS-11 (conditional): residual-risk ruling if `/ws` ignores LoadMaster user security.
- O-7: Q-4 is the same item as AUDIT §5 O-7 "wording still owed" — one item, not two (DUPLICATE within the owner list).
- Fix: the owner list below carries them as one message, in this order.

### EXT-20 [GAP] Q-3's default while unruled is not stated
- COUNCIL Q-3 recommends "recruiters too"; OF-19 places "Hire again" under the named `recruitment.close_application`
  permission. If the owner does not answer, v2 must say which gate ships. The narrower one (the same holders as the hire
  close, which is already the owner's ruled gate, `hire.ts:42-43`) is not a workaround: it is today's rule. State it.

### EXT-21 [GAP] Samsara write token (v1 §6) is neither placed nor ruled out in council/audit
- v1 §6: "Creating the Samsara driver at hire needs a Samsara write token (ours is read-only)". Memory
  `samsara-api-token-is-read-only`. No v2 step. One line in v2's "not in this plan, because …" list (AUDIT §2.8 coverage
  rule) closes it.

### EXT-22 [ALREADY-ANSWERED] Items 3-ops presents as asks that the repo already answers
- Ingest host: the VM posts to `https://api.360.silvicominc.com` since 2026-10-27 18:29Z and AWS logs show the posts (memory
  `aws-migration-position`). The firewall already allows it; 3-ops item 3's "please confirm your firewall record" is an
  update to Alex's paperwork, not a question. Keep as a statement.
- Encryption for `/ws`: mail.md:79-80 "Use encryption … Do not run unencrypted" — already answers C U2's `http://` row.
- PII in logs: mail.md:89-90 already the rule (3-ops #11 is a restatement — keep as a statement).
- One program, one connection; SQL review before go-live; `name_of_spouse`: mail.md:38, :93-95, :89 — answered.
- Statuses A/P/D/V (mail.md:72-77) — answered; useful for K15/K16 interpretation.
- VM is the Windows "Board dedicated VM" (mail.md second message; `update-connector.ps1`); the owner already updates it over
  RDP. OPS-4's `-Check` can be run by us; Alex is told, not asked.
- O-1..O-8 ruled 2026-11-20 (AUDIT §5); Q-MK1..15 "go ahead" 2026-11-19.
- Meeting Q42 ("is the API licensed") — answered by the 11-19 purchase, verbally (EXT-8 asks for it in writing).

### EXT-23 [OK] What is closed properly
- Every MK0 unknown has a probe and a per-outcome build (3-ops K1–K24, C U1–U17), including "no test company" (OPS-2) and
  "Alex says no" (U17). The write-safety asks (OPS-1/2/3/11) are well-formed. The one-complete-list rule is followed in
  structure. The "never probe a write on production" rule is right and keeps X6 honest.

---

## 3. The two final consolidated ask lists

### 3.1 ONE message to Alex (To: Alex Tzakov · Cc: Alex Lockwood) — complete

Before sending: run the grants CHECK block under `silvicom_dispatch_ro` on `lme` and `dta`, so items 12–13 name only what
is still missing (memory `it-requests-are-one-complete-list`).

1. **(Alex Lockwood) Your written OK for a change to what you approved on 2026-09-24.** Silvicom 360 will also write to
   McLeod, only through McLeod's own API, never through SQL: (a) clear a stop when the driver completes it; (b) file BOL,
   POD, lumper receipt and rate confirmation to the order; (c) create a new hire's driver record, reactivate a returning
   driver, and update medical-card expiry, CDL expiry and termination; (d) set a truck or trailer in or out of service;
   (e) write an ETA. Each one is off until it is proven on a test company and switched on alone. The SQL login
   `silvicom_dispatch_ro` stays SELECT-only. Nothing connects into your network.
2. **The VM.** It is the Windows Board VM (task "Silvicom 360 connector", runs as SYSTEM), not the Linux VM in the 09-24 note.
   Please tell us: who on your side holds admin on it; that its clock syncs time; and the date of any LoadMaster upgrade
   at least one day before (we switch writes off that night and re-check the API after it).
3. **Network.** Unchanged: LME `10.0.1.171:1433`. Already changed on 2026-10-27 and working: HTTPS to
   `api.360.silvicominc.com` (it replaced the Railway address — please update your record). New: HTTPS from the VM to the
   McLeod API host on your LAN (McLeod gives the host). Still nothing inbound. Also: is the public address our API sees
   from the VM fixed? We only accept McLeod work from that address; if it changes, tell us the day before.
4. **The integration user in LoadMaster (you create it, after McLeod enables the API).** Web-user type `Users` only, named
   `S360API` so dispatchers recognise it on a stop's history; a security profile that denies billing, settlements,
   deductions, payroll, wires, order entry and every delete; and an API token for it (we prefer a token to a password
   login). When it exists, please read the LoadMaster user monitor before and after our first login, to see whether it
   takes a licence seat.
5. **The secret.** The McLeod token is typed by a person at a hidden prompt into its own file `mcleod-ws.env` on the VM
   (SYSTEM and Administrators only), separate from `connector.env`. It never leaves the VM, a log or our repository. You
   may hold it instead of us — your choice.
6. **How you stop it at once, without us.** (a) Disable `S360API` or delete its token in LoadMaster: every call stops.
   (b) On the VM, `set-mcleod-api.ps1 -Writes off` (writes only), or stop the task (everything). On our side: a switch per
   operation and an API master switch.
7. **What a stop clear does in your LoadMaster** — needed in writing before the first live write: for a pickup and a
   delivery, first stop and last stop, which of these a clear starts: movement/order status, EDI 214 to the shipper,
   customer notifications, ready-to-bill, driver pay/settlement, tractor location/hub, a service-failure record. Then the
   exact LoadMaster steps to undo a wrong clear, including after a 214 went out and after ready-to-bill; and whether a
   dispatcher can see that `S360API` made the clear.
8. **Rollout and dispatch.** After go-live a driver's Complete clears the stop; dispatchers can still clear by hand and 360
   never overwrites a time McLeod already has. Order: pickups first, then deliveries for non-EDI customers, then EDI
   customers. Please send the list of customers that are EDI.
9. **Service failures.** We send each clear with "not reportable" and no delay code. McLeod may still create a
   service-failure record without a code when the stop is late. Is that acceptable to your dispatchers? If not, only
   pickups are written until McLeod gives a way to clear without one.
10. **Call-ins (for ETA, later).** Does a call-in in your LoadMaster send anything to a customer — EDI 214, e-mail or a
    portal update — for any customer? If yes, we never write the ETA as a call-in.
11. **Test company.** Is there a test company or test server we may write to, with copies of drivers, tractors and
    customers? If not, for the stop clear only: a test customer with no EDI partner and no notification contacts, not
    billable; a driver `S360TEST` excluded from settlements; a yard tractor; one test order with two yard stops; and you
    rehearse the undo of item 7 by hand once before our first call. Driver records, record updates and files are never
    tried on the live company.
12. **SQL grants — the SAME request as my 11-13 email, not a new one.** Already done, thank you: Part 5 and
    `billing_history`, `drs_deduct_hist` (11-17). Still open: the 13 tables of Part 4 on LME (names listed), plus two
    lines added since: `drs_check`, `gl_summary` (read-only; no personal data beyond a payee id). Not needed any more:
    the copy refresh and Part 2 on the copy from the 11-13 email.
13. **Imaging (Part 6) — the SAME request the owner sent on 11-18.** One status line only (running / still open).
14. **SQL for your review before it runs** (as agreed): the regenerated routine file with (a) three statements reading
    `reference_number` for the pickup number, (b) the finance statements that read `drs_check` and `gl_summary`, (c) the
    test-company read — the same statements with the test company as the parameter, posted to a test organisation in 360.
    Still one program and one SQL connection. The McLeod API calls run on their own timer, so one API call may run while
    the one SQL statement runs. Is that within what you agreed?
15. **Volume on McLeod's server.** At most one API call at a time, at least half a second apart; about 230 stop clears a
    day with 2–3 reads each; during the one-week comparison, about one read per changed movement every 15 minutes.
16. **Logs.** Unchanged: counts, times and McLeod ids only; no addresses, licence numbers or McLeod's message text.
17. **Order of visits** (we prepare each; you or Miki run it): code update with everything off → API settings and
    read-only discovery → comparison reads on → writes on for the test company → after your OK on items 7–9 and the owner's
    sign-off, the first live operation.

### 3.2 ONE message to McLeod (via Ron) — complete

1. **Enable** the Direct-Hosted `/ws` API on our self-hosted LoadMaster 22.1 production and on a test company or test
   server. If 22.1 cannot, which version is needed. Does enabling need a restart or downtime window?
2. **What the API Kit order covers, in writing:** Direct-Hosted `/ws` on 22.1; any per-user, per-seat or per-call charge;
   the test company; the named technical contact for enablement. (For a later plan, one clause: is Symphony licensed?)
3. **Address and certificate:** the `/ws` base URL; its TLS certificate (PEM) and SHA-256 fingerprint; whether the name on
   it is a DNS name. Confirm `loadmaster.ws.useServerTimezone` and `loadmaster.api.maxresultsize` (we also read them).
4. **Company ids:** `AnywhereCompanyID` for TMS, TMS2, TMS3, TMS4 and the test company; is it `company.id` or the instance
   code?
5. **Integration user (our IT creates it in LoadMaster):** the steps; type `Users` only. Does LoadMaster user security
   (menu/table permissions) apply to `/ws` calls? Can the user be denied billing, settlement, deduction, payroll, wire,
   order entry and all deletes while keeping item 6?
6. **Operations that user must reach.** Reads: `GET /metadata`, `/movements/search`, `/movements/{id}`, `/stops/{id}`,
   `/auditTransactions/search`, `/drivers/new`, `/drivers/{id}`, `/drivers/search`, `/tractors/{id}`, `/trailers/{id}`,
   `/images/{rowType}/{rowId}`, `/images/{id}`, `/images/{rowType}/{rowId}/documentTypes`, `/serviceFailures`, and
   TableRowService reads of `stop`, `callin`, `equipstatus` and the driver's leaving-reason codes. Writes:
   `POST /dispatch/clearStop/{id}`, `POST /images/{rowType}/{rowId}/{documentTypeId}`, `PUT /drivers/create`,
   `PUT /driver/update`, `PUT /tractors/update`, `PUT /trailers/update`, `PUT /stop/update`, `PUT /callins/create`,
   `PUT /equipstatus/create` (as `Users`, since EquipStatusService is Drivers-only); `POST /users/login|logout`.
7. **Sign-in:** token or `/users/login`? Token lifetime? Does a login hold a concurrent licence seat, and what
   `X-com.mcleodsoftware.LicensingAgent` value should an integration send?
8. **`clearStop`:** departure-only accepted? must the stop be the next uncleared one? a second call on a cleared stop? a late
   stop with no `delayCode` — refused, or a service-failure record created? Does it run the same logic as a dispatcher's
   clear (status, EDI 214, notifications, billing, pay)? HTTP codes and the refusal text.
9. **Un-clear:** any `/ws` way to un-clear a stop? (We expect none.)
10. **Call-ins:** does `PUT /callins/create` with `new_eta` update the stop's ETA, and can it trigger EDI 214 or customer
    notifications?
11. **TableRowService:** which fields of `stop`, `driver`, `tractor`, `trailer` accept updates; does `PUT /stop/update` with
    `eta` run dispatch logic; any concurrency check; does deactivating a driver who holds a truck or a load get refused?
12. **`drivers/create`:** required fields on our install; is `social_security_no` required (we will never send it).
13. **Images:** on our install, does `POST /images/...` file into DocumentPower (the imaging server billing uses)? Does it
    need the DocumentPower third-party image module, and is it licensed? Is it stored at once or staged, and how long until
    it is listed? May we read our own `/ws/docs` pages for our tests (not redistributed)?
14. **Audit:** is audit on for `movement` and `stop`, and for how many days; `audit_log_tx` purge.
15. **Rate and upgrades:** any call limit (our plan: ≤ 2 per second, one at a time, ~1,000 calls a day); do `/ws` calls stay
    the same across upgrades, 22.1 → 26.2 included?

(Dropped from 3-ops: #13 webhooks — no build consequence, EXT-17. Symphony folded into item 2.)

### 3.3 ONE message to the owner (not in COUNCIL §4; included because the plan stalls without it)
1. Q-1 and the O-7 sentence (= Q-4), in one reply. 2. Q-2. 3. Q-3 (default if unanswered: the hire-close gate). 4. The 11-11
meeting notes and the 11-19 Ron thread, if any exist (B-MK10). 5. Re-approval of v2's D-MK rows marked CHANGED (RT-25).
6. Standing OK (or not) for `release.yml` hotfix mode for agent-facing API changes during MK0 (RT-10). 7. Start the Apple
Organization conversion; answer age-rating and DSA trader status; privacy labels; Play Data Safety; review org and
credentials (RELEASE-GATE Gate D). 8. Name one dispatcher for V1 (3 loads) and one billing clerk for the 14-day readability
trial. 9. Who sends the two messages and when (the owner sends; Claude drafts).

---

## 4. Order to ask

1. **Owner, today** (§3.3): nothing external should go before item 9 (who sends) and before the two Alexes are confirmed.
   Apple conversion starts now because it is the longest lead (weeks) and is independent of McLeod.
2. **Alex and McLeod on the same day, Alex first by a few hours, Ron's message Cc Alex Tzakov.** Reason: McLeod enables `/ws`
   on Alex's server, and Alex's item 1 (Lockwood's OK) gates MK0 regardless of McLeod's speed; sending McLeod first would
   have McLeod at Alex's door before he has heard of it. Both messages are complete; items that depend on the other party
   (Alex 4, 7, 11; McLeod 5) say "when … has done X", so no second message is ever needed.
3. **Nothing waits for answers:** N1–N9, S0, C PR-1..4 (dark), MK2's F0/F12b/C1, DB7 measurement, store readiness all
   start the day the messages go.
4. **Time box:** 10 business days, then the EXT-1 escalation. The progress log records each answer with date and source.

Program-wide blockers (any one stops all API work): X1 `/ws` enabled, X2 URL/cert, X4 integration user, A1 Alex Lockwood's
OK, A2 firewall. Write-wide: X6 test company (except stop_clear canary), O8 SSM/token. Driver-side-wide: S1 store. Everything
else blocks one feature.

---

## 5. Summary

Counts: BLOCKER 1 · GAP 17 · DUPLICATE 2 · ALREADY-ANSWERED 2 · OK 1 (23 findings). Dependency table: 43 rows (18 McLeod,
11 Alex, 9 owner, 1 store, 2 staff, AWS 1, Samsara 1; AWS and Samsara have no live external ask).

Top 10:
1. EXT-1 — No "never answered" end state: time-box 10 business days; A1 silence is a hard stop with no non-workaround fallback.
2. EXT-2 — Two Alexes: Lockwood must give the posture OK, Tzakov operates; one message, To Tzakov, Cc Lockwood.
3. EXT-3 — Part 5 and 2 of Part 4 already ran 11-17; ask only the 13 remaining Part 4 tables + `drs_check`, `gl_summary` as the SAME request; grants file header is stale.
4. EXT-9 — Not asked: does a `/ws` image land in DocumentPower on our install (LME image tables are empty; WS.md:241 names a DocumentPower module) — else MK4 "confirms" files billing never sees.
5. EXT-13 — Store distribution blocks every driver-side benefit; no owner ask is placed; Android first, external TestFlight meanwhile.
6. EXT-4 — Part 2 re-run and copy refresh must be WITHDRAWN in words, not re-asked.
7. EXT-10 — Council-required Alex questions missing from 3-ops: call-in customer messages (C-18), un-coded service-failure acceptability (Q-2).
8. EXT-7 — Integration user creation assigned to both McLeod and Alex; assign to Alex, McLeod gives the steps.
9. EXT-6/EXT-11 — Egress-IP stability for the C-7 pin, and `/ws`-concurrent-with-SQL under "one connection", are not asked.
10. EXT-5/EXT-12/EXT-19 — Part 6 status, the full SQL review set, and four owner decisions (RT-25, RT-10, OPS-11, B-MK10) are not carried into any list.
