# Handoff: write the McLeod API Kit v2 plan (2026-11-20)

This handoff replaces `HANDOFF-2026-11-19-API-KIT-BUILD-PLAN.md`. Paste everything below the line into a fresh chat.

---

You are continuing work on Silvicom 360 (repo `/Users/miroslavjokovic/Projects/FuelGuard`). Read its `CLAUDE.md` first.

Work in the worktree `/Users/miroslavjokovic/Projects/FG-mcleod-api`, branch `claude/mcleod-api-kit-build-plan`. Before you start, run `git fetch origin && git merge origin/main`: main moves daily.

Do not work in the main checkout; another chat is using it.

## Why the work is split into three chats

The owners bought McLeod's API Kit, and v1 of the plan was merged as PR #2572. Since then:
- four build specs were written;
- four review rounds were run;
- every contradiction was settled in **`docs/plans/mcleod/DECISION-REGISTER-2026-11-20-API-KIT.md`**.

The register outranks every other document. All the material together is about 1 MB, which is too much for one chat. So v2 is written in **three chats, one per track**, each reading only its own files.

The owner's standard is: precise, reliable, no workarounds, no simplification because something is hard, and nothing left open. In practice "nothing left open" means every step is either fully determined, or blocked on one named answer from the register's §5 or §6, with the build for each outcome written out.

## Chat 1: transport and write pipeline. This chat writes it.

**Read, in this order:**
1. The register.
2. `api-kit-specs/C-transport.md`.
3. `api-kit-council/1-pipeline.md` (its "Final pipeline spec" section).
4. `api-kit-council/3-ops.md` (the MK0 probe table and the two message lists).
5. `api-kit-round3/2-sequence.md` §1. Use its order; apply the register to every cell.
6. `api-kit-round4/1-verify-round3.md`, `api-kit-round4/2-v2-writer.md` and `api-kit-round4/3-outcomes.md`.
7. `MCLEOD-API-SURFACE-2026-11-19.md` and `api-kit-audit/WS.md`.

Read the code each step touches at the point where you write it.

**Produce:**
- **`docs/plans/mcleod/MCLEOD-API-KIT-PLAN-V2.md`**, the index. It contains:
  - the decision table, D-MK1..D-MK40 from the register, each with one line;
  - the complete PR order across all three tracks;
  - the outside-answers table;
  - the owner questions;
  - a "Superseded" note pointing at v1.
- **`docs/plans/mcleod/v2/T2-transport.md`**. Each PR in this track gets:
  - its exact files;
  - full migration DDL for the pipeline (D-MK6..D-MK14);
  - routes;
  - shared contracts;
  - agent changes;
  - tests with **quoted titles**;
  - gates;
  - the staging check;
  - rollback;
  - its release dependency.
- **The PGlite checks** under `api-kit-council/pg/` and `api-kit-round4/pg/` become the specified matrix `supabase/tests/mcleod-writes.test.mjs`. It runs against the **adopted** DDL.

Then commit and push, and write the handoff for chat 2.

## Chat 2: driver loads and data fixes

**Read:**
1. The register.
2. `MCLEOD-API-KIT-PLAN-V2.md`.
3. `v2/T2-transport.md` (the interfaces only).
4. `api-kit-specs/A-driver-loads.md` and `api-kit-specs/B-data-fixes.md`.
5. `api-kit-audit/A.md` and `api-kit-audit/B.md`.
6. `api-kit-council/2-driver.md`.
7. `api-kit-round4/2-v2-writer.md` (the rows for N- and B-steps).
8. `docs/plans/drivers-app/RELEASE-GATE.md`.
9. The driver visual plan on main.
10. `docs/plans/dispatch-loads/LOAD-RATES-PLAN.md`.

**Produce:** `v2/T1-driver-and-data.md`, covering S0a/b/c, M-A, C-A1/C-A2, B1–B7, the store track and Hire-again's roster side, in the same per-PR format as chat 1. Then write the handoff for chat 3.

## Chat 3: office, documents and finance, then the messages, PR and merge

**Read:**
1. The register.
2. `MCLEOD-API-KIT-PLAN-V2.md`.
3. `api-kit-specs/D-office-finance-docs.md`.
4. `api-kit-audit/D.md`.
5. `api-kit-council/4-office.md`.
6. `api-kit-round3/3-external.md` (the final ask lists).
7. `docs/plans/mcleod/mail.md`.
8. The 11-13 Alex request at `tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-11-13-*`.
9. `api-kit-audit/X.md` §5 (the ruling documents to re-rule).

**Produce:**
- `v2/T3-office-docs-finance.md`.
- The re-ruling replacement text for each ruling document in X.md §5, in `v2/RE-RULINGS.md`.
- **Two drafted messages. Do not send them.**
  - `ALEX-MESSAGE-DRAFT.md`, addressed To Alex Tzakov, Cc Alex Lockwood. It is a follow-up to the 11-13 request: withdraw its Part 2 re-run and copy refresh, and add every register item.
  - `MCLEOD-MESSAGE-DRAFT.md`, via Ron.
  - Each message is complete, so no "also" email is ever needed.
- **A PR to main:**
  - The title is written for an office reader.
  - The body uses the four template headings.
  - Wait for CI to pass, then merge.
- **Memory:** update `mcleod-api-kit-bought.md`.

## Rules every chat follows

- **Main has moved.** Re-read every file:line you cite, including those in this handoff. Facts known to be stale:
  - migrations 0637–0640 are taken;
  - driver visual V5–V7 are merged;
  - load-rates R4 is PR #2602;
  - `DispatchLoadsPage.vue` is 498 lines.
- **Migration numbers:** give the order only; the number is the next free one at merge.
- **The repo is PUBLIC.** Never commit `/ws` hosts, McLeod user names, tokens or McLeod docs. See register D-MK14.
- **Test titles:** about 15 PRs have only a test file named, and about 20 older titles are obsolete. The list is in `api-kit-round4/2-v2-writer.md` §3. Write real titles.
- **At about 50% context,** write the next handoff in the same shape as this one.
- **Owner answers:** if the owner has answered any of Q-1..Q-10 by the time you start, record the answer in the register's §5 first.
