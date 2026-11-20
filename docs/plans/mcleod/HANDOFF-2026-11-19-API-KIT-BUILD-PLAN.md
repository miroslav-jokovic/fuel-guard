# Handoff — McLeod API Kit: write the straight-through BUILD plan (2026-11-19)

Paste everything below the line into a fresh chat.

---

You are continuing work on Silvicom 360 (repo `/Users/miroslavjokovic/Projects/FuelGuard`; read its
CLAUDE.md first). Work in the worktree **`/Users/miroslavjokovic/Projects/FG-mcleod-api`**, branch
**`claude/mcleod-api-kit-build-plan`** (pushed; = main + commit `6a70d36a2`). Do not work in the main
checkout — it is on another chat's branch.

## READ FIRST (0) — round 3 of 2026-11-20 OUTRANKS everything below
`docs/plans/mcleod/ROUND3-2026-11-20-API-KIT.md` (evidence `api-kit-round3/`) sets the precedence rule
("every finding in every report is adopted unless ROUND3 §5 rejects it; later round wins"), replaces
COUNCIL items in §2, lists the 10 facts only others can supply (§1), the consolidated asks (§3, full
lists in `api-kit-round3/3-external.md`), and owner decisions Q-5..Q-8 (§4) on top of COUNCIL Q-1..Q-4.
The PR order to start v2 from is `api-kit-round3/2-sequence.md` §1 with ROUND3 §2 applied.
Read order: ROUND3 → COUNCIL → AUDIT → specs.

## READ FIRST (1) — the review council of 2026-11-20 OUTRANKS the audit below
A second round (five reviewers: pipeline, driver, ops/security, office, red team on round 1) is in
`docs/plans/mcleod/COUNCIL-2026-11-20-API-KIT.md` with evidence in `api-kit-council/`. It corrects the
round-1 summary (§2), adds 23 conditions v2 must build (C-1..C-23, §3), and returns four owner
questions (Q-1..Q-4, §4). Read order: COUNCIL → AUDIT → specs. Write v2 only after the owner answers
Q-1..Q-4, or write it with those four steps shown as blocked on the named answer (switch `off`).
Never commit `/ws` hosts, company ids, McLeod user names, tokens or McLeod docs (repo is PUBLIC; C-8).

## READ FIRST — the audit of 2026-11-20 supersedes parts of this handoff
The owner asked for an audit of the specs before v2 is written. Six independent audits found the specs
cite code accurately but cannot be built as written (two incompatible write pipelines, Postgres
function-change errors, tests that would turn red, McLeod facts assumed). **Read
`docs/plans/mcleod/AUDIT-2026-11-20-API-KIT-SPECS.md` before anything else**: §1 corrects the `/ws`
facts (W1–W12), §2 lists the resolutions v2 must adopt (including the reconciled three-table pipeline
from `api-kit-audit/C.md`), §4 lists the eight owner rulings O-1..O-8, and **§5 records them RULED on 2026-11-20 ("go ahead")**.
Only O-7 still needs the owner's own sentence; until then the hire → McLeod create stays switched off. Full evidence (file:line, URLs):
`docs/plans/mcleod/api-kit-audit/{A,B,C,D,WS,X}.md`. Where this handoff and the audit disagree, the
audit wins (e.g. "Settlement/Billing read-only" is wrong; `equipStatus/create` is Drivers-role only;
the stop write is enqueued in SQL inside `driver_complete_stop`). The branch now also merges main.

**Next chat's job:** write the v2 execution-grade plan (`MCLEOD-API-KIT-PLAN-V2.md`, superseding v1)
from the audit + specs, with every audit resolution applied and the §5 rulings as D-MK decisions; then
the re-ruling texts, the two drafted messages, the PR, memory, and a handoff at ~50% context.

## The owner's request (2026-11-19, verbatim intent)
The owners bought McLeod's full API Kit (~$750/month) so Silvicom 360 can be a custom front end for
McLeod: read through the API and WRITE. The owner asked for **one plan that they will verify, with only
proper build steps and the best solutions, nothing left open, straight-through build, fast, precise,
reliable.** Explicit warning from the owner: *"you have tendencies to shorten and oversimplify things
and take workarounds"* — do not plan around something because it is hard or long. Take the time.
Also: **at ~50% context usage, write a handoff** like this one for the next fresh chat.

## What already exists
1. `docs/plans/mcleod/MCLEOD-API-KIT-PLAN.md` (merged, PR #2572) — first version: what the kit
   unblocks, rulings to re-rule (§1), the driver-app research checked against code (§2), Q-MK1..15 with
   recommendations (§3), N1–N9 no-API steps (§4), MK0–MK6 (§5), D-MK1..5 (§7). **The owner then said
   "go ahead"** — treat every Q-MK recommendation as approved 2026-11-19, but the new plan must show
   them as decisions (D-MK*) the owner will verify, not as questions.
2. `docs/plans/mcleod/MCLEOD-API-SURFACE-2026-11-19.md` (committed on this branch) — the real `/ws`
   operations read from McLeod's public docs (`tms-map.mcleodhosted.com/ws/docs/`, another customer's
   install, version unknown). **This changes parts of the first plan:**
   - Truckload stop write = `POST /dispatch/clearStop/{stopId}?arrivalDate&departureDate&hub` (Users
     role). `/dispatch/{stopId}/arrive|depart` are **LTL-only** — do not use.
   - Document upload exists: `POST /images/{rowType}/{rowId}/{documentTypeId}`; categories from
     `GET /images/{rowType}/{rowId}/documentTypes`.
   - `PUT /drivers/create`; driver UPDATE only via `TableRowService PUT /driver/update`;
     `PUT /tractors/update`, `PUT /trailers/update` (status fields on the row).
   - `POST /dispatch/assign/{movementId}` (driver1/2, tractor, trailer1..3) exists — load assignment
     from 360 is technically possible; D-MK4 (loads still assigned in McLeod) stays the decision for
     this plan, revisit only after MK3.
   - **No GL / ledger / AP voucher / fuel service exists.** Settlement/Deduction/Billing are read-only.
     ⇒ the first plan's "MK2 finance through the API" is WRONG: finance stays on SQL, and the frozen
     `lme_analytics` restore ends by **live-lme SELECT grants** (Alex), not the API. Fix this in the plan.
   - No ETA write found yet (RowStop type page unread). No webhooks — polling only.
     `changedAfterDate` bounded by audit "days to keep"; 1,000-row cap (`-Dloadmaster.api.maxresultsize`).
   - SymphonyMobileComm `driverAvailable` = HOS hours, not home time. Home time = RowDriver
     `next_home_date` / `pta_date` via TableRowService, or `PUT /equipStatus/create`.
   - Our own docs will be at `https://<our-mcleod-host>/ws/docs/` once `/ws` is enabled — MK0 must
     snapshot it and diff against the surface doc; every difference has a pre-decided consequence.
3. **Four build specs** were being written by background agents of the previous chat into:
   `/private/tmp/claude-501/-Users-miroslavjokovic-Projects-FuelGuard/77d282ee-6821-4d7e-bafa-eb3616447ed2/scratchpad/specs/`
   - `A-driver-loads.md` — N1, N2, N3, N7, MK3 (driver side + write-request table contract)
   - `B-data-fixes.md` — N4 (+ Q-LMR5 PU number, Q-LMR10 BOL number), N5, N6, N8, N9
   - `C-transport.md` — MK0 discovery, agent `/ws` client, MK1 read parity, write pipeline, kill switch
   - `D-office-finance-docs.md` — MK4 documents, MK5 office writes, MK2 finance (grants), MK6 ETA/home time
   If a file is missing or truncated, re-create that spec yourself from the plan + code (read-only
   research first). **Copy all four into `docs/plans/mcleod/api-kit-specs/` in the worktree** before
   relying on them (the scratchpad can be cleared). They are inputs, not the plan; verify each claim
   that the plan depends on at its file:line.

## Facts verified against code on main (2026-11-19) — do not re-derive
- Accept/Decline can never work on McLeod loads: nothing sets `source='tms'` loads to `offered`
  (`packages/shared/src/mcleodLoadProjection.ts:136-149`; `0141:122`). D-LMR5 already ruled no offer step.
- Dispatched-but-not-started McLeod loads are `approved` and invisible to the driver
  (`0371_load_driver_scope_reads_dispatch.sql:65-100`; `loadsLifecycle.ts:23-29`). `co_driver_id`
  exists (`0493`) but no policy reads it.
- The sweep (`apps/api/src/modules/loads/mirrorLoads.ts:54-77, 202`) rewrites `loads.status`,
  `driver_id`, `vehicle_id`, `trailer_id`; 0368 guard lets tms loads move to any status. Stop
  `status/arrived_at/completed_at` survive; worked stops are never deleted (`:105-110`).
- **`load_stops` stores NO McLeod stop id** and `loads` no McLeod order id (`loads.ref` = order id,
  `external_id` = `company:movement`). Raw `mcleod_dispatch_stops.stop_id` exists (0364:113-117). MK3
  needs a stop id column + projection writer (separate merges, deploy window).
- Trucks/trailers on loads resolve by unit number, not McLeod id (`mcleod/entityLookup.ts:63-73`);
  unmatched driver → silent null (`dispatchProjection.ts:69-75`).
- Rig pick list = whole org (`driver-app/dutySessions.ts:94-104`). Required photos hard-coded twice
  (`mirrorLoads.ts:120`, `tmsLoadIngestWriters.ts:157`). Contract lacks PU/refs/customer/weight/pieces/
  McLeod actuals (`loadsContract.ts:69-108`) though 0366 has them; `loads.pickup_number` never written.
- Outbox has client UUIDs but load actions send no action id; replayed **decline** writes a second event.
- Driver app never ran on a real phone, not in either store; Apple account Individual
  (`docs/plans/drivers-app/RELEASE-GATE.md:128-139,184-189`). Driver workflows need GitHub's "Approve and
  run", not an environment.
- Network: the on-prem agent VM (Alex's, 10.0.1.172) is outbound-only (`mail.md:40`). D-MK1/Q-MK1:
  the agent PULLS write requests from our API and calls `/ws` on the LAN.
- Office truck/trailer status edits and Retire go **straight from the browser to Supabase**
  (`apps/web/src/composables/useVehicles.ts:81,94`, `useTrailers.ts:82`) with **no audit row**. A McLeod
  status write (Q-MK12) must move these to an API route that audits and enqueues the write.
- Hire today: `POST /api/recruitment/hire` → `hireApplicant.ts:190-252` → RPC `hire_applicant` (0386);
  the sweep's `rosterApplicantHire.ts:53-107` links McLeod's hire (D-RL5). Matching order
  link → CDL → name in `mcleod/rosterMatch.ts:70-118`. Office driver edits: `PATCH /api/roster/drivers/:id`
  (`roster/routes/drivers.ts:164-258`), claim via `resolveDriverUpdate` (`rosterContract.ts:403-411`) and
  trigger 0241. Held list is read-only text (`RosterHeldList.vue`, "Nothing here is a button").
- D-IP5 (manual fuel from McLeod) was superseded 2026-10-07 by D-IP7 (uploads win).
- Free ID prefixes: D-MK / Q-MK / B-MK are this plan's. Avoid reused IDs D-DB4, D-TL1, Q-TL3, LR4.

## Findings from the specs that the plan MUST carry (2026-11-19)
- **Stop ids are not stable**: both stop writers delete and re-insert pending stops on every sync
  (`mirrorLoads.ts:102-128`, `tmsLoadIngestWriters.ts:123-164`). Once N2 lets drivers see approved loads,
  a queued stop action would 404. Spec A step **S0** keys stops by `mcleod_stop_id` first (3 merges) — S0
  precedes N2 and MK3.
- **Co-driver visibility**: `auth_dispatched_load_ids()` returns only loads whose current dispatch names
  the caller (`0371:37-56`). Spec A lets both seats see the load when the current dispatch names either
  seat — put this in the plan as a decision the owner verifies.
- **D-MK1 corrected**: a mutable state column on an append-only table is impossible. Requests and
  outcomes are two append-only tables (spec A). Spec C (transport) proposes six mcleod-owned tables
  (requests, attempts log, agent health, …). **Reconcile A and C into one schema** before writing the plan.
- **Visibility rule becomes one SQL function** read by RLS, `assert_driver_load` and the API;
  `DRIVER_VISIBLE_STATUSES` is deleted (only reader `driverLoads.ts`). Closes a live hole: a driver can
  act today on a McLeod load never dispatched to them.
- **Tap → McLeod**: the client action id becomes the `load_events` row id. Only stop **Complete** sends
  one `clearStop` (with the driver's real arrival tap and departure); Arrive and Skip send nothing.
- Spec C: stop writes cannot start before N7 merges. The owner signs off only twice: the first switch to
  live, and the canary order if McLeod gives no test company.
- Spec B: the agent never reads McLeod `reference_number` (grant exists since 09-28) — PU number needs
  3 new agent statements + Alex's review before the VM runs them; the agent resends a load only on change,
  so the wire field ships optional first (B4), required after (B5). **PU may mean "Previous Bill of Lading
  Number" in the EDI code list** — check V1 on production + a dispatcher on 3 loads picks one of three
  written outcomes before B5. Unmatched codes become a self-clearing derived exception
  (`loads.external_unmatched`). Columns named `reference_numbers` (`references` is reserved).
  `DispatchLoadsPage.vue` is at 496/500 lines — extract a cell first.
- Spec D: documents attach to the ORDER (`loads.ref`), one PDF per stop and kind, uploaded when the driver
  completes the stop; categories stored from `/ws` and picked once per kind by a person; dedupe by sha256
  (adds `load_stop_photos.sha256`); "confirmed" = image seen on the order afterwards (McLeod may stage).
  Revised-RC reading stays route (b); the API replaces it only after 14 days of exact agreement. BOL Q6 =
  yes, Q9 closed. Office-write routes live in the `mcleod` module (avoids cycles). **SSN never sent**; if
  McLeod requires it, driver create stays off and hiring stays as today. Termination written in 360 first,
  then McLeod; a returning driver comes back through Hiring. Claim trigger defect: a phone edit claims a
  McLeod row today — fix. Finance stays SQL: IT runs SILVICOM-GRANTS Parts 3/4/5 on `lme` + `drs_check`,
  `gl_summary`; closed-month comparison; build F12b/C1 now. ETA write waits on DB7 (never recorded as run);
  home time H1/H2/H3 from a 14-day read probe. Appendix C = the 12 MK0 checks. Spec D assumed the table
  name `mcleod_write_requests` — the reconciled schema's name wins.
- All four specs are in `docs/plans/mcleod/api-kit-specs/` (A driver loads, B data fixes, C transport,
  D office/finance/docs). They overlap and sometimes disagree: the plan reconciles them, it does not paste them.

## External blockers — the plan must close each with a defined action and per-outcome build
- B-MK2 `/ws` on LoadMaster 22.1 vs 26.x; B-MK3 URL/TLS/AnywhereCompanyID; B-MK4 integration user +
  least role; B-MK5 a write-capable **test company**; B-MK8 Symphony licence; B-MK9 **Alex's written OK**
  for API writes (his 09-24 terms: SELECTs only, nothing inbound); B-MK10 11-11 meeting notes and the
  email to Ron — not on file; ask the owner for them once.
- The owner said "go ahead" — draft (do not send) **one** message to McLeod via Ron and **one** to Alex,
  each complete (memory: IT requests are one complete list; never "also").

## What to produce
1. Rewrite `MCLEOD-API-KIT-PLAN.md` (or a v2 beside it, superseding v1 explicitly) as an
   **execution-grade build plan**: every step with exact files, migrations (number = next free at build
   time; column and first reader in separate merges), API/web/driver changes, tests by title, gates,
   staging verification, rollout and rollback, and the PR boundaries. Every decision closed (D-MK*),
   every external unknown turned into an MK0 check with the build for each outcome. No "TBD", no
   "consider". Workarounds forbidden (CLAUDE.md "No workarounds").
2. Re-rulings of §1 written as proposed replacement text for each ruling doc (owner verifies).
3. The two drafted messages (McLeod/Ron, Alex) as files under `docs/plans/mcleod/`.
4. PR to main (title for an office reader; body with the four template headings), CI green, then merge
   (memory: PR flow — merge yourself when green; if the classifier refuses a merge, report it).
5. Update memory `mcleod-api-kit-bought.md` with the new plan state; append the plan's progress log.
6. At ~50% context, write the next handoff.
