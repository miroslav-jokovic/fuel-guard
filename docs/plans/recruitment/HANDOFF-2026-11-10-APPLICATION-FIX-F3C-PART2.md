# Handoff 2026-11-10: driver application fix, next is F3c part 2

Paste this into a fresh chat. Repo: `/Users/miroslavjokovic/Projects/FuelGuard` (Silvicom 360).

Read these first:
- `CLAUDE.md`;
- `docs/plans/recruitment/APPLICATION-FIX-PLAN.md` (§3 F3, §5 questions including Q-AM14, and the §7 log at the END);
- `docs/plans/recruitment/APPLICATION-SCREEN-MAP.md` §10 (D-AM7).

## Goal (owner)

The driver's form, the office dashboard and the signed packet must match 100% (D-AM7).

Every answer the driver gave must be editable by the office before signing, and nothing after (Q-AM2 → b). Owner, Q-AM13: "we should be able to edit each answer because drivers make mistakes and we need control on any mistakes".

## Done today, all merged to main

| PR | What |
|---|---|
| #2195 | Migration **0586**: `application_edits.note` (the office's reason) and `withheld` (the row records THAT an answer changed, with no values; a CHECK enforces it). |
| #2199 | **The Applicant facts card** (`apps/web/src/features/apply/ApplicantFactsCard.vue`) on the review drawer. |
| #2204 | **The Q-AM13 doors.** |

**What #2199 built:**
- **The card** is built from the catalogue (`packages/shared/src/applicantFacts.ts`).
  - Rows come from `applicantFactRows.ts`. Each row is saved through its door by `factCorrection.ts`, using the control for its input kind (`FactEditor.vue`).
- **It retired** `ApplicationAnswerList`, `editableFields` and `PartOneCorrection`.
- **Server:**
  - `apps/api/src/modules/recruiting/applicationEditLog.ts` is the ONE writer of `application_edits`. It holds `recordOfficeEdits` and the `signingStarted` stop.
  - Part 1 and identity corrections now write edit rows (`partOneEdits` / `identityEdits` in `packages/shared/src/applicantFactEdits.ts`, held to `composeFiledApplication` by test).
  - Every correction stops at the driver's first packet mark.
  - The review response carries `signingStarted`.

**What #2204 built:**
- **A new door, `part_one_answer`.** The contract is `partOneAnswerSchema` (`applicantPartOneAnswerContract.ts`), the route is `POST …/applications/:id/part-one/answer`, and the service is `applicantPartOneAnswer.ts`. It writes one key through `record_applicant_intake` (overwrite).
- **Catalogue rules:**
  - `statement`: the four drug-test answers. A note is required on the card, on the route, and on the draft path (`note_required`). The driver sees it on 3.1.
  - `replace_only`: the donor gender. The review sends only `donorGenderGiven`, the editor opens blind, and the edit row is withheld.
- **Endorsements and medical card pending** are now editable.
- **The gap snapshot** in `applicantFacts.test.ts` went from 13 to **5**: education, references, eeo, carrier_answers, ssn.

## Next: F3c part 2 (plan §3 F3; §7's last entry lists it)

Split it into PRs. A suggested order:

1. **Jobs and gaps into the card.** Today they live in `OfficeJobsSection.vue` under the card.
   - `applicantFactRows.ts` skips them on purpose (the `ELSEWHERE` set).
   - Employers are edited by `key` (`applicationReviewEdits.ts`: `add_employer` / `remove_employer` / `explain_gap`).
   - Decide: move them into the card, or keep the employer form and link it from the card. Do not keep two editors of one answer.
2. **Add and remove rows (E2)** for addresses, accidents, convictions (`violations`), equipment, other names and licences.
   - The edit contract (`applicationEditSchema`) has only the employer row ops today, so this needs generic row ops. Each must be re-parsed by `applicationDraftPayloadSchema`, as `editApplication` does.
   - On a v2 link, the current address street and the licences belong to Part 1. Add and remove there goes through the whole-set correction (`partOneCorrectionSchema` licences list).
   - The edit-row shape for a whole row is `{ path: [list, i], before: row|null, after: row|null }`. 3.1 already renders an object as one line (`rowText` in `fieldLabels.ts`).
3. **Email or phone moves the invitation's contact (E3).**
   - Today the phone correction changes Part 1 and `drivers`, but not the invitation's email or SMS target.
   - Make it an audited act and say so on the card.
   - Check `application_invitations.email` and `sms_consents` before writing.
4. **The education and references tables** (`questionnaire.education`, `questionnaire.references`). One cell is 4 path segments deep, and `applicationPathSchema` allows a maximum of 3. Either edit a whole row as one value, or widen the schema (no migration: `application_edits.path` is jsonb).
5. **The carrier's own answers** (`carrier_answers`). They are labelled only by the invitation's stamp (`carrierQuestions` in the review response), and the draft does not carry the stamp (Q-CQ7). The card has the stamp from the review response, so it can label them.
6. **The Permissions and Road-test drawers** still carry their own identity correction (`apps/web/src/features/recruitment/ApplicantIdentityCorrection*`, used by `RoadTestPanel.vue` and `HiringStepBody.vue`). Point them at the card (open the review drawer) instead of keeping a second editor.

Each fact a PR opens is a visible change to the inline snapshot in `applicantFacts.test.ts`.

## Owner questions open (do not build around them; they are in the plan)

- **EEO:** no screen ever asks it, so there is no answer to correct. Should a screen ask it?
- **SSN:** the driver types it only at sign-off, sealed into `driver_applications` (D-APP3). Should the office type one before signing? This goes with Q-AM3 (last 4 on the packet).
- **Q-AM14:** a correction and its edit row are two writes. The recommendation is to make them one inside the DB functions during F4, not urgently.
- Q-AM1, Q-AM3–Q-AM11 as listed in plan §5 and SCREEN-MAP §8. F2 (the packet prints everything asked) needs Q-AM3/Q-AM4 and can run in a parallel chat.

## Traps found today

- **Draft blanks must be `""`, never `null`.** `fromDraftPayload` calls `.trim()` on an address's `line2`/`to`, and a null takes the drawer and the driver's own page to the error boundary. `factCorrection.ts`'s `draftStored` handles it; keep it. Browser-pass fixtures need full-shaped rows (strings for `to`, miles, counts) for the same reason.
- **Never spread a DB row into a response.** `partOneForFiling` now names its fields, because the intake row holds the donor gender.
- **`useApplication.ts` is at about 498 of its 500-line budget.** Put new web calls in their own module.
- **A review response may lack `edits`.** `applicantFactRows` tolerates it. CI once failed on an unhandled rejection while every test passed: read the "Unhandled Errors" block.
- **The browser pass recipe works.** Run `VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port 43xx` in `apps/web` (it serves on `localhost`, not 127.0.0.1). Then use Playwright with one route on `/(api|rest/v1|auth/v1|storage/v1)/`, mock `/rest/v1/drivers` with an object, and open the drawer by setting `ApplicationReviewDrawer`'s props through `#app.__vue_app__`. The script from today is at `/private/tmp/claude-501/-Users-miroslavjokovic-Projects-FuelGuard/f6f358b6-aea5-43b9-81ee-1e718f33d67f/scratchpad/shots/card.mjs` (copy it into `apps/web` to run it, so it resolves `@playwright/test`). It found three bugs the unit tests missed. Do it again before each card PR.

## Working notes

- **Worktree:**
  - `git worktree add -b claude/<topic> ../FG-<x> origin/main`;
  - `pnpm install --frozen-lockfile`;
  - `pnpm --filter @silvicom/shared build:rn`;
  - copy `apps/web/.env` and `apps/api/.env`.
  - Remove the old worktree: `git worktree remove --force ../FG-f3c`.
- **Next free migration: 0587.** Re-check `origin/main` before pushing; parallel chats race for numbers.
- **Gates:** `pnpm ci:local --job gates,typecheck` (about 2 min). Then run vitest on `apps/web` `src/features/apply`, `apps/api` `src/modules/recruiting` and `packages/shared` with `CI=true`.
- **Mutation-check each new test:** back the file up, mutate, run, restore, `cmp`.
- **Git merges are slow.** The post-merge hook rebuilds the graph, so run `git merge` in the background and wait for it before the next git command.
- **PR flow:**
  - PR body with the four template headings in `--body-file`.
  - Merge yourself when green: `gh pr merge N --merge --delete-branch`.
  - Append plan progress at the END of §7.
