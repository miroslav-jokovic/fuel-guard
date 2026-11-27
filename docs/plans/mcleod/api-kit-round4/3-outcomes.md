# Round 4, reviewer 3: per-outcome builds + unexamined risks (2026-11-20)

Repo `/Users/miroslavjokovic/Projects/FG-mcleod-api` @ `274dd5459`. Read-only. Read: ROUND3 (all), api-kit-round3/3-external.md
(all), 1-assumptions (rows/blocks cited), 4-redteam R3-5..R3-19, api-kit-council/3-ops.md (findings + K1–K24), 1-pipeline
P-17/P-20/P-21/P-25 + DDL, 5-redteam RT-10/RT-13, specs C §5.8–§7, A §6.3, D MK5-0c/0d, MK6.1/6.2, audit A-35/A-36.
Code read: `modules/messaging/notify.ts`, `shared/notificationsContract.ts`, `shared/alertRouting.ts`,
`modules/financial/financialFreshness.ts`, `modules/loads/dispatchLoads/exceptions.ts`, `loads/routes/dispatch.ts`,
`shared/auth.ts` SECTION_ACCESS, `infra/server/{production.env,compose.yml,fetch-settings.sh,deploy.sh,Caddyfile}`,
`docs/WORKER-DEPLOYMENT.md`, `docs/DEPLOYMENT.md` §Parameter Store, migration 0380.

Legend: DEFINED = a document names the build for that outcome (cited). UNDEFINED = no document does; the build given is the
text v2 should carry.

---

## A. Per-outcome table

### A.1 ROUND3 §1 — the ten facts others supply

| Fact | Outcome | Status | Build / cite |
|---|---|---|---|
| F1 `/ws` on 22.1 + URL/cert | present, works | DEFINED | C U1 row 1; MK0/MK1 proceed |
| | 404; McLeod says 26.x needed | DEFINED for the API program only | C U1 row 2: everything dark merges, MK1+ wait. **Nothing anywhere for what the upgrade does to the SQL connector** — see next row |
| | 26.x upgrade happens (because of /ws or otherwise) | **UNDEFINED** | See R4-1. The SQL connector (`tools/mcleod-agent/queries.mjs`, ~90 KB of column-named SELECTs) and every 360 McLeod reader (loads mirror, roster sweep, finance, lumper, settlements, fuel tax) read LME's schema directly. The plan's only upgrade rule is "re-run `/ws` Phase A/B" (C U1, EXT-16). Build for v2: (1) Alex gives the upgrade date ≥ 1 day ahead (already Alex item 2); (2) a new `agent.mjs --schema-check` (reuses `inspect.mjs`'s `information_schema.columns` read, `inspect.mjs:175,251`) compares every (table, column, type) the statements read against a committed manifest generated from `queries.mjs`; (3) the night before: writes `off`, parity `off`; (4) after: `--schema-check` + the grants CHECK block + Phase A/B; each SQL feed resumes only when its statements pass; a failing statement stays off and its freshness stamp goes stale (already alerts); (5) if McLeod can supply the post-upgrade schema early, run `--schema-check` against a restored copy (`lme_analytics`) first. Plus: the McLeod message asks upgrade **cost and downtime**, not just "which version" (R4-12) |
| | present but `clearStop` absent | DEFINED | C U1 row 3 |
| | present but McLeod says "works on 22.1, not supported" | **UNDEFINED** | Reads may proceed (they are read-only and our risk). Writes need McLeod's written support statement for 22.1 or the upgrade; record as a switch precondition, not a guess |
| | no answer ever | DEFINED | EXT-1 / ROUND3 §3 silence rule: 10 business days → owner escalates; non-dependent work continues |
| | URL/cert never sent by McLeod | DEFINED | EXT-14: Alex reads the cert on his server; K2 pins |
| F2 write-capable test company | same server | DEFINED | C U8 row 1; ROUND3 §2.4 test mode |
| | separate test server | DEFINED for `/ws`; **UNDEFINED for SQL** | C U8 row 2 covers a second `/ws` profile. But §2.4's "test company read into the real org" assumes the test company is in `lme` (Alex item 14c). On a separate server our SQL login does not reach it, and a second SQL connection breaks "one program, one connection". Build: in that case no SQL lane for the test company; proving uses `/ws` read-back only (P1–P6 already do); W5 (board-vs-McLeod check) is skipped for test companies and says so; `test_companies` predicate still applies to nothing |
| | exists but is not a copy (no drivers/tractors) | DEFINED-partly | K20/K21 probes need rows; Alex item 11 asks for copies. If absent, the probe for that kind waits: equivalent to "none" for that kind |
| | none, ever | DEFINED but **contradicted** | X6/OPS-2: only `stop_clear` via live canary; driver create, row updates, images never switched on. ROUND3 §2.4's rule ("`canary` needs a confirmed `test` request, **or**, when the org has no test company, the owner's recorded sign-off") is not limited to `stop_clear` and has no recorded-sign-off column in the DDL (1-pipeline switches table: `proven_by_request` required for canary). See R4-3 |
| F3 Lockwood's OK | yes | DEFINED | U17 yes |
| | no | DEFINED | U17 no + EXT-1: hard stop, no reads either (A1) |
| | silence | DEFINED | EXT-1 |
| | **yes with conditions** | **UNDEFINED** | See R4-2. Build: every condition is mapped in v2 to an existing lock or the operation stays `off`: scope limit ("stop clears only", "no driver create") → those operations never get an L2 row other than `off`, recorded as the reason; time window ("business hours only") → `canary_scope`/switch row gains `allowed_hours` and `begin_send` refuses outside it (one rule, tested), not an agent cron; "reads only" → MK1 only, U17 no-branch for writes; "review every new statement/endpoint" → the path allowlist (`WS_PATH_ALLOWLIST`) grows only with a dated Alex OK cited in its comment; "no concurrency with SQL" → EXT-11's no-branch; a condition that maps to no lock → that operation stays off and the condition goes in the plan's open questions. The conditions are filed verbatim beside `MCLEOD-STOP-CLEAR-EFFECTS.md` |
| | yes, but later withdrawn | **UNDEFINED** | Same as OPS-3 kill list (Alex disables `<integration user>`); v2 should state that a withdrawal = every L2 row `off` + VM `-Writes off`, and the request backlog is left `queued` (72-h stale rule keeps it from flushing) |
| F4 `clearStop` effects + undo | none beyond times | DEFINED | C-19 rollout as written |
| | triggers EDI 214 on deliveries only | DEFINED | OPS-1/OPS-18: non-EDI customers first, EDI last |
| | **triggers EDI 214 on pickups too** | **UNDEFINED** | See R4-4. Every fallback says "pickups first (no billing effect)" and A4 says "if rollout cannot be staged by customer ⇒ only pickups go live" — both assume a pickup clear leaves nothing outside the building. Build: if a pickup clear sends a 214, the canary scope is **non-EDI customers for both stop types**; if Alex cannot list EDI customers, MK3 stays off (no "pickups only" fallback) |
| | triggers ready-to-bill on last delivery | **UNDEFINED (process)** | Billing starts from a driver tap. Build: billing is told before deliveries go live (R4-9); the office help text links the undo after ready-to-bill (OPS-1 (2)) |
| | triggers driver pay / settlement | **UNDEFINED (process)** | A phone time now feeds pay. OPS-7 bounds the time; v2 should add: deliveries go live only after one settlement period of pickups with zero `conflict`, and payroll is told |
| | creates service failures | DEFINED | K17, Q-2, A5 |
| | Alex does not know / never answers | DEFINED | A3: McLeod X7 + K18-T observation; else MK3 off |
| | undo impossible after 214 | DEFINED-partly | OPS-1: non-EDI first; no undo exists, so it is a residual the owner accepts with S2 |
| F5 image destination | lands in DocumentPower | DEFINED | EXT-9 |
| | lands only in LME tables | DEFINED | EXT-9: MK4 stays off |
| | needs DocumentPower module we don't own | DEFINED | EXT-9: owner buys or MK4 stays off. Price unknown → R4-12 |
| | Part 6 (`dta` read) never granted, so EXT-9's independent `bolimgd` check cannot run | **UNDEFINED** | Without Part 6, "confirmed" rests on `GET /images` — the ambiguous source EXT-9 warns about. Build: MK4 cannot go `live` without the `bolimgd` check; if Part 6 never runs, the substitute proof is a billing clerk confirming N named orders in DocumentPower's viewer, filed as the P-report for MK4 |
| F6 date mode / precision / zone | `useServerTimezone=false` (offset) | DEFINED | OPS-13, K6 |
| | `true` (zone-less, server zone Central) | DEFINED | OPS-13 `server_central`; R3-7 (adopted by §0): repeated DST hour → `conflict ambiguous_local_time` |
| | `true` and the app server's zone is **not Central** | **UNDEFINED** | `server_central` hard-codes Central; the only zone evidence is the SQL server's `-05` (`centralTime.mjs:6-8`), a different box. Build: mode `server_local` with an IANA zone written by `set-mcleod-api.ps1` from a measured comparison (one cleared stop's `/ws` string vs the SQL mirror's value for the same stop); writes refused until set |
| | stored precision seconds vs minutes | DEFINED | minute-equality rule (C §2.2, R3) |
| F7 token revocation | disable user → next call 401 at once | DEFINED | 1-assumptions row 14: keep as switch #1 |
| | revoked only by deleting the token | DEFINED | row 14: switch #1 = delete the token |
| | **neither revokes until expiry** | **UNDEFINED** | See R4-5. Build: v2 removes "instant stop" from the Alex message and the kill list; fastest stop becomes L2 `off` (≤ 15 s + one in-flight request at claim size 1) and VM `-Writes off`; prefer `login` mode with a short lifetime over a long-lived static token, so a leaked credential dies by itself; if lifetime is also unlimited → owner ruling like Q-7 before L3. Note the probe is read-only (disable, then one read) and is safe on production, not "test company only" |
| | McLeod never answers | DEFINED-partly | The probe answers it; v2 should say MK0 runs it regardless of McLeod's text |
| F8 VM egress IP | static (Alex confirms) | DEFINED | §2.13: refusal rule |
| | dynamic / unknown / Alex silent | DEFINED | §2.13: recorded + alert only |
| | static, but a second carrier's agent | **UNDEFINED** | `MCLEOD_AGENT_EGRESS_IP` is one SSM value (3-ops OPS-8; 2-sequence T-3). See R4-7 |
| | changes often (alert storm) | **UNDEFINED** | §2.13 alerts on every change; on a dynamic address this is daily noise. Build: the alert is per org per day (dedupe key `mcleod_egress_ip:<org>:<day>`), severity info when no pin is set |
| | VM already on `api.360` | DEFINED | EXT-22 (since 2026-10-27) |
| F9 store release | Apple converts in weeks | DEFINED | Q-5 |
| | **Apple conversion delayed months** | DEFINED-partly | Q-5 + EXT-13: Android first, iOS via external TestFlight. Not stated: TestFlight builds expire after 90 days, so the iOS pilot needs a cut at least every 90 days through the gated `driver-store.yml` (C-11 corrected) — a release-train cadence item, not a build. Also Android already has the APK lane (`driver-android.yml`, `apps/driver-dist`) which needs no store at all; v2 should say whether the `driver_app` canary may use it |
| | Apple rejects under 5.1.1(ix) even after conversion | **UNDEFINED** | Out of this plan's control; v2 should say the iOS drivers stay on external TestFlight and MK3 canary names Android drivers (EXT-13) until review passes — i.e. the same branch, stated as permanent-until |
| | Google Play account is personal, not organisation | DEFINED-partly | DIRECTION-B P8 notes the 12-tester/14-day closed track applies only to new personal accounts; whether ours is one is not recorded. Owner item |
| F10 owner rulings Q-1..Q-8 | each answered / unanswered | DEFINED | each has a default: Q-1/Q-4 create/reactivate off; Q-2 pickups only; Q-3 narrower gate (EXT-20); Q-6 no → one release per round-trip; Q-7 no → stop; Q-8 14 days |
| — | **McLeod price/terms differ from the verbal $750** | **UNDEFINED** | X16: "Not pre-decided … owner's commercial risk". See R4-12 for the per-outcome build |

### A.2 3-ops MK0 probe table K1–K24

| Probe | Outcome | Status | Build / cite |
|---|---|---|---|
| K1 | present / 404 / clearStop absent | DEFINED | C U1 |
| | some services missing (images, TableRowService) | DEFINED | K5/K9: capability row drops the kind |
| K2 | CA+DNS / self-signed+name / no name / http only / rotates | DEFINED | C U2 (5 rows) |
| K3 | token / login | DEFINED | U4, OPS-10 |
| | **login token lifetime < 15 min** | **UNDEFINED** | OPS-10 caps re-login at once per 15 min; a shorter lifetime stalls every call for the rest of the window. Build: re-login cap = min(15 min, measured lifetime ÷ 2), set from K3's time-to-first-401 |
| | token not revocable | UNDEFINED | F7 row above |
| K4 | identity / translated / one header sees all | DEFINED | U3 + OPS-12 company compare in precheck |
| K5 | deny list honoured / money reachable / audit 403 | DEFINED | OPS-11 → Q-7; U14 |
| K6 | offset / zone-less Central | DEFINED | OPS-13, R3-7 |
| | zone-less non-Central | UNDEFINED | F6 row above |
| K7 | ≥ 7 d / < 7 d | DEFINED | U5 |
| K8 | offset honoured / not | DEFINED | C-33 |
| K9 | key present / missing | DEFINED | capability row |
| K10 | distinct codes / not | DEFINED | "wire to what we saw" |
| K11 | SSN key present / absent | DEFINED | OPS-15 |
| K12 | webhooks none / present | DEFINED | U7 (and EXT-17 drops the ask) |
| K13 | confirmed, audit user = integration | DEFINED | R §2.2 |
| | **confirmed, but audit user is generic/`system`** | **UNDEFINED** | OPS-1 (3) and OPS-18 rely on dispatchers seeing `<integration user>` on the stop. Build: if not distinguishable, the help text and Alex item 7 say so, and 360's stop badge is the only marker; Alex is asked whether that is acceptable before deliveries go live |
| | times off by whole hours | DEFINED | K6 mode wrong → P2 read-back fails → writes refused |
| K14 | departure-only 2xx / 4xx | DEFINED | A §6.1, U10 |
| K15 | refused / overwritten / ignored | DEFINED | precheck; verify read-back catches "ignored" as `conflict` |
| K16 | refused / clears both / clears 2 only | DEFINED | K16 row + R3 §2.6 agent clears in order |
| K17 | refusal / SF created | DEFINED | K17, Q-2 |
| K18 | each effect | partly | F4 rows above (214 on pickups, pay, ready-to-bill UNDEFINED) |
| K19 | stored / staged | DEFINED | D-19; landing place EXT-9 |
| K20 | SSN required / not | DEFINED | D-59 |
| K21 | writable / not, per field | DEFINED | capability row |
| K22 | call-in moves ETA / not / sends 214 | DEFINED | O-8, OF-15 |
| K23 | seat held / not | DEFINED | token mode mandatory |
| | **seat held and token mode unavailable for a `Users` type** | **UNDEFINED** | Login mode then consumes an office seat. Build: logout after every batch, one session max, and the owner rules whether to buy a seat (McLeod price item) — else MK1 parity (15-min reads) does not run, only writes |
| K24 | none / 429 | DEFINED | U15 |

---

## B. Findings

### R4-1 [GAP] A LoadMaster upgrade has a `/ws` procedure and no SQL one, though every 360 McLeod reader is SQL
- Evidence: the only upgrade rule anywhere is "re-run Phase A/B" (C U1 row 2, `C-transport.md:769`; EXT-16). `git grep -i
  upgrade` over `docs/plans/mcleod` and `tools/mcleod-agent` finds nothing about schema, grants or the SQL statements. The
  connector reads LME by column name (`tools/mcleod-agent/queries.mjs`, 89.8 KB), with column-level grants on `driver`
  and `customer` (EXT-3 note on Part 1). 22.1 → 26.2 is five major versions; the owner's QUESTIONS PDF §1 has it on the table,
  and F1's 404 branch makes it the price of the whole API program.
- Consequence: an upgrade that renames/drops a column fails that statement (caught: the cycle fails, freshness goes stale); one
  that changes a code's meaning or moves data to a new table passes silently. A re-created table can drop Alex's grants. None of
  this is rehearsed, and fixing it needs a release plus a VM visit (release train, RT-10).
- Build: the five steps in the F1 table above (`--schema-check` from a committed manifest, writes/parity off the night before,
  grants CHECK + Phase A/B + schema check after, each SQL feed resumes only on pass, dry run on a restored copy when possible).

### R4-2 [GAP] "Yes, with conditions" from Lockwood has no build
- Evidence: U17 has two rows, yes and no (`C-transport.md:806-807`); A1 in 3-external is "yes / no". Lockwood already set
  conditions once (09-24: one program, one connection, logs, SQL review — `mail.md:38,89-95`), so a conditional answer is the
  likely one.
- Build: the mapping rule in the F3 row: every condition maps to an existing lock (operation never leaves `off`; allowlist line
  only with a dated OK; EXT-11 no-branch) or to one new, tested rule (`allowed_hours` in the switch row, checked in
  `begin_send`). A condition that maps to nothing keeps that operation `off` and goes to open questions. Never an agent cron
  or a hand-kept list.

### R4-3 [GAP] §2.4's "owner sign-off when no test company" is not limited to `stop_clear` and has nowhere to be recorded
- Evidence: ROUND3 §2.4: "`canary` needs a confirmed `test` request, **or**, when the org has no test company, the owner's
  recorded sign-off". OPS-2 and X6: without a test company, driver create, TableRowService updates and images are **never**
  switched on. The adopted DDL (`api-kit-council/1-pipeline.md` switches table) requires `proven_by_request` for `canary`
  (`mcleod_write_switches_proof`) and has no sign-off column; the insert trigger requires a confirmed `prove` request.
- Consequence: v2 either cannot implement the no-test-company branch at all (the constraint refuses it), or implements a
  generic sign-off that also opens `driver_create` on the live company, which OPS-2 forbids.
- Build: add `signoff_ref text` (the filed sign-off document's path + date) to the switch row; the trigger accepts
  `canary` without a `prove` request only when `operation = 'stop_clear'`, `signoff_ref` is set, and the org has no
  `test_companies`; every other operation keeps the `prove` requirement. A matrix test title pins "driver_create canary
  without a prove request is refused even with a sign-off".

### R4-4 [GAP] The rollout's "pickups have no external effect" is an assumption every fallback rests on
- Evidence: C-19/OPS-18 "first pickups only (no billing effect)"; A4: "Rollout cannot be staged by customer ⇒ only pickups go
  live (no billing effect)"; Q-2 default "pickups only". 1-assumptions block 4 lists "pickups have no billing effect" as
  ASSUMED. Alex item 7 asks for effects per stop type, but no build branch exists for "a pickup clear sends a 214".
- Build: F4 row: a 214 on pickups ⇒ canary scope is non-EDI customers for both stop types; no EDI list ⇒ MK3 off; the
  "pickups only" default of Q-2 and A4 becomes "non-EDI pickups only".

### R4-5 [GAP] "The instant stop" has no branch for a token that cannot be revoked
- Evidence: COUNCIL :56 and OPS-3 #1 name "Alex disables the McLeod user/token" as the true instant stop and the Alex
  message (item 6) promises it. 1-assumptions row 14 covers "instant" and "only by deleting the token"; not "neither".
- Build: F7 row. Also: the probe (disable, one read, re-enable) is read-only and safe on production; v2 should run it in
  MK0 Phase A rather than wait for a test company.

### R4-6 [RISK] Alerts reach the wrong people for every kind except stop clears, and only by bell + one org mailbox
- Evidence: spec C §5.8: findings go to `sectionManagerIds(admin, orgId, "dispatch")` ∪ "`surfaceHolders`-style holders of
  `mcleod.connection`" + `organizations.notification_emails` (the `runFinancialFreshnessOnce` pattern,
  `financialFreshness.ts:181-235`). Facts in code:
  - Office delivery is the bell (`notification_events`) and the org-level email list. `notify()` pushes only through Expo
    (`notify.ts:136+`, driver app); office Web Push exists only for chat (`chatPush.ts`, `envWebPush.ts`). A W2/W3 critical at
    02:00 reaches nobody until morning unless `notification_emails` is watched.
  - `mcleod.connection` is an `ADMIN_ONLY_CAPABILITIES` key (`shared/namedGrants.ts:50`), **not** a surface;
    `surfaceHolders()` throws for a key not in `SURFACES` (`org/surfaceHolders.ts:17-18`). The recipient set as written does
    not run.
  - W7 (each refusal/conflict) is one pipeline-wide audience. MK5's `driver_update.medical` / CDL updates are worked by
    `safety: manage` (admin, fleet_manager, safety_manager — 4-office.md:285); safety_manager has `dispatch: none`
    (`auth.ts:144`), so a refused medical-card update never reaches the person who asked for it; same for a recruiter's
    `driver_create` (`recruiter: dispatch none`, `auth.ts:156`). Spec D shows MK5 conflicts only on the row itself
    (`D-office-finance-docs.md:503, 644-647`) — a pull, not a notice. A refused medical update leaves McLeod with the old
    expiry silently.
  - The alert-routing catalogue (`shared/alertRouting.ts`, NOTIFICATION-ROUTING-PLAN D-NR1..3) is the carrier-editable home
    for "which alert goes to whom" and already carries lumper and roadside alerts; the plan restates a recipient list beside it
    (the CLAUDE.md "hand-written role list beside a derived matrix" pattern). No `NotificationCategory` is named for W1–W7;
    a new category needs a `notification_events` CHECK migration (the 0207/0465 pattern), which no migration list carries.
- Build: W1–W7 become `ALERT_CATALOGUE` entries (category per audience: `mcleod_connector` for W1–W3/W6 → admins by bell +
  email; `mcleod_write_refused` per kind with `section` = the kind's section — dispatch for stops/images/ETA, safety for
  medical/CDL, recruitment for create, equipment for unit status), defaults derived with `rolesThatManage(section)` like
  `ROADSIDE_REPAIR_DEFAULTS`; the CHECK migration is listed in v2's migration order; W2/W3 critical go to admins by SMS too
  (the catalogue's `sms` channel exists) because nothing else wakes anyone.

### R4-7 [RISK] Two single-tenant assumptions survive in the transport
- Evidence: (a) `MCLEOD_AGENT_EGRESS_IP` is one value in SSM (OPS-8; 2-sequence T-3; 3-external O8) — one carrier's VM. A second
  McLeod customer's agent would be refused, or the pin would be dropped for both. SSM values load only at deploy
  (`DEPLOYMENT.md` §Parameter Store: "Loaded at deploy, not live"; `fetch-settings.sh`), so an IP change also needs a production
  redeploy (`aws-production.yml` dispatch) before writes resume. (b) L1 `MCLEOD_API_WRITES` is fleet-wide: once on for this
  carrier, another tenant's only gates are its own admin's L2 row (`requireAdminOnly`) and our VM install; the A1 "Lockwood's
  written OK" precondition is paper for this carrier, and nothing in the system records an equivalent IT OK per tenant.
- What is fine: switches, `test_companies`, capabilities (RT-13 asks `org_id`), ingest/write tokens are per org.
- Build: the pin moves to the per-org write-token row (`egress_ip inet null`, set by `issueMcleodToken.ts --scope=writes
  --egress-ip`), read per request — no SSM value, no redeploy on change; and the switch row's `reason`/`signoff_ref` for the
  first non-`off` row of an org must cite that carrier's IT approval (R4-3's column), checked by the trigger as non-null.

### R4-8 [RISK] The exceptions feed can carry the new kinds, but its two reads are capped at 1,000 rows
- Evidence: `listExceptions` (`loads/dispatchLoads/exceptions.ts:80-100`) reads `load_events` `.in("kind", EVENT_KINDS)` over
  30 days and every `exception_resolved` over 30 days, neither paged nor limited. PostgREST caps each at 1,000 (memory, RT-13).
  The resolved read has no order, so once an org has > 1,000 resolutions in 30 days an arbitrary subset is missing and resolved
  exceptions reappear. The plan adds `unmatched_assignment`, `evidence_after_reassignment`/`late_evidence`, `stop_removed_in_mcleod`,
  `time_out_of_bounds`, write `refused`/`conflict` (SEQ-14, C-10, OPS-7, P-25) — at ~230 clears/day, an outage day alone can make
  hundreds. Who sees it: `GET /exceptions` is `requireSection("dispatch","view")` (`dispatch.ts:60,197-203`) — admin,
  fleet_manager, dispatcher, auditor; not safety, recruiting or billing (same audience problem as R4-6).
- Also unresolved: ROUND3 §2.24 names the kind `late_evidence`; SEQ-14 names it `evidence_after_reassignment`. Pick one (§2.24
  wins by precedence, but SEQ-14's text will be copied).
- Build: P-25's recommendation (the feed reads the McLeod write state through a `mcleod` module export, not `load_events`) for
  the write kinds; the two `load_events` reads become one RPC returning open exceptions (anti-join on `resolves` in SQL), so no
  cap applies; MK5/MK4 refusals are listed on their own section's page, not in the dispatch feed.

### R4-9 [GAP] No rollout or communication step for the people whose work changes
- Evidence: the only "dispatcher" items are Alex message items 7–9 (what LoadMaster does, rollout order, "dispatchers can still
  clear by hand"). `git grep -i "training|announce|tell the dispatchers|tutorial"` over the plan layers finds nothing but
  tutorial **fixtures** (B-data-fixes :474, :792). The carrier's own dispatchers and billing clerks — 360 and McLeod users —
  are never told; OPS-18 only asks Alex whether dispatchers know the un-clear path.
- What changes for them: (1) a driver's Complete now clears the stop, so a dispatcher who keeps clearing by hand races the
  write and produces `superseded_in_mcleod`/`conflict` rows (OPS-6) — and the plan never decides who is the clearer of record;
  (2) ready-to-bill / pay may start from a driver tap (F4); (3) billing sees 360-filed papers beside McLeod-capture ones (C-17
  relaxed); (4) the office must work a new refusal list; (5) the 15-min outage behaviour (stop actions "Not sent yet").
- Build: one step per kind before its first `canary` row: a one-page "what changes for you" for dispatch and billing (the
  owner sends it), the decision "after go-live, dispatchers clear by hand only when the badge says Not sent / Refused", a
  `/help` tutorial stub for the badge and the refusal list (the repo's "new page request needs a tutorial stub" CI rule applies
  to the new pages anyway), and a named dispatcher/billing contact for the canary week (3-external §3.3 item 8 names them for
  V1 and the trial only).

### R4-10 [RISK] Retention of lease facts: 90 days in ROUND3, 180 days in the finding it adopts
- Evidence: ROUND3 §2.15 "`mcleod_write_attempts` … kept 90 days"; R3-19 (adopted by §0): "retention of 180 days … the
  retention period must cover the audit horizon: 180 days, the owner's to set". `send_started` is the only answer to "did we
  write McLeod twice?", and a detention or service-failure dispute from a customer arrives weeks to months later.
- Build: one number, put to the owner as an item in the owner message (none of Q-1..Q-8 carries it); `lint:table-lifecycle`
  row and `dataRetentionPolicy.ts` use it.

### R4-11 [OK] The echo (360 write → McLeod → SQL sweep → 360) is handled for every write kind
- Stops: W5 compares the swept `mcleod_dispatch_stops.actual_*` with the payload; W6 counts only events with a
  `client_action_id`, which mirror events do not carry (C §5.8); OPS-6's `already_applied`/`superseded_in_mcleod` handle a
  person's clear arriving first.
- Driver/truck/trailer fields: D-MK5-0d — the write never touches 360's copy; the one row is re-read and posted through the
  normal ingest (`D-office-finance-docs.md:506-512`); unit status: "Sweep brings back" (`:685-693`).
- ETA: "is not the last value we wrote ⇒ a person typed it" (`:1043-1046`). Home time: our periods recognised by
  `external_id` (`:1093-1094`). Images: OF-9 echo skip + OF-8 seen-rule. Removed stops: C-10 replaced (§2.3).
- One open edge, not a blocker: H2's `driver:<id>:next` external id is not one our write created, so after a 360 period ends a
  stale McLeod `next_home_date` can show as "McLeod: home until …". Worth a test title.

### R4-12 [GAP] Cost: the asks are in writing, the branches are not
- Evidence: X16 "Not pre-decided (EXT-8) … owner's commercial risk"; EXT-9 "If not licensed, what does it cost?" with no
  ceiling; McLeod item 1 asks "which version is needed" but not the upgrade's price or downtime; K23 "seat held" has no price
  branch. Apple $99/yr and Google $25 once are trivial; AWS adds two small schedulers on the existing general lane and
  ~2–6k rows/day (C §8 table-lifecycle budgets) on a database memory records as micro and swapping (R3-19 noted it).
- Build (owner table in v2): per McLeod answer — (a) $750/mo covers Direct-Hosted on 22.1 → as planned; (b) per-call or per-seat
  charge → the owner sets a monthly ceiling; parity (the largest call volume, ~15k/day pre-OPS-19) is the first thing cut; (c)
  needs the 26.x upgrade → owner decision with McLeod's upgrade quote and downtime, then R4-1; (d) DocumentPower module priced
  → owner buys or MK4 stays off (EXT-9); (e) a login holds a paid seat → token mode, else one seat bought or parity off.
  Add "upgrade cost and downtime" to McLeod item 1.

### R4-13 [OK] Scheduler placement and hosting are right for AWS
- `mcleod-write-watch`, `mcleodEtaWrite`, `mcleodHomeTimeWrite` are all `general` lane (C §5.8; D :1037, :1098). On AWS the
  general lane is held by the single `worker` container (`compose.yml` `WORKER_ROLE: scheduler`, `SCHEDULER_LANES: general`;
  replicas from `RUN_SCHEDULERS`), which reads the same `api.env` from Parameter Store, so `MCLEOD_API_WRITES` set under
  `/silvicom/production/api/` reaches it. None calls a vendor or needs WEX's IP. OPS-3's "minutes, not seconds" for L1 is
  correct: SSM loads at deploy (`fetch-settings.sh`, `DEPLOYMENT.md` "Loaded at deploy, not live") and the owner must do the
  write (memory: Claude's SSM writes are refused; 3-external O8).
- Stale text only: spec C §5.9 "Flip = Railway/AWS variable"; spec D :1037 "owner `api`" (general is the worker's on AWS).
  Fix the words in v2.

### R4-14 [OK] Storage backup and PII
- The new outbound PDF bucket is backed up without new work: `storage-backup` copies every bucket except `compliance-exports`
  (`WORKER-DEPLOYMENT.md` §Storage backup); RT-17's `storageReconcile` registration covers orphans.
- PII: OPS-14/15 (allowlisted `observed`, redaction on the VM, SSN strip in `write()` with a gate) are adopted. Residual, low:
  `driver_create` payloads (CDL number, birth date — `D-office-finance-docs.md:481,484`) are kept forever in an append-only,
  retention-forbidden table. The same fields already live in `drivers` (also retention-forbidden) and an applicant is never
  purged after hire (0380 PA010/PA012), so no new legal exposure; say so in v2 rather than leave it unexamined.

---

## Summary

Part A: 10 ROUND3 facts + 24 probes; 78 outcome rows. 58 DEFINED (several only partly), 20 UNDEFINED, each with a build above.
Part B: 14 findings — BLOCKER 0 · GAP 7 (R4-1, -2, -3, -4, -5, -9, -12) · RISK 4 (R4-6, -7, -8, -10) · OK 3 (R4-11, -13, -14).

Top 10:
1. R4-1 — A LoadMaster upgrade (the 404 branch's price) has a `/ws` re-check and no SQL one; every 360 McLeod reader is SQL by column name. Add `--schema-check`, writes/parity off the night before, feeds resume per statement on pass.
2. R4-3 — §2.4's "owner sign-off when no test company" is not limited to `stop_clear`, and the adopted DDL has no place to record it (canary requires a `prove` request). Add `signoff_ref`, accept it for `stop_clear` only.
3. R4-6 — Alerts: `mcleod.connection` is an admin-only capability, not a surface, so the recipient set as written throws; W7 goes to dispatch for every kind, so refused medical/CDL/create updates reach nobody who can act; office delivery is bell + one org mailbox. Move W1–W7 into `ALERT_CATALOGUE` with per-kind sections; name the category and its CHECK migration.
4. R4-2 — Lockwood "yes with conditions" has no build; map each condition to an existing lock or keep the operation off.
5. R4-4 — "Pickups have no external effect" carries every fallback; if a pickup clear sends a 214, the scope must be non-EDI customers for both stop types.
6. R4-5 — No branch for a token that cannot be revoked; drop "instant stop", prefer short-lived login tokens, run the revocation probe as a read in MK0.
7. R4-9 — No rollout or communication step for dispatchers and billing; nobody decides who clears stops of record after go-live.
8. R4-7 — `MCLEOD_AGENT_EGRESS_IP` is one SSM value (single tenant, change needs a redeploy); L1 is fleet-wide. Move the pin to the per-org write-token row.
9. R4-8 — The exceptions feed's two `load_events` reads are uncapped-by-design but capped at 1,000 by PostgREST; resolved exceptions can reappear. One RPC; write kinds read from the mcleod module (P-25).
10. R4-12 — Cost branches missing: per-call/seat charges, the 26.x upgrade price and downtime, the DocumentPower module. Owner table with a ceiling per outcome.

Also UNDEFINED in Part A worth carrying: non-Central server zone under `useServerTimezone=true` (F6), Part 6 never granted so MK4 has no independent proof (F5), login token lifetime < 15 min vs the re-login cap (K3), audit user not distinguishable (K13), seat held with no token mode (K23), separate test server has no SQL lane (F2), TestFlight's 90-day build expiry for the iOS pilot (F9).
