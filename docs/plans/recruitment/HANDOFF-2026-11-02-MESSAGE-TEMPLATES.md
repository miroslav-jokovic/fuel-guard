# Handoff — hiring workflow, 2026-11-02 (after the question and document settings)

Paste this into a fresh chat. It continues the hiring workflow plan; you build the next step.

## Where things stand

The plan is `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md`. Read §9.3 (the order of the
remaining work), §8.2 (what each remaining item is), §10 (the checklist editor), §11 (the settings just
built) and §7 (the progress log, which sits at the END of the file, after §11).

**On production** (release of 2026-11-02, #1907): §9 P1–P12, HW5b/c/d, HW8a database half.

**Merged 2026-11-02, on staging, waiting for the next release the owner approves:**
- #1901 orientation videos screens; #1922 (migration 0545) + #1929 checklist editor (§10).
- **#1935** (`6c139d5`), **migration 0550** `hiring_question_document_settings`:
  `recruiting_settings.required_questions` and `offered_document_slots` (null = standard set), and
  `application_invitations.required_questions` (the set stamped at the office's FIRST Send; a resend
  never restamps). `send_application_invitation` gained `p_required_questions text[] default null`.
- **#1941** (`2ab0738`), the reader: `packages/shared/src/applicationFormSettings.ts`
  (`withRequiredQuestions`, `requiredQuestionsToStamp`, `offeredCaptureSlots`, `captureSlotOffered`, the
  two PUT schemas); the rule in `applicationRules.ts` reads `questionnaire_required` off the payload;
  `submitApplication` overwrites it with the invitation's stamp and re-runs `questionnaireRequiredIssues`;
  the bundle serves `requiredQuestions` + `offeredDocumentSlots`; web keeps them in
  `apps/web/src/features/apply/servedForm.ts` (module state, laid over in `applicantQuestionnaire`);
  Settings → Recruiting "The application form" (`ApplicationFormSettings.vue`); capture refuses a
  withheld slot with 409 `capture_slot_not_offered`.

**Owed in the plan's §7 log** (put it in your first PR, don't open a docs-only PR): one line
"S2 merged (#1941, `2ab0738`), no migration. As above."

**Known, recorded, not built:** the `capture_slot_not_offered` message is English only, like every
capture error from the API (no code-to-Spanish map exists for API errors on the applicant's page).

## Next step: message templates (§8.2, §9.3)

§8.2: "message templates (invitation, reminder, travel, videos)". The owner said build as proposed.

What exists today — read each before deciding anything (the list is from a quick survey, verify it):
- Invitation / application-sent email: `packages/shared/src/applicationSentEmail.ts`
  (`applicationSentSubject`, `renderApplicationSentEmail`), sent from
  `apps/api/src/modules/recruiting/applicationSend.ts` (email + SMS through `sendOrQueueSms`).
- Reminder: `nudgeEmail` in `apps/api/src/modules/recruiting/applicationNudgeSweep.ts:59`.
- Approval notice: `apps/api/src/modules/recruiting/applicationApprovalNotice.ts` (`smsApplicationApproved`).
- Invite by text: `applicationInviteText.ts`. Orientation videos send: `orientationVideosContract.ts` and
  its route. Travel: `routes/travel.ts` (check whether it messages the applicant at all).
- SMS strings and their compliance rules (STOP wording, Telnyx) — memory "SMS is Telnyx"; check
  `sms*` modules for length limits and required footers before letting a carrier edit a text.
- Spanish: the applicant reads Spanish (`apps/web/src/features/apply/es/`); decide whether templates
  are per language.

Shape I would propose (decide, write it into the plan as **§12** with decisions + open questions, then
build — two PRs, migration first, then the reader):
- The product wording stays the default, in code (derived, never copied into SQL). A carrier OVERRIDES
  only the free-text parts (a greeting, a closing paragraph, the subject) — never the link, the expiry
  sentence, the STOP line or anything a rule needs. Placeholders from a closed list (`{first_name}`,
  `{carrier}`, `{days}`), checked in TypeScript.
- Storage: one table `recruiting_message_templates` (org, message key, channel email|sms, language,
  subject, body, updated_by/at), RLS on, no client policies; or columns on `recruiting_settings` if the
  set stays tiny — decide and say why. The message keys are derived from a TS catalogue, not a SQL CHECK
  list (§10 D-CE3's rule).
- A message already sent is not re-rendered: decide whether the sent text is recorded (audit /
  `sms_outbox` already store something — check) so "what did we send them" stays answerable.
- Settings → Recruiting gets a "Messages" section: each message with a preview rendered by the SAME
  function the sender uses, and "Use the standard wording".

After that, §9.3's order: the applicant status page (replaces `ApplyWaitScreen.vue`) → dispositions
(on hold, rehire eligible / do not rehire, reactivate; today `applicantDisposition.ts:23` has three) →
HW8b in-office orientation checklist + signing (needs evidence, which is what lets
`orientation_blocks_hire` exist) → DAC (Q-WF7). HW6a/HW6b (FMCSA QCMobile employer lookup, PSP
suggestions) wait on the owner's QCMobile webKey.

## How to work (each one bit this session)

- Own worktree + branch off `origin/main` for each PR (`claude/<topic>`); parallel chats share the main
  checkout. Fresh worktree: `pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn`.
- **Migration number: next free is 0551 today (0547–0549 are the office chat's, 0550 is §11's). The office
  chat took THREE numbers in one afternoon, one of them while S1 sat in CI.** `git fetch` and check
  `ls supabase/migrations` on `origin/main` AND the migrations on every open PR branch, BY NAME,
  immediately before every merge. Renumber everywhere the PR names it (file name, header, matrix header,
  comments in code, plan §-section and §7 line, PR body), regenerate `supabase/schema.generated.sql`
  (`node scripts/gen-schema-snapshot.mjs`), and check whether a newer migration redefined a function you
  copy (e.g. `purge_applicant`, `send_application_invitation`).
- **Rebasing after main moves:** the snapshot always conflicts — take main's (`git checkout --theirs`),
  regenerate, `git add`, continue. Then `git diff --name-only origin/main HEAD` and make sure ONLY your
  files are in it (a botched rebase this session carried someone else's ads files in; restored them from
  `origin/main` before pushing). Never push during a rebase; `git status` must say no rebase in progress.
- A migration and its first reader ship in two merges (`lint:migration-ordering` fails the reader PR until
  the migration is on main — expected). A new table needs: RLS, `table-modules.json` +
  `table-lifecycle-unmeasured.json` entries, a producer waiver in `check-table-producers.mjs` until its
  writer lands (removed in the reader PR), writer pairs in `table-writers.json` in the reader PR, a seed in
  `supabase/tests/rls.test.mjs`, and — if it references drivers — `DRIVER_REASSIGNMENTS` (`mergeDriver.ts`),
  `purge_applicant` + `purge-applicant.test.mjs`.
- Settings fields: every field added to `recruitingSettingsSchema` is **optional on the PUT, absent = keep
  what is stored**; where null is a meaningful value ("standard"), use `=== undefined`, not `??`
  (`recruitingSettings.ts` save). Copy the tests in `recruitingSettings.test.ts` (one per older screen).
- Gates: `CI=true pnpm ci:local --job gates,typecheck` (~2 min). Full suites per package with `CI=true`.
  Web vitest needs `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key`.
  Under full-machine load ~8 web files time out (dashboard ActivityWidget, hazmat VerdictPanel census,
  LiveMapWorkspace, DrugTestPanel, RoadsideRepairsPanel, pageLoadFailureRetry, sectionGuard) — rerun them
  alone before believing them. Always pass `< /dev/null` to `npx vitest` in scripts; a stray stdin read
  hung a command for 5 minutes this session.
- Mutation battery for every PR, from a **bash** script (zsh does not word-split `$VAR`): break each rule
  with `perl -0pi`, run the targeted tests, judge by the `Tests … failed` line (not by grepping `×`,
  which a vitest progress line can print without a failure), restore from a `cp` backup and `cmp` it. A
  survivor means the test is at fault: add one. Last battery script:
  `/private/tmp/claude-501/-Users-miroslavjokovic-Projects-FuelGuard/e14b3af7-c2f4-49f6-8117-d6575c7c6da0/scratchpad/mut-s2.sh`
  (may be gone; the shape is in this paragraph).
- API: every service query `.eq("org_id", …)`, proven with `expectOrgScoped`; the public token lookup on
  `application_invitations` is exempted (`{ exempt: ["application_invitations"] }`) since it is scoped by
  the token hash. Audit rows never carry a note's or message's words.
- Applicant-facing strings need Spanish (`apps/web/src/features/apply/es/`); a new contract key on
  `driverApplicationObject` also needs a label in `fieldLabels.ts`, an owning screen in
  `applicationSections.ts`, and (if the office must not edit it) `NOT_AN_ANSWER` in `editableFields.ts`
  — three tests caught those this session.
- CI monitor: GitHub runs NO pull_request CI on a conflicting PR (`mergeable: CONFLICTING`, "no checks
  reported") — treat that as "rebase now", not "still running".
- PR: title for an office reader (release-notes line), body under the four template headings, ends with
  the Claude Code line. Merge yourself when CI is green. Production moves only through the
  owner-approved release train.

## Open owner questions (none blocks the next step)

Q-WF4b (who sees SSN-card/passport images; provisional admin + safety manager), Q-WF8 (which videos
exist), Q-OR7 (drug-and-alcohol policy not on file), Q-CE1/2/3 (§10), Q-RS1/2/3 (§11), the HW5b ruling on
questions for non-DOT jobs inside three years, the FMCSA QCMobile webKey, and P11's staging act (a
recruiter hiring with `roster: manage`; no recruiter test login on staging).
