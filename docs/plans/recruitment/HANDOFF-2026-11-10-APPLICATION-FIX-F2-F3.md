# Handoff 2026-11-10: driver application fix, next are F2 and F3

Paste this into a fresh chat. Repo: `/Users/miroslavjokovic/Projects/FuelGuard` (Silvicom 360). Read
`CLAUDE.md` first, then `docs/plans/recruitment/APPLICATION-FIX-PLAN.md` (§3 F2/F3, §5 questions, §7
progress log at the END) and `docs/plans/recruitment/APPLICATION-SCREEN-MAP.md` §10 (D-AM7).

## Goal (owner, 2026-11-09)

The driver's form, the office dashboard and the signed packet must match 100% (D-AM7). Every fact the
driver answered must be editable by the office before signing (Q-AM2 → b: nothing after signing).
Owner, 2026-11-10 (Q-AM13): "we should be able to edit each answer because drivers make mistakes and
we need control on any mistakes".

## Done, all merged to main (production gets them on the next release train)

| PR | What |
|---|---|
| #2165 | Audit, fix plan F0–F5, screen map, owner rulings |
| #2166 | F0: final send says what blocks it; miles "100,000"; blank counts asked again; drawer lists real captures; DOB/CDL no longer offered as a draft edit; view-only gating; refused edit kept on screen |
| #2169 | Typed dates (D-AM6): "1001" → 10/01/this year, "10011985" → 10/01/1985, spelled out EN/ES |
| #2172 | Plan status log + recommendations for the open questions |
| #2176 | **F1 part 1, the fact catalogue**: `packages/shared/src/applicantFacts.ts` lists every fact with its input kind, legal basis, packet place (or `notPrinted` reason) and today's office door. Parity tests: `packages/shared/src/applicantFacts.test.ts` (walks the Zod contracts) and `apps/api/src/modules/recruiting/applicationPdf/packet/applicantFactsPacket.test.ts` (walks what `packetFieldFill` places). |
| #2180 | **F1 part 2**: nothing starts answered. `operated_cmv`/`dot_regulated` are null until tapped (contract `.nullish()`, required by `unansweredEmployerQuestions` at hand-off/filing). The legacy §40.25(j) question is a Yes/No, required by `applicationLegacyFilingIssues`. |
| #2190 | **F0b**: when the DOB on file is wrong, the driver asks for a 6-digit code (email to the invitation's address, or SMS to the consented number). Migration **0585** `application_unlock_codes`; `applicationUnlockCode.ts`; the drawer notice "The date of birth on file may be wrong". |

## What is next: F2 and F3 (both depend only on F1, so they are independent)

**Recommended order: F3 first**, because it is the owner's "control over every mistake". F2 can run in
a parallel chat (it touches the packet renderer, F3 touches the office drawer and edit API).

### F3: one "Applicant facts" card for the office (plan §3 F3, SCREEN-MAP §10)

- **Build it from the catalogue.** `APPLICANT_FACTS` gives each fact's `input` kind (date, us_state,
  jurisdiction, phone, zip, yesno, count, miles, choice, …). The card's editor must use the same
  controls as the wizard (`AppTypedDate`, the state list, Yes/No). Never a stored-format text box (E8).
- **It replaces four edit paths:**
  - "Correct an answer" (`apps/web/src/features/apply/ApplicationAnswerList.vue` + `editableFields.ts`);
  - the jobs edits (`OfficeJobsSection.vue`);
  - `PartOneCorrection.vue` (API: `applicantPartOneCorrection.ts`);
  - the identity correction in the Permissions/Road-test drawers (`applicantIdentity.ts`).
- **The office gap is pinned.** `applicantFacts.test.ts` holds an inline snapshot of the 13 facts with
  no office door today. F3 shrinks that list, and each fact it opens is a visible snapshot change.
  The 13:
  - endorsements, `prior_positive_2y`, the three §382.301(b) answers, `donor_gender`,
    `medical_card_pending`, `prior_failed_pre_employment_test`;
  - education and references (tables), `eeo`, `carrier_answers`;
  - `ssn`.
- **Owner's Q-AM13 rules:**
  - The four drug-test statements (§40.25(j) + §382.301(b)) are editable, but need a required note,
    are audited as office-entered, and the driver accepts them on screen 3.1 before signing.
  - `donor_gender` and `eeo` are **replace-only**: overwritten, never shown, because they must not reach
    whoever decides the hire.
  - The SSN is replace-only, shown as •••-••-1234.
  - Signed acts are never editable: e-sign consent, the six permissions, the adopted signature and
    initials, packet marks, certification.
- **Every edit writes an `application_edits` row**, so the driver sees "You put / It now says" on
  screen 3.1 (E7). Edits stop at the first packet mark.
  - **Migration check, done 2026-11-10:** `application_edits.path` is free `jsonb` with no target
    CHECK, so Part 1 and identity edits can likely be logged without a migration. Verify the writer
    and the signing screen's reader before deciding.
- **Email or phone edits must also move the invitation's contact** (E3), as an audited act.
- **Add and remove rows** for addresses, accidents, convictions, equipment, other names and licences
  (E2). Employers already work by `key` (`applicationReviewEdits.ts`).
- **F0b's notice tells the office to correct the DOB in Identity.** Once the card exists, point the
  notice at the card.

### F2: the packet prints what was asked (plan §3 F2)

- **The catalogue names every gap.** Entries with `notPrinted: "...F2's employment addendum page 12a
  prints it (P1|P6|P7|gap explanations)"`:
  - per-employer reason for leaving, FMCSR, safety-sensitive, DOT-regulated, drove-a-CMV, USDOT,
    email (P1);
  - address dates (P6);
  - experience narrative and email (P7);
  - gap explanations;
  - endorsements on the licence line (P12).
- **Other items:**
  - split `licence_ever_denied` into denied / suspended-revoked (P4);
  - a licence `kind` (CDL/CLP/non-CDL/other) asked in Part 1 (P3);
  - convictions get city + required penalty + bond forfeiture (P10);
  - the "OTHER" equipment row prints the type name (P5).
- **When an addendum page prints a fact**, change that fact's `packet` in `applicantFacts.ts` from
  `notPrinted` to the new place ids. The packet parity test then holds it.
- **Overflow already exists.** Use it rather than inventing a second layout:
  `packetContinuation.ts`/`packetContinuationText.ts`/`packetContinuationFurniture.ts`, and
  `packetFieldValues.ts` returns `overflow`.
- **Look at the rendered PNG before finishing.** Text collisions are invisible to tests (memory:
  `pdf-text-collisions-are-invisible-to-tests`, `measure-packet-coordinates-by-looking`).

## Open owner questions (plan §5 + SCREEN-MAP §8): recommendations are written there

- **Q-AM1:** send ONE question back to the driver (F5). Recommended yes.
- **Q-AM3:** SSN on the packet. Recommended last 4.
- **Q-AM4:** is page 21 (7-day statement) used?
- **Q-AM5:** which carrier-only requirements stay required.
- **Q-AM6:** US spelling.
- **Q-AM8:** street optional on previous homes.
- **Q-AM9:** one DOT question per employer.
- **Q-AM10:** FMCSA name search (later).
- **Q-AM11:** employer dates as month and year.
- **F2 needs Q-AM3 and Q-AM4**, and Q-AM9 changes what the addendum prints per employer. Ask before
  building those parts.
- **F3 needs none of them.**

## Deferred, not forgotten

- **F1's "unified rules"** (non-US ZIP, any phone, CLP class, key renames) are behaviour changes.
  Part 1's ZIP and phone are held by 0376's CHECKs (5-digit ZIP, US mobile), so they need a
  migration first and their own merges.
- **The remembered-device token** (skip the DOB on a known phone) belongs to F4.

## Working notes from this session (mostly in memory already)

- **Branch and worktree:** branch from `origin/main` in its own worktree (`git worktree add -b claude/<topic> ../FG-<x> origin/main`). Then run `pnpm install --frozen-lockfile`, `pnpm --filter @silvicom/shared build:rn`, and copy `apps/web/.env` and `apps/api/.env`.
- **Migration numbers race with parallel chats.** 0584 was taken mid-session. Re-check `origin/main` just before pushing. The next free number today is **0586**.
- **The table gates only see literal names.** Use `.from("table_name")`; `.from(CONST)` fails `lint:boundaries`, `lint:table-producers` and `lint:table-writers`.
- **A new table referencing `application_invitations` must be seeded in `supabase/tests/purge-applicant.test.mjs`.** If it cascades with the invitation, it is proved by the footprint check, like `medstop_applicant_creates`.
- **Design token:** borders use `border-edge`, never `border-line`.
- **File budget:** 500 lines; `useApplication.ts` is near it. Put new web calls in their own module, as `unlockCode.ts` does.
- **Running tests locally:**
  - `pnpm ci:local --job gates,typecheck` takes about 2 min. Job names: gates, typecheck, test-api, test-web, test-packages, matrices.
  - `pnpm test:rls` runs every matrix.
  - Full local suites time out under load. Rerun a failing file alone before believing it.
- **Mutation-check every new test:** back the file up to the scratchpad, mutate, run, restore, and compare byte-for-byte.
- **If a PR shows 0 checks**, close and reopen it to re-trigger CI.
- **PR flow:**
  - Open the PR with the four template headings in `--body-file`.
  - Merge yourself once CI is green: `gh pr merge N --merge --delete-branch`. Auto-merge is disabled.
  - Append plan progress at the END of §7.
