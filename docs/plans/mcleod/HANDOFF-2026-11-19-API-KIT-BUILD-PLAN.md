# Handoff — McLeod API Kit: write the straight-through BUILD plan (2026-11-19)

Paste everything below the line into a fresh chat.

---

You are continuing work on Silvicom 360 (repo `/Users/miroslavjokovic/Projects/FuelGuard`; read its
CLAUDE.md first). Work in the worktree **`/Users/miroslavjokovic/Projects/FG-mcleod-api`**, branch
**`claude/mcleod-api-kit-build-plan`** (pushed; = main + commit `6a70d36a2`). Do not work in the main
checkout — it is on another chat's branch.

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
