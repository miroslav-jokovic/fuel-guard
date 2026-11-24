# Handoff: small-screens redesign, after the release (written 2026-11-16)

## What this is

The owner audited Silvicom 360 on phone and mid-width screens on 2026-11-14 and approved a redesign.
Phases A, B and C are built and in production. The audits' leftovers are built too. The owner looked
at production on 2026-11-16 and said it "looks ok". What is left is a short list of owner checks,
one ruling to confirm on staging, and three things deliberately not built.

## Read first

- `docs/plans/design-system/SMALL-SCREENS-PLAN.md` on main: audit (M1 to M12), decisions D-SM1 to
  D-SM12, questions Q-SM1 to Q-SM5 (all answered), and the progress log through 2026-11-16.
- `docs/plans/product-readiness/F21-ask-ai/PLAN.md`, the last log entry (2026-11-16): the Ask AI
  launcher ruling.
- `docs/DESIGN-SYSTEM-CONTRACT.md` §5.2, §5.5, §6 (drawer footers changed), §9.
- Memory: `browser-pass-local-build-over-staging-api`, `staging-test-members`,
  `fresh-worktree-setup-steps`, `pr-flow-and-no-assumptions`.
- Work state list `small-screens-leftovers` (claude-mem) has the same open items.

## Where things are (checked 2026-11-16)

main is at `36c0e62` or later. production is at `a7aaba4`. Release PR #2450 is open.

| PR | What | Staging | Production |
|---|---|---|---|
| #2376, #2377, #2382, #2383, #2405, #2410, #2420, #2428 | Phases A, B, C and the audit fixes | yes | yes |
| #2434 | Fuel alerts says "Could not load … Retry" after one round of retries (7 s, was 14 s); it no longer lists alerts without the detection start date when only that read fails. Same rule on the driver and truck Anomalies panels (`useDetectionEpoch`, `epochGated`). | yes | yes |
| #2437 | `/chat` without the chat module: the notice sits on the normal page background in the page gutter. | yes | yes |
| #2442 | Drawer and dialog footers: `SlideOver` and `BaseModal` lay out their own footer (`DIALOG_FOOTER_CLASS`, `packages/ui/src/components/dialogFooter.ts`). 61 hand-written wrappers removed across 66 files; eight footers with their own layout take `w-full`. | yes | **no** |
| #2455 | The Ask AI button (the orb) is drawn on the dashboard route only (`meta.assistantLauncher`). | yes | **no** |
| #2457 | Test only: the chat "Today" divider test held to a fixed clock (it failed in the first nine minutes of every day). | yes | **no** |
| #2444 | Plan log only. | — | — |

## Owner rulings

- 2026-11-15: Q-SM1 (a), zero rows on Operations stay as quiet one-line rows. Q-SM5 (a), "Needs
  action" lists alarm rows only.
- 2026-11-16: Q-SM5 confirmed again ("as recommended"): No GPS, driver files not started, drivers
  without a truck, and truck papers with no date are not added.
- 2026-11-16, Ask AI launcher, in the owner's words: "should maybe be displayed only on Main pages
  like Operations, Fuel Overview an Live maps". Built as the three dashboard tabs (Operations, Fleet
  overview, Dispatch/live map). Two things are my reading, not the owner's words:
  - "Fuel Overview" was read as the Fleet overview tab. No page has that name.
  - The dock is not tied to the orb: ⌘J / Ctrl J opens it on any page, and an open dock stays open
    across a navigation, so an answer that opens a page still opens it behind the dock.

## What is left

1. **Ask the owner to confirm the Ask AI change on staging before it releases.** They said "maybe".
   The thing to point out: on a phone, away from the dashboard, the only way in is Ask AI in the
   sidebar, because a phone has no ⌘J.
2. **#2442, #2455 and #2457 need a release.** They are in or behind release PR #2450. Releases go on
   the owner's go only (memory `release-on-owner-go`, `release-practice-position`).
3. **After #2442 is in production, look at what staging could not show:** the chat dialogs with two
   buttons (new conversation, new team, new channel, add people), the conversation viewer in chat
   compliance, and the drawers that open from a row: app login, EFS import, lead, PSP order. Staging
   has no chat module and lacks the rows.
4. **Only the owner can check:** the shop on a real tablet in the bay; Fuel cards, Loads, Applicants
   and Fuel log › Declines on a phone with real rows (in production now; I saw fixture rows only).
5. **Not built, on purpose. Build only if the owner asks:**
   - The header sentence above the Operations strip ("6 things need a person, 28 checks clear"); the
     "Needs action" card already says it.
   - The contract's general tile-grid rule. Only Idling's four tiles were fixed; the rule stays
     until a second page breaks a figure.
   - A stubbed "every read empty" browser pass. A blank answer has a different shape per endpoint.
6. **Checked, not a gap:** the phase table lists "Transactions", but there is no such page;
   `/transactions` redirects to the Fuel log, and the Declines tab took its place in A3.

## How I worked, and what to keep doing

- One branch per piece, from `origin/main`, in the worktree `~/Projects/FG-responsive-c2` (detached
  on `origin/main`, clean). Never work in `~/Projects/FuelGuard`.
- After main moves: `pnpm install --frozen-lockfile` and `pnpm --filter @silvicom/shared build:rn`.
  `pnpm ci:local` refuses to run otherwise.
- Do not copy `apps/web/.env` into the worktree. For tests pass
  `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key CI=true`.
- Every piece: tests, mutations to prove they can fail, `pnpm ci:local`, a browser pass, then the PR.
- Merge when CI is green: `gh pr merge N --merge --match-head-commit <full sha>`, then
  `gh pr view N --json state`.

## Browser-pass tools

In the previous session's scratchpad, which may be cleared:
`/private/tmp/claude-501/-Users-miroslavjokovic-Projects-FuelGuard/40a434a5-0a85-453c-96c6-2c3803388359/scratchpad/`

- `shots.mjs`: logs in to staging and screenshots routes at given widths. Environment options:
  `LOCAL_DIST`, `FIXTURES`, `LATE`, `TOUCH`, `DARK`, `EVAL`, `CLICK`, `SETTLE`.
- `footers.mjs` (new): opens drawers from page-level buttons and measures the footer (right edge,
  gap, nothing outside). It aborts every non-GET API call, so nothing can be written.
- `fail.mjs` (every data read answers 500), `fixtures.mjs`, `drawers.mjs`, `admin.mjs`, `crop.mjs`.
- `rw/`: a directory already linked to Railway staging (`railway link` done there).

If the folder is gone, the recipe is in memory `browser-pass-local-build-over-staging-api`.

## Traps I hit this session

- The machine runs at load average 40 to 54. `pnpm ci:local` then fails 2 to 7 unrelated test files
  on 5-second timeouts. Rerun the failed files alone with `--testTimeout 120000 --maxWorkers 2`;
  GitHub CI is the authority.
- `pnpm ci:local` rebuilds `apps/web/dist` with placeholder variables. Rebuild with staging's two
  public variables before a browser pass, or the login times out.
- A footer slot can be written `<template v-if="…" #footer>`. A search for `<template #footer>`
  misses those; eight drawers use the form.
- A new drawer or dialog passes its footer buttons bare. Do not wrap them in a `flex … justify-end`
  div. A footer that is not a plain row of buttons passes one element with `w-full`.
- A page test with an entitled chat page has no single root element (dialogs sit beside it); select
  the frame, do not use `wrapper.element`.
- `e2e-apply/assistantDock.spec.ts` uses Settings for the shortcut path and the dashboard for the
  orb path. A new spec that needs the orb must open the dashboard.

## Cleanup owed

- The worktree `~/Projects/FG-responsive-c2` can be removed once item 3 is done, or reused.
- This file is untracked in `~/Projects/FuelGuard`, like the other handoffs there.
