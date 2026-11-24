# Handoff — hiring workflow, 2026-11-02 (after the checklist editor)

Paste this into a fresh chat. It continues the hiring workflow plan; you build the next step.

## Where things stand

The plan is `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md`. Read §9.3 (the order of the
remaining work), §8.2 (what each remaining item is), §10 (the checklist editor, just built) and §7 (the
progress log; it sits at the END of the file, after §10).

**Done and on production** (release of 2026-11-02, #1907): §9 P1–P12 (road test, drawers, any-order
steps, office edits the draft, documents, notes and activity, required questions, "Before we hire"),
HW5b employment timeline (#1899), HW5c gaps (#1892, #1902), HW5d employer corrections (#1893), HW8a
orientation videos database half (#1896).

**Merged 2026-11-02, on staging, waiting for the next release the owner approves:**
- #1901 — orientation videos screens (Settings list, send, applicant's "I watched these").
- #1922 — checklist editor database, **migration 0545** `hiring_carrier_steps` + `hiring_carrier_step_records`
  + `recruiting_settings.hidden_hiring_steps`.
- #1929 — checklist editor screens: Settings → Recruiting "Your hiring steps"; carrier rows on the
  applicant checklist; `CarrierStepDrawer` (tick / filed document / take back with a reason); hire refuses
  on a step set to hold it; built-in steps a carrier may turn off (`carrierMayHide` in `hiringSteps.ts`,
  derived list `HIDEABLE_HIRING_STEPS`).

**Owed in the plan's §7 log** (put it in your PR, don't open a docs-only PR): one line "CE2 merged
(#1929, `739213c`), no migration. As above." The CE2 entry itself is already there.

## Next step: required questions and documents as settings (§8.2, §9.3)

§8.2: "the required set of carrier questions (Q-WF3 as a setting served by one endpoint and read by both
validators keeps the client/server agreement the contract comment defends), the documents offered".

What exists today:
- Required questions are hard-coded in `SILVICOM_DRIVER_V3` (`packages/shared/src/questionnaireContract.ts`
  ~line 364): seven questions `required: true`, enforced through `APPLICATION_CROSS_FIELD_RULES`
  (`applicationRules.ts`, `applicationFilingRules.ts`, `applicationContract.ts`) on both the wizard and
  the API. A draft carries the questionnaire version it was answered against; a draft with no version reads
  as v2 (nothing required). **Never edit a served questionnaire version** — the file's own rule.
- Documents offered: `APPLICATION_CAPTURE_SLOTS` in `applicationCaptureContract.ts`; Part 2's "Your
  documents" (`DocumentCaptureFields.vue`) offers every slot (§9 P9).
- Settings: `recruiting_settings` (0379, columns added in 0536, 0539, 0545), contract
  `recruitingSettingsContract.ts`, service `apps/api/src/modules/recruiting/recruitingSettings.ts`. Every
  added field is **optional on the PUT and "absent = keep what is stored"** — a screen served before the
  field exists must not clear it. Copy that pattern and its tests.

Shape I would propose (decide, write it into the plan as §11 with decisions and open questions, then
build — the owner said build as proposed):
- **S1 (migration)** `recruiting_settings.required_questions text[]` and `offered_document_slots text[]`
  (null = product default), plus whatever validation shape the column needs. Which questions MAY be
  required and which slots MAY be turned off is derived in TypeScript from the questionnaire and the
  slot catalogue, not listed in SQL (§10 D-CE3's rule). The licence (CDL) slots and anything a federal
  rule needs stay on.
- **S2 (reader)** the served questionnaire's required set comes from the carrier's setting, through ONE
  function both validators call, so the wizard and the API cannot disagree. Think hard about drafts in
  flight: a question made required after an applicant started must not refuse them for a rule they never
  saw — the version mechanism exists for exactly this; decide whether the setting is stamped on the draft.
  Part 2 offers only the carrier's slots. Settings → Recruiting gets two lists of checkboxes. Spanish
  strings for anything the applicant sees (`apps/web/src/features/apply/es/`).

After that, §9.3's order: message templates (invitation, reminder, travel, videos) → the applicant
status page (replaces `ApplyWaitScreen.vue`) → dispositions (on hold, rehire eligible / do not rehire,
reactivate; today `applicantDisposition.ts:23` has three) → HW8b in-office orientation checklist +
signing (needs evidence, which is what lets `orientation_blocks_hire` exist) → DAC (Q-WF7). HW6a/HW6b
(FMCSA QCMobile employer lookup, PSP suggestions) wait on the owner's QCMobile webKey.

## How to work (each one bit this session)

- Own worktree + branch off `origin/main` for each PR (`claude/<topic>`); parallel chats share the main
  checkout. Fresh worktree: `pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn`.
- **Migration number: next free is 0547 today (0546 is the office chat's). The office chat has taken the
  number this lane wanted three times in one day.** `git fetch` and check `ls supabase/migrations` BY NAME
  immediately before every merge; renumber everywhere the PR names it (comments, plan, table manifests,
  matrix headers), regenerate `supabase/schema.generated.sql` (`node scripts/gen-schema-snapshot.mjs`),
  and check whether any newer migration redefined a function you copy (e.g. `purge_applicant`).
- A migration and its first reader ship in two merges (`lint:migration-ordering`). A new table needs:
  RLS, `table-modules.json` + `table-lifecycle-unmeasured.json` entries, a producer waiver in
  `check-table-producers.mjs` until its writer lands (and removing it in the reader PR), writer pairs in
  `table-writers.json` in the reader PR, a seed in `supabase/tests/rls.test.mjs`, and — if it references
  drivers — `DRIVER_REASSIGNMENTS` (`mergeDriver.ts`), `purge_applicant` + `purge-applicant.test.mjs`.
- Gates: `CI=true pnpm ci:local --job gates,typecheck` (~2 min). Full suites per package with `CI=true`.
  Web vitest in a fresh worktree needs `VITE_SUPABASE_URL=https://example.supabase.co
  VITE_SUPABASE_ANON_KEY=ci-test-anon-key` or every file fails "supabaseUrl is required". Some web suites
  (sectionGuard, efsSettingsWording, pageLoadFailureRetry, dashboard snapshots) time out under full-machine
  load locally — rerun alone before believing them. The two browser steps of `ci:local` always fail from
  `.claude/` worktrees.
- Mutation battery for every PR: break each rule, show a test goes red, restore byte-for-byte. **Run it
  from a `bash` script** — zsh does not word-split `$VAR`, so a list of test paths in a variable runs zero
  tests and prints nothing, which looks like a survivor. A survivor means the test is at fault: add one.
- API: every service query `.eq("org_id", …)`, proven with `expectOrgScoped` (`supabaseRecorder`);
  `user_profiles` is exempted the way `routes/notes.test.ts` does. Audit rows never carry a note's words.
- CI monitor: GitHub runs NO pull_request CI on a conflicting PR (`mergeable_state: dirty`); treat "no
  checks" and "dirty" as terminal states, not as "still running".
- PR: title for an office reader (release-notes line), body under the four template headings, ends with
  the Claude Code line. Merge yourself when CI is green. Never push during a rebase. Production moves only
  through the owner-approved release train.

## Open owner questions (none blocks the next step)

Q-WF4b (who sees SSN-card/passport images; provisional admin + safety manager), Q-WF8 (which videos
exist), Q-OR7 (drug-and-alcohol policy not on file), Q-CE1/2/3 (§10), the HW5b ruling on questions for
non-DOT jobs inside three years, the FMCSA QCMobile webKey, and P11's staging act (a recruiter hiring
with `roster: manage`; no recruiter test login on staging).
