# Handoff 2026-09-26 — application flow v2, after C0a/C0b/C0c, C1 and M1

The queue is `APPLICATION-FLOW-V2-PLAN.md`; this note says where it stands and what to do next. Read
the plan's §8 (execution), §11 (open questions, each with a default to build) and the end of §12 (the
dated log) before starting. Then CLAUDE.md, apps/web/CLAUDE.md, supabase/CLAUDE.md,
docs/MIGRATION-DISCIPLINE.md.

## Shipped today (all merged, main `e5f9854`)

| PR | Batch | What |
|---|---|---|
| #1063 | C0a | Every "Open handbook signing" press extends the link 14 days (never shortens); drawer shows `linkExpiresAt` + **Extend the driver's link**; HB021 on countersign → 409 `link_expired`. Live on both Railway services. |
| #1064 | C0b | `handbookSelfAdoption.ts` — **labelled workaround** (removed by C3s): a filed application with 0 packet marks adopts its signature on the handbook screen (picture → `signature_mark` slot, name pinned on the first `handbook_marks.signed_name`). G-13 guards: never replace a pre-filing picture; `permissions.ts` skips a post-filing picture. |
| #1065 | C1 | 13 files split, pure moves (verified: every removed line re-added modulo `export`/imports). |
| #1066 | C0c | A-3, A-4, A-6, A-7, A-8, A-9, A-12, G-5, G-6, G-8, G-9 (Q-AW15 default), G-12. `organizationTimezone` moved to shared `calendarDay.ts`. |
| #1067 | M1 | Migration **0376**, exactly §8.2 + `driver_authorizations.signed_on`. **Verified applied in production** 2026-09-26: 6 new columns, 9 new tables, `record_packet_mark`/`submit_driver_application` each have 2 signatures, 4 new functions, `clearinghouse_portal_consent` in the kind CHECK. Its PR body lists 9 "readings taken" — read them before C2. |

## Next, in order (plan §8.5)

1. **C2** (M1 is applied — it may start now). Contents per §8.5, plus what M1 and C0c left owed:
   - TS for every 0376 object (readers/writers, routes in `applicantScreeningContract.ts` per §8.4).
   - `RETENTION_FORBIDDEN`: `application_intakes`, `application_intake_licences`, `employer_verification_calls`,
     `signature_adoptions`, `sms_suppressions`; `RETENTION_RULES`: `sms_outbox` 400 d, `application_screen_events` 180 d.
   - `clearinghouse_portal_consent` into `TESTING_RECORD_KINDS`, `QUALIFICATION_RECORD_KINDS`, `DOCUMENT_KINDS`.
   - Remove each `check-table-producers` waiver in the merge that ships its writer.
   - G-9's signing-date **writer** (`signed_on`, paper methods only) on the paper form + `POST /authorizations`.
   - A-4 on the board's twin builder — do it as G-7 (one checklist-input builder).
   - M1 readings to honour: AI009 is judged after every intake write (post `prior_positive_2y` first);
     `submit_driver_application` v2 takes `p_call_summaries` (rendered in TS) and refuses DA043 without one;
     endorsements live on `application_intakes.endorsements` only (whether they become certifications is C2's call).
   - **#1059 (packet fines) stays unmerged until the owner rules Q-AW2 and Q-AW17.** It changes text above
     `f2b142e4`'s 20 signed marks; A-5's filing check (packet_version) lands in C2 first.
2. **C3** (screens) after C2's AW2; AW6 (selfie) only after Q-AW5. **C3s** (signing model D-AW14–17) before any
   real step-13 signing — it removes C0b's workaround.
3. **M2** (0377) only after `d61557dc` is filed AND C3s merged: HB022 + handbook order CHECK with `OR submitted_at`,
   drop old overloads once `pg_stat_user_functions`/grep shows no caller.

## Working rules that bit this session

- Own worktree off origin/main per PR; after `pnpm install`, `pnpm --filter @silvicom/shared build:rn`,
  copy `apps/web/.env`. Run every ci.yml gate (`git add` first — scanners ignore untracked files); check `$?`.
- Merge when CI is green on the current head, without asking; verify with `git fetch && git log origin/main -1`
  and `gh pr view N --json state`; one dated line at the end of plan §12.
- A migration and its first reader never share a merge; verify applied by hand (`pg_proc`,
  `information_schema.columns`, `pg_constraint`) before a reader PR.
- Road-test fixtures: since A-8 a bare `{ kind: "road_test" }` reads "not passed" — give it `source: "road_test"`
  (under `detail` for `postgrestFixture`, which evaluates JSON paths).
- `lint:boundaries` refuses cross-module imports in `apps/api/src/modules` — move a pure helper to shared rather than add a waiver.
- Background agents were killed by a 10-minute no-output watchdog twice: tell them to background long commands and poll.
- `inventoryAssets.test.ts` flakes on a closed socket (known, `api-test-flake-is-not-timeouts`); re-run it alone.

## Owner actions still outstanding

- **`d61557dc`'s link lapses 2026-09-28 18:00 UTC.** Open the applicant's Handbook step and press **Extend the driver's
  link** (works even after it lapses). Confirm the driver still has their link.
- **Add a carrier Representative** in the Handbook step (production has 0; the countersign needs one).
- Rule **Q-AW2** (how `f2b142e4`'s already-signed packet is filed) and **Q-AW17** (fines contradictions, wage
  deductions) — both gate #1059. `f2b142e4`'s link lapses 2026-10-01 22:14 UTC.
- Everything else in §11 has a default being built; override any by saying so.
