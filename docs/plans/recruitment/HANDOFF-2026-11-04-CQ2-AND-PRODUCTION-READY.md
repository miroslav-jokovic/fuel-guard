# Handoff — 2026-11-04 (evening): finish CQ2, then make §15 production-ready

Paste this into a fresh chat. Plan of record: `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md` **§15**
(read §15.3 first, then §15.2) and its **§7 progress log** (append at the END). The previous handoff,
`HANDOFF-2026-11-04-POLICY-AND-CARRIER-QUESTIONS.md`, is superseded by this one.

## Where things stand

| Item | State |
|---|---|
| IDP1 (#2009, migration 0564) and IDP2 (#2016) — who sees SSN-card and passport pictures | MERGED, on staging, **not in production** |
| DAP1 (#2018, migration 0565) — the policy text, `policy_version`, the 14-argument `record_packet_mark` | MERGED `d122c0e`, main CI and `migrate-staging` green |
| DAP2 (#2024) — the policy on the link (`/:token/drug-alcohol-policy.pdf`), Sign blocked on p28 until opened, the p28 version stamp, the signed policy filed as `drug_alcohol_policy` | MERGED `cb0af17` |
| Q-DAP3 — owner: "representative is Varmeda" (#2032) | MERGED `3c87eda` |
| CQ1 (#2029, migration **0567**, not 0566 — the ads chat took 0566) — `recruiting_carrier_questions`, the invitation stamp, `send_application_invitation` with 6 arguments | MERGED `790c8ae`, main CI and `migrate-staging` green |
| **CQ2 — the reader** | **IN PROGRESS**: branch `claude/cq2-carrier-questions-reader`, worktree `../FuelGuard-cq2`, one WIP commit `ba70192` (pushed, no PR) |

Production is at the 2026-11-02 release (`5b385f3`). None of §15 is in production. No release PR is open.

## Next step: finish CQ2 (one PR; split out the packet sheet if it grows)

### First, in the worktree

1. `cd ../FuelGuard-cq2 && git fetch origin && git rebase origin/main`. The branch's base `4daea53` is CQ1's
   commit, which is already merged, so the rebase should drop it as already applied. If it conflicts, resolve,
   run `rebase --continue`, and re-run the gates. **Never push while a rebase is stopped.**
2. Reword the WIP commit before the PR. Its message says "not for merge".
3. **Run the API suites first.** Nothing in the API has been tested on this branch yet. Likely breakages:
   - Tests that pin `resolveInvitation`'s select string (it now also reads `carrier_questions`).
   - `applicationSend` tests: the RPC now gets `p_carrier_questions`, and Send reads
     `recruiting_carrier_questions`, so seed it in the recorder.
   - Submit tests: the stamp overlay.
   - `routeGateLedger.test.ts`: there are new routes.

### What is already on the branch (`ba70192`)

- **`packages/shared/src/carrierQuestionsContract.ts`** (tested in `carrierQuestionsContract.test.ts`, 15 cases,
  including one that reads 0567's `kind in (…)` and compares it with `CARRIER_QUESTION_KINDS`):
  - The create and update schemas.
  - `carrierQuestionsToStamp(liveRows)` — what Send records on the invitation.
  - `carrierStampOf(raw)` — reads a stored stamp; anything malformed reads as `[]`, never a throw.
  - **`carrierQuestionnaire(stamp)`**, which turns the stamp into a `QuestionnaireDefinition` (id `carrier`,
    version `stamp`). Optional questions get the built-in `RATHER_NOT_SAY` skip (now exported from
    `questionnaireContract.ts`). A `select` is keyed by its own frozen words.
  - `carrierAnswerIssues(stamp, answers)` — paths are `["carrier_answers", id]`. It checks each answer's shape
    with `questionnaireAnswersSchema` and asks for every required one.
  - `answersToStamp` — keeps only answers to the stamp's own ids.
- **`applicationContract.ts`**: `carrier_questions` (the stamp) and `carrier_answers` (a record) on
  `driverApplicationObject`. `crossFieldRules` also runs `carrierAnswerIssues`, so the wizard and the API check
  with the same rules (A3's property).
- **API**:
  - `modules/recruiting/carrierQuestions.ts`: list, create, update, and CQ013 → 409 `questions_full`.
  - `routes/carrierQuestions.ts`: `GET/POST /carrier-questions`, `PATCH /carrier-questions/:id`. View for
    recruitment view, the rest for manage. Mounted in `routes/index.ts`.
  - `applicationSend.ts`: stamps `carrierQuestionsToStamp(listCarrierQuestions(…))`.
  - `applicationIntake.ts`: the invitation row has `carrier_questions`.
  - `publicApplicationBundle.ts`: serves `carrierQuestions: carrierStampOf(...)`.
  - `applicationSubmit.ts`: replaces the page's copy with the **invitation's** stamp, trims the answers to it
    and runs `carrierAnswerIssues`. It is at **438 lines** (budget warns at 450, fails at 500), so split it
    before adding anything.

### Still to build

1. **API tests**, each one mutation-proved:
   - The routes: list, add, change, retire, 409 when full, the role gates, `expectOrgScoped`.
   - Send stamps the live list.
   - The bundle serves the stamp.
   - Submit: uses the stamp, not the body; drops answers to unknown ids; refuses a missing required answer;
     an invitation with no stamp files no carrier questions.
   - Remove `recruiting_carrier_questions` from the producer waiver in `scripts/check-table-producers.mjs`.
2. **Applicant's page** (`apps/web/src/features/apply`):
   - `servedForm.ts` gets a `servedCarrierQuestions` ref; `takeServedForm` takes `bundle.carrierQuestions`.
   - `draft.ts`'s `questionnaireFields` emits `carrier_questions` and `carrier_answers`. Store the answers in
     the draft under their own key; `applicationDraftPayloadSchema` comes from the strict object's
     `.partial()`, so `carrier_answers` is already allowed.
   - Draw them on the questions screen **after** the built-in ones with `QuestionnaireFields.vue` over
     `carrierQuestionnaire(stamp)`.
   - In the carrier's words on the Spanish page too (Q-MT1, D-CQ4). The skip's label is the existing
     translation.
   - The review's missing list (`missingAnswers.ts`) and the task hub's count. Check `fieldLabels.ts` and
     `editableFields.ts` for the new keys.
3. **Office drawer** (`ApplicationReviewDrawer.vue`, 419 lines): print the application's own
   `carrier_questions` and `carrier_answers` (the stamp, not the live list). Use `choiceLabel` and the skip
   label.
4. **Filed documents**:
   - The §391.21 summary (`applicationPdf/render.ts`, 397 lines; `questionnairePage.ts`): a second section
     drawn through `questionnaireSection`'s logic over `carrierQuestionnaire(stamp)`. Unanswered prints
     "Not answered."
   - The carrier's packet: an **appended** sheet, "The carrier's own questions". **Never insert a page.**
     Packet page numbers are PDF indices, and inserting one moves every signature. Reuse the continuation
     sheet's letterhead and footer (`packet/packetContinuation.ts`, `packetContinuationFurniture.ts`); it is
     appended after the continuation sheet, if there is one.
   - The office's packet preview and the applicant's reading copy are drawn from the DRAFT, so pass the
     draft's answers too (`questionnaireAnswersOf`'s two-keys lesson).
5. **Settings → Recruiting → "Your own questions"**:
   - A new component beside `CarrierStepsEditor.vue` (`apps/web/src/features/recruitment`), mounted from
     `SettingsRecruitingPage.vue`.
   - Add a question (wording, hint, kind from `CARRIER_QUESTION_KIND_LABELS`, choices editor for `select`,
     required). Edit the hint and required; reorder by `position`; retire.
   - Say plainly that wording, kind and choices cannot change once saved ("retire it and add a new one"),
     and show the 20-question limit.
   - Read `docs/DESIGN-SYSTEM-CONTRACT.md` and the UI-standardization memory first.
6. **Plan log**: append a CQ2 entry to §7. Also add D-CQ6: "the stamp IS a questionnaire definition".
7. **Gates**:
   - `pnpm ci:local --job gates`, `typecheck`, `test-packages`, `test-web`, `test-api`, `matrices`, then
     `node scripts/scan-secrets.mjs` after committing.
   - On a loaded machine, test-api times out a few unrelated suites (seen today: ads compose, OCR, filing
     claims). Re-run those on their own before calling them failures.
   - Then the PR with the template's four headings, then merge when CI is green.
   - CI's `bundle` job sometimes fails installing Chromium (apt exit 100). That is infrastructure:
     `gh run rerun <id> --failed`.

## Then: small gaps in what is already merged

7. **The signed policy is missing from the applicant's Documents list.** `ApplicantPhotoStrip.vue` filters to
   `APPLICANT_DOCUMENT_KINDS` (the papers an applicant uploads), so the filed `drug_alcohol_policy` shows only
   in the driver's file (`FileGallery`, labelled through `DQ_KIND_LABELS`). Add it in a way that doesn't
   restate a kind list: derive it from `CARRIER_POLICY_DOCUMENT_KINDS`.
8. *(Optional; ask the owner)* An office preview of the blank policy in Settings → Recruiting
   (precedent: `handbookPreview.ts`).

## Then: walk it on staging (before the owner approves a release)

9. End to end on staging (`STAGING_*`; test logins are in the `staging-test-members` memory):
   - p28: Sign is off until the policy is opened; the policy names **Varmeda**.
   - Filing puts "Drug and alcohol policy (signed)" in the driver's file, with the signature and date on its
     last page.
   - The Sensitive papers switch hides SSN-card and passport pictures from a role switched off.
   - After CQ2: add a question, Send, answer it on the link (English and Spanish), file, then see it in the
     drawer, on the summary and on the packet's appended sheet.

## The owner's

10. **Q-DAP2 — proofread the rendered policy against the paper, BEFORE the release.** Every correction changes
    `DRUG_ALCOHOL_POLICY_VERSION`. A driver who signed p28 under the old text keeps a valid receipt, but no
    signed policy is filed for them (D-DAP5).
11. **Approve the release PR.** The release runs 0564, 0565 and 0567 before the code. Old code survives the
    new schema: the 13-argument `record_packet_mark` stays, and the old 5-argument Send call resolves to the
    6-argument function and stamps nothing.

## After production (not blocking)

12. A migration drops the 13-argument `record_packet_mark` once a release has run with DAP2 as its only
    caller (D-DAP4).
13. Carried over: PSP go-live settings (the production token expires around 12/12), the first real Med-Stop
    order, the HW6a QCMobile key.

## Working rules that bit today

- **Migration numbers race.** 0566 was taken by the ads chat between the check and the PR. Re-check by name
  right before merging; renumber the file and every reference, then regenerate `supabase/schema.generated.sql`.
- **A matrix that pins a function's exact signature breaks on the next widening.** 0550's did. Check
  privileges by oid over `pg_proc`, as `hiring-question-document-settings.test.mjs` does now.
- **`git rebase --onto X HEAD~2` replays the parent too.** If a branch sits on an un-merged commit, rebase onto
  `origin/main` once that commit has merged, or cherry-pick your own commit.
- `lint:schema-snapshot` diffs against the working tree: commit the regenerated `schema.generated.sql` before
  trusting a red result.
- A test fixture named "Marija Varmeda" collided with the policy's real representative. Use other names in
  policy tests.
- Work in a worktree off `origin/main`, never in the main checkout (`claude/fleet-overview-v3`, which has
  untracked files). Fresh worktree: `pnpm install --frozen-lockfile`,
  `pnpm --filter @silvicom/shared build:rn`, and copy `apps/web/.env`.
- Mutate to prove every new test. A mutant that changes nothing (e.g. dropping a REVOKE that 0412 already
  does) is not a survivor; say so in the PR.

Worktrees you can remove once their branches are merged: `../FuelGuard-dap`, `../FuelGuard-dap2`,
`../FuelGuard-dap3`, `../FuelGuard-cq`.
