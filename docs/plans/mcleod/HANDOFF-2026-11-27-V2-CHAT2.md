# Handoff: McLeod API Kit v2, chat 2 of 3 — driver loads and data fixes (2026-11-27)

This handoff replaces the "Chat 2" section of `HANDOFF-2026-11-20-V2-WRITING.md` (chat 1 is done). Paste everything
below the line into a fresh chat.

---

You are continuing work on Silvicom 360 (repo `/Users/miroslavjokovic/Projects/FuelGuard`). Read its `CLAUDE.md` first.

Work in the worktree `/Users/miroslavjokovic/Projects/FG-mcleod-api`, branch `claude/mcleod-api-kit-build-plan`. Use
`git -C /Users/miroslavjokovic/Projects/FG-mcleod-api …` for every git command. First run `fetch origin` and
`merge origin/main`; if a conflict appears, stop and report it, do not resolve it by guessing. Do not touch the main
checkout `/Users/miroslavjokovic/Projects/FuelGuard`; another chat uses it. Do not open or merge a PR (chat 3 does).

## What chat 1 produced (commit on this branch, pushed)

- `docs/plans/mcleod/MCLEOD-API-KIT-PLAN-V2.md` — the index: D-MK1..D-MK40 one line each, the complete PR order
  across the three tracks (§2), outside answers (§3, with four facts recorded 2026-11-27), owner questions (§4),
  the "Superseded" note.
- `docs/plans/mcleod/v2/T2-transport.md` — Track T in the per-PR format: T-1, T-2, T-3, T-4 (+ the specified matrix
  `supabase/tests/mcleod-writes.test.mjs`, §T-4.8, not yet a file), T-4b, T-5, T-6..T-12 and CU-1.
- The older McLeod documents on this branch were scrubbed of hosts, IPs and login names (placeholders such as
  `<customer-hosted /ws docs>`, `<LME SQL LAN IP>`, `<VM LAN IP>`, `<read-only SQL login>`). The agent tree keeps them
  until T-2 (it is a connector commit).

## Chat 2: driver loads and data fixes. This chat writes it.

**Read, in this order:**
1. The register `docs/plans/mcleod/DECISION-REGISTER-2026-11-20-API-KIT.md` (it outranks everything).
2. `MCLEOD-API-KIT-PLAN-V2.md`.
3. `v2/T2-transport.md` — **the interfaces only**: the "Interfaces" list at the top, §T-4.1 (operations), §T-4.2
   (tunables, incl. the labelled SQL copy of the 5-minute bound), §T-4.6 (the enqueue block inside
   `driver_complete_stop` and its outcome values), §T-4.7, and T-5's `driverLoads.ts` / `exceptions.ts` lines.
4. `api-kit-specs/A-driver-loads.md` and `api-kit-specs/B-data-fixes.md`.
5. `api-kit-audit/A.md` and `api-kit-audit/B.md`.
6. `api-kit-council/2-driver.md`.
7. `api-kit-round4/2-v2-writer.md` (the rows for N- and B-steps, and §2a/§2b/§3).
8. `docs/plans/drivers-app/RELEASE-GATE.md`.
9. The driver visual plan on main.
10. `docs/plans/dispatch-loads/LOAD-RATES-PLAN.md`.
11. `docs/plans/drivers-app/DRIVER-APP-ENTERPRISE-PLAN.md` (rev 2) S1 (`:290-310`) and S9 (`:553-575`): it consumes
    this track; D-DA1 (`:173`) puts pay, settlement, detention and lumper requests out of scope.

Read the code each step touches at the point where you write it.

**Produce:** `docs/plans/mcleod/v2/T1-driver-and-data.md`, covering S0a/b/c, M-A, C-A1/C-A2, B1–B7, the store track
(S-1..S-4) and Hire again's roster side (N-16, N-4), in T2's per-PR format: exact files; full migration DDL; routes;
shared contracts; agent changes; tests with quoted titles; gates; staging check; rollback; release dependency. Then
commit (one descriptive sentence, ending with the `Co-Authored-By` line the session gives), push, and write the
handoff for chat 3 at `docs/plans/mcleod/HANDOFF-<date>-V2-CHAT3.md` in this same shape. Chat 3's section is the
original handoff's "Chat 3" (`HANDOFF-2026-11-20-V2-WRITING.md:75-99`) plus whatever you learn.

**What T2 decided that T1 must carry (do not re-decide; cite T2):**
- M-A is the only `driver_complete_stop` signature change (D-MK19); T-4 re-creates M-A's body adding one block
  after the stop row and photos and **before** the `stop_completed` event insert. M-A must therefore keep that
  order and expose the load's `source` in a variable the block reads.
- M-A's `p_mcleod_write` is boolean, the fleet kill only. The 5-minute future bound lives in T-4's block (labelled
  copy of `futureToleranceS`); M-A's own plausibility rules (C-6/R3-7 lower bound, `arrival ≤ departure`) are T1's.
- `late_evidence` (D-MK20) returns before the enqueue block: M-A returns a status (not `void`) for it.
- The stop operation is `stop_clear` only (both dates, enqueued on completion); there is no arrival write.
- `stop_type` on write requests uses `load_stops.kind`'s vocabulary `pickup`/`dropoff`
  (`schema.generated.sql:8186`); the register's "delivery" means `dropoff`.
- `test` mode is prove-only; test-company freight is never projected into `loads` (`dispatchProjection.ts` skips it,
  CU-1). S0b's projection change and CU-1's skip touch the same file — order them in T1's table.
- The B4 agent statements ride CU-1 (D-MK38): one connector update with T-2/T-8's agent code and the test-company
  read, one SQL review, one VM visit.

**Facts on main that the older documents get wrong (re-read 2026-11-27, `origin/main` `6c13bf033`):**
- Migrations end at **`0653_warning_desk.sql`** (not 0640).
- **`0645_driver_late_stop_photos.sql`** added `driver_add_stop_photos` (late photos on a COMPLETED stop, 14-day
  window, DL007) and re-set `load_events_kind_check` with `stop_photo_added`. Every later re-creation of that check
  (S0a's `stop_removed_in_mcleod`, M-A's `acknowledged`) must keep it; spec A's photo/sha work (M-D2) must say how it
  relates to this function.
- Load-rates R4, PR #2602, **merged 2026-11-20** (whether the VM was updated is not recorded here; read
  `LOAD-RATES-PLAN.md`'s progress log).
- File sizes: `DispatchLoadsPage.vue` 495, `routes/me.ts` 462 (over the 450 warning; spec A's split into
  `routes/meLoads.ts` is now forced), `app/loads/[id].tsx` 241, `app/loads/[id]/stop/[stopId].tsx` 357,
  `packages/shared/src/tms.ts` 499, `packages/shared/src/alertRouting.ts` 473.
- Dispatch reaches a driver only when the office presses Dispatch → Send (D-LMR5, re-confirmed by the owner
  2026-11-27). Production 2026-11-27: **0 `load_dispatches` rows ever**; 99 `in_transit` + 39 `pending_approval`
  `source='tms'` loads. Staging has no McLeod feed and no test company. Every "staging check" for a McLeod-fed path
  is a schema or route check; behaviour is proven by the matrices or on production with switches off.
- No EDI field is selectable by our login: the `customer` grant is column-limited
  (`tools/mcleod-agent/review/SILVICOM-GRANTS.sql:79-83`). D-MK33 step 3 applies (Alex lists EDI customers).

**Register defects chat 1 closed inside T2 (tell chat 3; record them in `v2/RE-RULINGS.md`'s preamble):**
1. D-MK8's single index `(operation, subject_ref)` would allow one medical-card update per driver forever; T2 makes
   `subject_ref` for driver and unit operations `<subject id>:md5(payload)` (§T-4.3). Chat 3's MK5 operations rely
   on it.
2. D-MK12's "tenant admins can only insert `off`" is enforced by a CHECK: a non-`off` row must name an active
   `platform_admins` row (MK013); the console is `apps/admin-api` `/admin/mcleod-writes`.
3. D-MK33's "no live row for deliveries" is MK016's refusal of `dropoff` in `live_stop_types`, lifted by a later
   `mcleod_edi_customers` migration (T-12 outcome table).

## Rules every chat follows

- **The repo is PUBLIC.** Never write a `/ws` host, another customer's install URL, an IP address, an account or user
  name, a token or a company id into any file (D-MK14). Use placeholders.
- **Main has moved.** Re-read every file:line you cite, including those in this handoff.
- **Migration numbers:** give the order only; the number is the next free one at merge (D-MK18).
- **Nothing left open:** every step is fully determined or blocked on one named answer in register §5/§6, with a
  build per outcome. No assumptions.
- **Test titles:** write real quoted titles; `api-kit-round4/2-v2-writer.md` §3 lists the PRs that had none and the
  obsolete titles (DR-9's per-load-FIFO pair, R3-5's 500-cap title, R3-3's three, R3-11(d), spec A's S0c flip).
- **Owner answers:** Q-1..Q-10 were unanswered on 2026-11-27. If the owner has answered any by the time you start,
  record it in the register's §5 first; never invent one.
- **At about 50 % context,** write the next handoff in this shape.
