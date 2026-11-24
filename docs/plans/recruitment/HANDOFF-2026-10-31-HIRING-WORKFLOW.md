# Handoff — the hiring workflow two-day build (2026-10-31 → 2026-11-01)

**Goal, in the owner's words:** the hiring feature "100% production ready" in two days. What that
means is defined in `docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md` §9's first
paragraph — read it before anything else. §9 is the operative queue (twelve PRs); §8 is why it
differs from §5; §7 at the END is the log you append to.

## Calendar

- Today is **Saturday 2026-10-31**. Tomorrow is Sunday.
- The release train runs Sunday–Thursday nights at **01:07 CT**. Everything merged by Sunday evening
  is on production **Monday 2026-11-02 01:07 CT** once the owner approves the open
  `main → production` PR (he does that by Sunday 23:00 CT).
- A merge is on staging in minutes. The owner walks each step as it lands — tell him what to look
  at in each PR's "How to check it on staging".

## Start here — Saturday, four lanes in parallel

Start **P1, P2, P3 and P5** now, each in its own worktree and branch off `origin/main`
(`git worktree add -b claude/<topic> .claude/worktrees/<topic> origin/main`). Never work on the
main checkout: parallel chats share it. The §9.1 table has every file and line for each.

| PR | Lane | Branch | One line |
|---|---|---|---|
| P1 | A | `claude/hw1-road-test` | Road test RT-A1…A10 (§3.1 / §4.2). No schema. |
| P2 | B | `claude/hw2-drawers` | `hired → HireDrawer`, the §3.2 copy table, dates, headings, callouts. No schema. |
| P3 | C | `claude/hw3b-order-advises` | **Migration 0533**: `send_application_invitation` without AI005, `open_packet_signing` without AI006, `handbook_marks_guard` without HB022. Leave DR032/DR036/HB023 alone (§8.1). Merge before P4. |
| P5 | D | `claude/hw5a-office-edits-draft` | Office edits the draft from send until filing, through `save_application_draft(…, p_expected_revision)`; null cells editable; rows by `key`; delete with confirm; add with a street; explain a gap. |

Then, in the same lanes: **P4** (free order in code, after P3 merges), **P6** (migration 0534,
documents), **P7** (migration 0535, `applicant_notes`). Sunday: P8–P12 per §9.2.

## Facts verified at `origin/main` fde9a56 that the queue rests on

- `hiringSteps.ts` is the ruled process: `TRAVEL_REFUSES_WITHOUT` (every `beforeTravel` step),
  `HIRE_REFUSES_WITHOUT` (six federal + handbook), `REFUSAL_EDGES`, and the existing
  `APPLICATION_SEND_WARNS_ON` / `OPEN_SIGNING_WARNS_ON` lists that already render as a caution
  callout. P4 turns refusals into `warns` lists of the same shape.
- The applicant draft **is** revision-guarded: `application_drafts.revision` (0376), DA041 on a
  stale save, `applicationDraft.ts:193` maps it to 409, `DraftNotice.vue:22` shows the conflict.
  The hole is `editApplication` in `applicationReview.ts:247` — a bare `.update({ payload })`.
- `canHire` is `session.can("roster")` and the API gate is `requireSection("roster")` from the
  org's editable matrix. A recruiter can be granted it in Settings → Permissions. Unverified:
  whether 0213's trigger on `drivers.status` reads the role or the grant — that is P11, on staging,
  with the recruiter test member (`staging-test-members` memory).
- `crossMatchEmployment()` exists with no caller — **not** in the two days (HW6b, next week).
- Spanish is live (C4). Every applicant-facing string P8/P9 touch has a twin in
  `apps/web/src/features/apply/es/strings.es.*.ts`.
- `apps/web/e2e-apply/` is the only Playwright CI runs; P8 changes what Send refuses, so its spec
  changes in the same PR. Build `dist` with CI's placeholder `VITE_SUPABASE_*` first.

## Rulings §9 assumes (§8.3) — the owner can overturn by Saturday evening

Q-WF1 (a) six federal checks at hire · Q-WF2 (a) warn on road test before the drug result ·
Q-WF3 required = position, applying as, heard from, legally able to work, proof of age, may we
contact employers, education · Q-WF4 (a) SSN-card/passport images for the roles that see the full
SSN · Q-WF5 (a) · Q-WF6 nothing non-federal blocks the hire, **handbook included** (D-HB5
replaced; P12 makes it a switch). If he changes one, write the change into §8.3 and §7 first.

## Rules every PR follows (each is a gate or a memory with a scar)

- One §9 row = one PR. Body under the four headings of `.github/pull_request_template.md`
  (`gh pr create --body-file` skips the template — write them in). Title = the release-notes line.
- Run every gate locally and **check `$?`** (`run-all-ci-gates-before-push`); `CI=true` for vitest
  or a local timeout writes snapshots. `lint:comment-claims`: a comment claiming coverage must
  quote a real test title. `lint:filesize` 500/450, `lint:funcsize` 200 in api services.
- **Migration numbers 0533–0536 are claimed by NAME in §9.** A parallel chat may take one — re-check
  `git ls-tree origin/main supabase/migrations/ | tail` right before merge
  (`migration-number-race-with-parallel-chat`). A column and its first reader are two merges
  (`lint:migration-ordering`); both ride Monday's train.
- Every new table: `enable row level security`; `applicant_notes` (P7) **must be listed in
  `merge_driver`'s cascade** (`merge-driver-cascade-trap`) and deleted by the applicant purge.
  Never `.upsert()` with a partial payload. Every service query org-filters and the test asserts it
  with `supabaseRecorder`'s `expectOrgScoped`.
- Prove tests by mutating the line they pin (`prove-tests-fail-by-mutating`); a green mutant means
  the test is at fault.
- Merge yourself when CI is green; never ask. Never push during a rebase. Never bare `git stash`.
- Dates through `formatDisplayDate` (MM/DD/YYYY from one definition). Reuse `AppCallout`,
  `AppBadge`, `BaseButton`; don't replace shared UI.

## Sunday evening — the pass and the release

1. Three fixtures on staging (`browser-pass-three-fixtures`: failing API, empty org, staging org,
   9 s settle) across the board, the record, every drawer, the applicant link in EN and ES.
2. The office walk in §9.2: invite → Part 1 → permissions → office edits two jobs and removes a
   blank row → send → applicant refused once with the missing list → approve → travel with PSP open
   (warned) → office uploads a TWIC → road test on a truck in maintenance, one fail then a pass →
   signing → handbook → hire by the **recruiter** with the six shown before the press → a note and
   the activity list read the day back.
3. Owner approves the release PR by 23:00 CT. Monday 08:00: `pnpm verify:live`, then the owner
   flips the recruiter's roster grant on production.

## Where state lives

- Plan + log: `HIRING-WORKFLOW-AUDIT-2026-10-31.md` §7 (append a dated line per merged PR with its
  number and migration).
- Session to-do: claude-mem work state list `hiring-workflow-two-day-build` (one item per PR —
  mark `doing` / `done` as you go).
- Memory pointer: `hiring-workflow-two-day-build-position.md` (update its **Status** line at the
  end of each day).
