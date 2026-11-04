# Handoff · 2026-11-04 · The leads screen — from read-only to working it (E4b3, E4b4)

> **Status, end of 2026-11-04:** §3 steps 1–3 are done: E4b3 is #2026 (`3f30e30`), E4b4 is #2028 (`19cd96f`), and this
> file landed in the docs PR. The next step is §3 step 4. Q-AD30 and Q-AD31 in the plan's §9 now hold §2's two questions.

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-04-LEADS-E4.md`, whose E4a and first two
slices of E4b are done and merged. This is still the SECOND track beside the ads agent's own
(`HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md`). **That chat owns `modules/ads/`, the monitor and reconcile.** Coordinate
through the progress log. The earlier handoffs' traps and process, and the 11/01 owner rulings, **still hold**.

⚠ `HANDOFF-2026-11-04-LEADS-E4.md` is NOT on main: it is on `claude/leads-handoff-e4` (#2014, open). Read it from
`git show origin/claude/leads-handoff-e4:docs/plans/recruitment/HANDOFF-2026-11-04-LEADS-E4.md`. This file is untracked
in the `FuelGuard-ads-safety` worktree. Both land in the docs PR (§3, step 3).

## 0. Read first, in this order

1. `CLAUDE.md` (root) and `apps/web/CLAUDE.md`: hard rules, the release train, "No workarounds", the two-merge rule.
2. This file, then the E4 handoff's §2 (rulings and open questions) and §4 (traps), and the 11/03 handoff's §4.
3. `docs/DESIGN-SYSTEM-CONTRACT.md` before any screen change: §3.5 (drawer sections), §4.3 (badges), §1.4 (dates).
4. The code E4b3 sits on:
   - `apps/web/src/features/recruitment/LeadDrawer.vue`, `useLeads.ts`; `apps/web/src/pages/RecruitmentLeadsPage.vue`.
   - `apps/api/src/modules/recruiting/routes/leads.ts`, `leads/leadQueue.ts` (`convertLead`), `leads/doNotContact.ts`.
   - `packages/shared/src/recruiting/leads/leadContract.ts`, `leadDisplay.ts` (the screen's words).
   - The patterns to copy: `useApplicantPurge.ts`, `PurgeApplicantDrawer.vue`, `composables/useStepUpRetry.ts`.

## 1. Done in this track (all merged to main)

| Step | PR | Merge | What |
|---|---|---|---|
| E4a, read contacts | #2015 | `4decc9b` | `GET /recruitment/leads/:id/contacts`, recruitment view, newest first, bounded at 200. Purged leads included, their notes withheld |
| E4b1, read one lead | #2019 | `f126b77` | `GET /recruitment/leads/:id`, any status. `LeadQueueRow`, `LeadQueuePage`, `LeadRecord`, `LeadContactRecord` in shared. `also` comes from `recruiting_lead_matches` |
| E4b2, the screen | #2020 | `4306819` | Leads tab, `recruitment.leads` surface, queue, drawer, `deepLinkFor` for `lead_new` / `lead_uncontacted`. **It only reads.** Phase E's line corrected to `features/recruitment/` |

### 1a. Position at handoff
- **Main:** `43ef245`, green. CI passed on `4306819` too, so the screen is proven on the merged tree.
- **Newest migration on main: `0565_drug_alcohol_policy.sql`.** Other chats merge all day, so confirm by NAME.
- **Scorecard (`pnpm ads:readiness`, corrected 2026-11-04):** Orchestrator L3, Budget guard L3, Renderer L2, Copywriter
  L2, Art director L2, Checker L2, Monitor L1, Lead intake L1, Security L1, Publisher / Outcome feed / Analyst L0.
- **Nobody has seen the screen on staging.** The browser pass was an admin on stubbed data, not a recruiter on real rows.
- **`namedGrantGates.test.ts` timed out once** on #2019's CI at 5000 ms. It passes 13/13 locally and passed on the
  retry, and #2019 did not touch it. One occurrence, not fixed. If it recurs, look into it; do not keep re-running.
- Worktree `../FuelGuard-ads-safety` is this track's, so build there. `../FuelGuard-ads-d1` is the ads chat's: do not
  switch its branch. Remove `FuelGuard-ads-safety` only when this track ends.

## 2. Rulings and open questions

- **Ruled by the owner, 2026-11-04:** a purged lead's contact notes stay WITHHELD until counsel rules. `readLeadContacts`
  serves `note: null, note_withheld: true`; no stored row changes. If counsel rules they stay readable, one condition
  goes. **Not yet in any plan doc:** record it, with the counsel question, in the docs PR.
- **Owner to decide (raised by E4b2, not ruled):** whether the queue sorts by match. `leadQueue.ts` calls that the
  screen's step, but a match sort cannot share a keyset with freshness, and sorting one loaded page would mislead. It
  ships newest first. Candidates: leave it; a server-side match order with its own cursor (needs a migration).
- **Left out of the screen on purpose, recorded here:** no search (the api has none, and searching a loaded page says
  "no match" for a person one page on); the opening's title is not shown (a row has only `opening_id`).
- **Known limit:** a queue row has no `purged_at`, so it says "No details on file" and "Not matched", true of a purged
  lead and of a form whose details all failed to read. The drawer has `purged_at` and is exact.
- **Unchanged from the E4 handoff §2:** `BACKFILL_STALE_HOURS`; lead retention (Q-LS6 / Q-RA8); the launch gate (**do not
  build the upload path until ruled**); Q-AD23 / Q-AD24; counsel's Q-RA6, Q-AD8 / G12, confirming the 2026-09-24 memo was
  ever SENT, and the consent checkbox staying unbuilt until (c) is ruled.

## 3. Next steps (one PR each, ≤ ~500 lines of code; split above that)

1. **E4b3 — working a lead: Contacted, Convert, Do not contact.** All three routes exist, so this should be web only.
   Buttons go in the drawer's `#footer` (SlideOver rule) and show only for `session.can("recruitment")`: a view-only
   role sees none. **On a purged lead, show none.** Feedback is a toast. Invalidate by the prefix
   `["recruitment", "leads"]`.
   - **Contacted** (`POST /leads/:id/contacts`): a small form for `leadContactSchema` (direction, method, outcome, note).
     **Disable the button in flight: a double press writes two append-only rows.** `409 lead_purged` in words.
   - **Convert** (`POST /leads/:id/convert`, `{ driver_id }`): `null` creates an applicant; an id from `lead.drivers`
     attaches to one already on the board, so offer that when a match exists. Show the api's sentence for 409
     `conversion_in_progress`, `already_converted`, `not_an_open_applicant` and 422 `name_required`. Also invalidate
     `["recruitment", "pipeline"]` and `["drivers"]`, and link to the new applicant.
   - **Do not contact** (`POST` to hold, `DELETE` to lift `/leads/:id/do-not-contact`): 422 `no_phone`. Lifting answers
     `stop_remains`: when true the person texted STOP and it still stands, so the toast must say the number stays held.
2. **E4b4 — Delete details and manual add.**
   - **Delete details** (`POST /leads/:id/purge`, `{ same_person }`): show by `canPurgeLead(session.role)`, derived, never
     a role list. A drawer that says what the act does, then `StepUpPrompt` through `useStepUpRetry`; refusals through
     `apiRefusal`. 409 `became_applicant` in words. Name `skipped_applicants` in the toast.
   - **Manual add** (`POST /leads`, `manualLeadSchema`): channel from `MANUAL_LEAD_CHANNELS`, a phone or an email required,
     opening from `GET /recruitment/openings`. It rings nobody, by design.
3. **The docs PR, merged last:** the progress-log entry for E4a, E4b1–4; the §2 ruling and open questions; this
   file and #2014's. On a conflict keep BOTH entries, theirs first. Close #2014 once its file is carried.
4. **Owner-made campaigns (E4 handoff §3 step 2).** Raise it with the ads chat first: reconcile must not report a
   campaign we never created as `external_change`, and that is their file.
5. **Only after the owner rules on the launch gate:** B2c with a human-uploaded creative.

Deferred on purpose, unchanged: CAPI/outcome feed, analyst narration, TikTok, X, Indeed, Tenstreet.

## 4. Browser pass (the recipe; every screen PR needs it on the three fixtures: fail / empty / staging)

The script was a throwaway outside the repo, so rebuild it. The login wall needs no sign-in:
1. From `apps/web`: `VITE_DEV_BYPASS=true VITE_SUPABASE_URL=https://example.supabase.co
   VITE_SUPABASE_ANON_KEY=ci-test-anon-key npx vite build --outDir <scratch>/dist --emptyOutDir` (blank values are refused).
2. A Node script loads `@playwright/test` through `createRequire(apps/web/package.json)`, and one `page.route("**/*")`
   serves `dist` for `http://fg.test` (falling back to `index.html`), stubs `/api/recruitment/leads*` per fixture and answers
   anything else with `{}`, logging it. No server needed.
3. Check 1440 and 375 wide, `scrollWidth > clientWidth`, console errors, and **look at the screenshots.** They moved
   Contacts up and corrected two labels the text output had not shown as wrong.

A write needs its POST stubbed and the request asserted. It runs as an admin only, so a view-only role's missing
buttons are proved in the vitest page test (the `session` mock in `RecruitmentTemplatesPage.test.ts`).
`crypto.randomUUID is not a function` is the harness (`fg.test` is not a secure context), not the app.

## 5. Traps hit in this track (add to the earlier lists)

- **`gh run rerun --failed` while GitHub still shows a failed job as in progress** does not rerun it: it carries the failure
  and re-queues only `build`. Compare the job's start time with the rerun's. Rerun after the run reads `completed`.
- **A failed job can sit "in progress" for minutes after its failing step ended.** Read its steps before calling it hung:
  `gh api repos/<repo>/actions/jobs/<id> --jq '.steps'`. The log needs `--allow-escape-sequences`.
- **`statusCheckRollup` can read stale.** Before merging on a green, read the run itself and match `headSha` to the PR head.
- **zsh:** `echo ======` fails (`=word` is a command lookup) and stops the script. `--include=*.vue` fails on no match. Quote both.
- **`git switch` here can run past 60 s** (the graph hook). Do not chain reads after it in a short-timeout call.
- **Web vitest needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in this worktree** (`example.supabase.co`,
  `ci-test-anon-key`, as `ci.yml`), or it dies with "supabaseUrl is required" on anything importing the session store.
- **`pnpm --filter @silvicom/web typecheck` does not typecheck `packages/shared`'s tests.** `pnpm ci:local --job typecheck` does.
- **`SlideOver` teleports out of the mounted tree.** Stub it in a page test. vue-query retries by default, so a test of a
  failed read needs a `QueryClient` with `retry: false`, or it reads the page before the error lands.
- **`useConfirm` over a `SlideOver` closes the drawer:** the dialog counts as a press outside it, and the lead id clears
  before the write goes out. A test that mocks `useConfirm` cannot see this. In a drawer, replace the body (contract §6.2).
- **`verifyStepUp` needs a Supabase session, which dev bypass does not have.** To test a step-up retry in the browser
  pass, seed `sb-example-auth-token` in `localStorage` with `addInitScript` and stub `/api/auth/step-up`.
- **`leads.test.ts` is at the size budget (475 lines).** New route tests go in `routes/leadRead.test.ts` or a sibling.
- **A tab added to `RecruitmentTabs` shifts anything clicking by index,** and the route-table snapshot updates with `-u`.

## 6. Owner track

Unchanged from the E4 handoff §5, **plus**: approval of the next release, which now carries E4a and the Leads tab; a look
at the Leads tab on staging as a recruiter; and whether the queue should sort by match.

## 7. First action in the new chat

1. Read §0.
2. Confirm main's HEAD and the newest migration **by name**; list open PRs and confirm none touches
   `modules/recruiting/leads/`, `routes/leads.ts`, `features/recruitment/LeadDrawer.vue`, `useLeads.ts` or
   `RecruitmentLeadsPage.vue`.
3. Run `pnpm ads:readiness`; it must match §1a (the ads chat may have moved a worker up, which is fine).
4. Work in `../FuelGuard-ads-safety` on a new branch from `origin/main`. Keep this file untracked until the docs PR.
5. Propose E4b3's shape in one short message, including whether it needs splitting, then build it.
