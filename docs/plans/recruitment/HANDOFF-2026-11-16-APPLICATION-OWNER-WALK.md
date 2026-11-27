Handoff: driver application — everything ruled on is built; the owner's phone walk is next (2026-11-16)

Continue the driver application for Silvicom 360 (repo FuelGuard). The owner's standing instruction,
verbatim: "analyze and lets build the rest of things left properly and without assumptions, after
analysis proceed as proposed and recommended by you based on your role as product manager." The
standing rule also applies: PR flow, and merge it yourself when CI is green — never ask.

Read first

- docs/plans/recruitment/APPLICATION-FIX-PLAN.md:
  - §5, the owner's questions. ALL are answered now, Q-AM23, Q-AM24 and Q-AM25 included.
  - The END of §7, the progress log. Every entry dated 2026-11-15 from "1b-5 step 4, first merge"
    onward is the last session's.
- Memory: application-fix-plan-position.md (its last entry is the current state),
  application-documents-link-position.md, scanner-upgrade-position.md,
  paper-application-decides-what-is-asked.md.

State

- Main was 36c0e62 when this was written, and staging was serving exactly that commit
  (pnpm verify:live staging). Nothing is uncommitted, and no application PR is open.
- Nothing from 2026-11-15 is in production. The open release candidate is PR #2450, cut at 93084c7,
  which is BEFORE the last three application merges (#2452, #2459, #2461).
- Worktree ../FG-wizard2 is on a merged branch (claude/application-documents-scanner). Start each
  piece on a new branch from origin/main there.
- No application migration was added. The newest on main is 0618; check origin/main for the next free
  number before taking one.

Built and merged last session (11 PRs)

- The old application form is gone from the server too (1b-5 is closed).
  - 316 server tests in 29 files moved onto the link a driver is actually sent (#2438, #2440, #2443,
    #2446). One shared fixture: apps/api/src/testing/partOneRow.ts (PART_ONE_ROW, PART_ONE_ANSWERED,
    CURRENT_LINK_EMPLOYER, CURRENT_LINK_APPLICATION).
  - A link from before Part 1 is refused on every request, in resolveInvitation (#2448).
    applicationLegacyFilingIssues and its text are removed from server, shared and web.
  - Clean-ups (#2449): 15 unused strings, the unused partTwoLink stub, cdlPhotoPending in fixtures.
- The owner's rulings, verbatim: "Q-AM23 - as recommended. Q-AM24 - This is overkill and we dont need
  it. Q-AM25 - as recommended. Proceed as recommended and proposed."
  - Q-AM23 (#2452): the email is optional, the phone stays required. One line of the signed
    application's contract. applicationEquipmentContract.ts was split out of applicationContract.ts
    to stay under the 500-line budget.
  - Carrier Yes/No questions move on at a tap (#2459). AppSegmentedControl has a pointer-only `pick`
    event; QuestionField passes it to the walk. The full walk is 68 taps (was 71), 38 screens, 112
    characters.
  - "Before you send" prints the phone as (312) 555-0142 (#2459), in the office's drawer too.
  - Q-AM25 (#2461): on a phone, "Take photo" beside any paper in "Your documents" opens the in-page
    scanner and sends the photo cropped to the outline. The documents-only link gets it too.
  - Q-AM24: CLOSED, nothing built. A permit holder picks A, B or C as today.

Decided and NOT built (each has its reason in plan §7)

- The Spanish walk: the page is English only by the owner's ruling of 11/12 and 11/13.
- Errors on blur: recommended unbuilt; the owner has not objected, and may still overrule.
- The office's sends on a pre-Part 1 invitation (staging only): build nothing; "Send the link again"
  is the remedy. If a live one ever appears in production, the fix is one migration revoking
  invitations with no Part 1 row.
- Photo straightening and evening: the scanner programme's Phase 6, not this plan's.

Next, in order

1. The owner's walk on a real phone, on staging. Nothing else is left to build until it is done.
   It is the proof the whole batch has been waiting for, and the only source of real minutes
   (application_screen_events; production so far: first visit median 11.0 minutes over 3 applicants,
   history form 20.5 over 2 — too few to change the 10 / 30 / 5 the welcome screen prints).
   Ask the owner to include, because none of it has been on a real phone:
   - "About you": leave Email blank and continue; then type a bad one.
   - A carrier Yes/No question ("Can you legally work in the USA?"): one tap should move on.
   - "Your documents": "Take photo" on a TWIC card (card outline) and on a training certificate
     (page outline). The scanner has only been run against a fake camera in a test browser.
   - "Before you send": the phone reads (312) 555-0142.
2. Build whatever the walk finds. Likely candidates: an outline shape that is wrong for a paper (one
   word in liveFrame.LIVE_SLOTS; the shapes are a reading, not a measurement), wording, a tap target.
3. The release. PR #2450 predates #2452, #2459 and #2461, so the candidate must be re-cut to include
   them before the owner approves. Read release-practice-position.md first; production moves only
   through release.yml, on the owner's go.

Rules that are easy to break

- Never add docs_token_hash to resolveInvitation. The documents link has its own resolver.
- A column and its first reader ship in two merges; a new table ships with its writer.
- A server test fixture that stands for "the link a driver is sent" seeds PART_ONE_ROW (or
  PART_ONE_ANSWERED to file). An invitation with no application_intakes row is now a dead link.
- A fixture row with a column MISSING gives undefined, which no real row can. Keep rows full-shaped.
- An office component in apps/web/src/features/apply must be listed in templateLiterals.test.ts's
  OFFICE.
- ApplyPage.vue is 467 lines and LiveScanner.vue is 451; the budget is 500 and warns at 450.
- fullWalk.spec.ts pins 38 screens / 68 taps / 112 characters. Change a number only with the form.
- A paper added to APPLICATION_CAPTURE_REQUESTED needs an outline in liveFrame.LIVE_SLOTS, or
  liveFrame.test.ts fails.

Traps found last session

- This machine's `git grep -E` does not support \b: a pattern using it matches nothing, silently.
  Use -w. A dead-code search that used \b reported 115 unused strings where the real number was 15.
- `key: "<uuid>"` written inline in a fixture trips the secret scan (gitleaks, generic-api-key).
  Name the constant.
- A comment can push a file over the 500-line budget. `pnpm ci:local --job gates` runs all 45 gates
  in under two minutes; run it before pushing.
- A complete shared fixture un-fails tests that relied on an incomplete one. Give each the input its
  title describes, and prove it with a mutant.
- An assertion that something IS present can pass because another part of the screen prints it too.
  The mutant shows it; add the absence check.
- @vue/test-utils cannot set a click's `detail`. Dispatch a real MouseEvent.
- `gh pr checks --watch` started right after a push can exit at once with "no checks reported".
  Wait about 30 seconds first.
- After merging main: pnpm install --frozen-lockfile && pnpm --filter @silvicom/shared build:rn.
- The post-commit hook runs graphify for about a minute; wait before the next git write there.
- Failing locally and not from this work: the three assistantDock browser specs, liveMap.spec.ts,
  and several web unit tests that time out at 5 s under load (pageLoadFailureRetry,
  LiveMapWorkspace, the dashboard's). Two API tests flake under the full local run and pass alone
  (publicApplicationLimit, outcomeFeed.sweep). All pass in CI.
- chat/ChatConversationStage.test.ts "puts every line under its day, with Today…" fails in CI just
  after 00:00 UTC. It is not the application's; re-run the job.
- Build before e2e:apply, with VITE_SUPABASE_URL=https://example.supabase.co
  VITE_SUPABASE_ANON_KEY=ci-test-anon-key.
- Read-only production counts work through supabase db query --linked "<sql>". Aggregates only.
