# Handoff: McLeod API Kit v2, chat 3 of 3 — office, documents, finance, the messages, the PR (2026-11-27)

This handoff replaces the "Chat 3" section of `HANDOFF-2026-11-20-V2-WRITING.md` (`:75-99`); chats 1 and 2 are done.
Paste everything below the line into a fresh chat.

---

You are continuing work on Silvicom 360 (repo `/Users/miroslavjokovic/Projects/FuelGuard`). Read its `CLAUDE.md` first.

Work in the worktree `/Users/miroslavjokovic/Projects/FG-mcleod-api`, branch `claude/mcleod-api-kit-build-plan`. Use
`git -C /Users/miroslavjokovic/Projects/FG-mcleod-api …` for every git command. First run `fetch origin` and
`merge origin/main`; if a conflict appears, stop and report it, do not resolve it by guessing. Do not touch the main
checkout `/Users/miroslavjokovic/Projects/FuelGuard`; another chat uses it.

## What chats 1 and 2 produced (commits on this branch, pushed)

- Chat 1: `docs/plans/mcleod/MCLEOD-API-KIT-PLAN-V2.md` (the index) and `v2/T2-transport.md` (Track T, T-1..T-12, CU-1).
- Chat 2: `v2/T1-driver-and-data.md` — Track N (N-1..N-19), the store track (S-1..S-4), Hire again's roster half
  (N-16). Its "Rulings made in this document" list (11 items) must be copied into `v2/RE-RULINGS.md`'s preamble with
  chat 1's three register defects (below). The index's §2 gained a note: N-18, N-19, and N-8 needing PR #2684 first.

## Chat 3: office, documents and finance, then the messages, PR and merge

**Read, in this order:**
1. The register `DECISION-REGISTER-2026-11-20-API-KIT.md` (it outranks everything).
2. `MCLEOD-API-KIT-PLAN-V2.md`.
3. `v2/T2-transport.md` — the "Interfaces" list, §T-4.1 (operations registry: T3's MK4/MK5 PRs add their operations
   there), §T-4.3–§T-4.5, CU-1.
4. `v2/T1-driver-and-data.md` — §0 (0655 and the action door), N-8 (`load_stop_photos.sha256`, `driver_add_stop_photos`),
   N-16 (Hire again's roster half and the new permission `recruitment.reopen_former_driver`), and the rulings list.
5. `api-kit-specs/D-office-finance-docs.md`, `api-kit-audit/D.md`, `api-kit-council/4-office.md`.
6. `api-kit-round3/3-external.md` (the final ask lists), `docs/plans/mcleod/mail.md`, the 11-13 Alex request at
   `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-11-13-*`.
7. `api-kit-audit/X.md` §5 (the ruling documents to re-rule).

**Produce:**
- `v2/T3-office-docs-finance.md` in T2's per-PR format (exact files; full migration DDL; routes; shared contracts; agent
  changes; tests with quoted titles; gates; staging check; rollback; release dependency): D-1..D-13.
- `v2/RE-RULINGS.md`: the re-ruling replacement text for each ruling document in X.md §5, and a preamble that records
  (a) chat 1's three register defects closed inside T2 (below) and (b) T1's eleven rulings.
- **Two drafted messages, not sent:** `ALEX-MESSAGE-DRAFT.md` (To Alex Tzakov, Cc Alex Lockwood; a follow-up to the 11-13
  request: withdraw its Part 2 re-run and copy refresh, add every register item, the EDI list D-MK33, the
  `reason_for_leaving` codes D-MK40, the test-company SQL and B4's reference-number statements inside the ONE SQL review
  of CU-1, D-MK38, with B4's Step 0 checks from T1 N-10) and `MCLEOD-MESSAGE-DRAFT.md` (via Ron). Each is complete, so no
  "also" email is ever needed.
- **A PR to main**: title for an office reader; body with the four template headings; wait for CI green, then merge.
- **Memory:** update `mcleod-api-kit-bought.md`.

**What T2 and T1 decided that T3 must carry (do not re-decide; cite them):**
- MK4 images: `mcleod_image_sends` unique `(stop_id, kind, sha256)` (D-MK8) reads **`load_stop_photos.sha256`**, which
  T1 N-8 adds and which both `driver_complete_stop` and `driver_add_stop_photos` (0645) write. Spec D's M-D2 is
  therefore already in M-A; D-1 adds no photo column.
- Lumper: **D-DA1** (enterprise plan `docs/plans/drivers-app/DRIVER-APP-ENTERPRISE-PLAN.md:173`) removes every driver
  lumper/detention request screen. Spec D's lumper *document kind* (D-2, M-D3) stays only if billing needs it (X6 in
  that plan); write D-2 as "a document type for billing, no driver screen".
- MK5 reactivate: T1 N-16 built the roster half (reopen → applicant, `hire_applicant` clears `termination_date` and
  `archived_at` at the close, the sweep hires a reopened row only on McLeod's own reactivation while `driver_reactivate`
  is not `live`). T3's D-7 is the `/ws` write and its switch; who presses Hire again is the permission, Q-3 a Settings tick.
- `subject_ref` for driver and unit operations is `<subject id>:md5(payload)` (T2 §T-4.3): MK5's medical-card and CDL
  operations rely on it.
- Operations are added to `packages/shared/src/mcleodWriteOperations.ts` by the PR that builds their adapter; images and
  `driver_create` are `resend: "office_decides"` (never re-sent after an unknown outcome, D-MK10).
- Alerts: category `mcleod_write` (T-4b); recipients by section capability (D-MK31): medical card/CDL → Safety, hire/
  reactivate → Recruiting, units → Fleet.

**Register defects chat 1 closed inside T2 (record in `v2/RE-RULINGS.md`'s preamble):**
1. D-MK8's single index `(operation, subject_ref)` would allow one medical-card update per driver forever; T2 makes
   `subject_ref` for driver and unit operations `<subject id>:md5(payload)` (§T-4.3).
2. D-MK12's "tenant admins can only insert `off`" is enforced by a CHECK: a non-`off` row must name an active
   `platform_admins` row (MK013); the console is `apps/admin-api` `/admin/mcleod-writes`.
3. D-MK33's "no live row for deliveries" is MK016's refusal of `dropoff` in `live_stop_types`, lifted by a later
   `mcleod_edi_customers` migration (T-12 outcome table).

**Facts on main the older documents get wrong (re-read 2026-11-27, merged into this branch at `ecc25c22d`):**
- Migrations end at **`0654_follow_up_urgent_category.sql`**; PR #2684 adds **`0655_sent_load_visible_at_any_mcleod_status.sql`**
  (open on 2026-11-27; check `gh pr view 2684`). No v2 document takes a number (D-MK18).
- **D-LMR5 stands** (owner 2026-11-27): a McLeod load reaches a driver only when the office presses Dispatch → Send.
  Production 2026-11-27: 0 `load_dispatches` rows ever; 99 `in_transit` + 39 `pending_approval` tms loads; **1 of 195
  active drivers has an app login**; `driver_time_off` last synced 2026-11-17 (MK6 home time, D-13, rests on a feed that
  looks dead since then — say so in D-13 and in the Alex message: is the agent's `driver-time` post still running?).
- **Installed app builds (D-MK23's count), 2026-11-27:** 2 iOS push tokens on `1.0.0`, last seen 2026-09-15; none
  Android (T1 §facts).
- **D-DA12** (owner 2026-11-25): driver builds stay local until the app is finished; nothing is published to a store.
  Q-5 (Apple conversion) is still asked, for later.
- Load-rates R4 merged (#2602) and the Board VM was updated to it on 2026-11-20 (`LOAD-RATES-PLAN.md` progress log
  `:396-402`); R5 and Part C remain. CU-1 is therefore the **next** VM visit.
- No EDI field is selectable by our login (`tools/mcleod-agent/review/SILVICOM-GRANTS.sql:79-83`): D-MK33 step 3.
- File sizes: `DispatchLoadsPage.vue` 495 (T1 N-10 extracts the Load # cell), `routes/me.ts` 462 (T1 N-9 moves the load
  routes to `routes/meLoads.ts`), `packages/shared/src/tms.ts` 499, `DispatchLoadDetailPage.vue` 357.

## Rules every chat follows

- **The repo is PUBLIC.** Never write a `/ws` host, another customer's install URL, an IP address, an account or user
  name, a token or a company id into any file (D-MK14). Use placeholders. The two message drafts are files in this
  repo too: write them with placeholders and tell the owner which values to fill in before sending.
- **Main has moved.** Re-read every file:line you cite, including those in this handoff.
- **Migration numbers:** give the order only (D-MK18).
- **Nothing left open:** every step is fully determined or blocked on one named answer in register §5/§6, with a build
  per outcome.
- **Test titles:** real quoted titles; spec D §MK4.8's (3), (4) and the `page_no` mutation are obsolete
  (`api-kit-round4/2-v2-writer.md` §3).
- **Owner answers:** Q-1..Q-10 were unanswered on 2026-11-27. If any is answered when you start, record it in the
  register's §5 first; never invent one.
- **At about 50 % context,** write the next handoff in this shape.
