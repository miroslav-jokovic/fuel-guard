# Handoff — office chat redesign, the rest of the plan (2026-10-26)

Paste this into a fresh chat. It is the whole context the next session needs.

## Where things stand

- **Plan:** `docs/plans/messaging/CHAT-REDESIGN-PLAN.md` — decisions D-CHATUI1–15, work queue CR1–CR4,
  open questions Q-CHATUI1–4, research §2. Read it first; it is the decision log. The data-model plan
  is `OFFICE-CHAT-PLAN.md` (D-CHAT1–26, CH1–CH12); CH6b–d (mentions, Activity, reactions, pins, saved,
  mute, browser notifications) are planned there and land on CR1's rows.
- **CR1 is DONE and MERGED:** PR #1763, main `c41269a` (2026-10-26). `/chat` is a full-bleed workspace:
  one rail (Chats, each team's channels, Muted), message rows grouped by sender under day lines with a
  "New" line where unread started, a composer that grows, the thread as a side panel. Staging serves it
  within minutes of the merge; production with the next approved release. Owner's staging walk (seven
  steps in the PR body) is still owed.
- **Audit before/after:** 17/30 (REDESIGN). Log was 302 px of a 900 px window; now 703 px.
- **Remaining:** CR2, CR3, CR4 below, and the open questions. Nothing in them needs a migration.

## Files (all under `apps/web/src`)

- `pages/ChatPage.vue` — entitlement, URL (`?c=` conversation, `?ch=` channel, `&post=` thread; written
  alone, never a copy of the old query), layout rail | stage, the four dialogs, `useChatRailActions`.
- `features/chat/ChatRail.vue` (+ `.test.ts`) — the one list, search, New menu (KebabMenu), team kebab.
- `features/chat/ChatMessageList.vue` — `role="log"` scroller, day + New dividers, Show earlier;
  `ChatMessageRow.vue` (avatar/name/time once per run, hover+focus toolbar, inline edit);
  `ChatPendingRow.vue`; `chatGrouping.ts` (+ `.test.ts`, 7 tests, 4 mutants proven) — runs = same
  sender, same day, ≤ 5 min; a failed send ends a run; `firstUnreadSeqOf`.
- `features/chat/ChatComposer.vue` — grows to 8 lines, Send inside, Enter/Shift+Enter, IME-safe,
  `useBottomChrome` so the Ask AI orb rises above it; counter only in the last 10 % of `CHAT_BODY_MAX`.
- `features/chat/ChatStageHeader.vue`; `ChatConversationStage.vue` (+ `.test.ts`, 16).
- `features/chat/teams/ChatChannelStage.vue` (+ `.test.ts`, 10) — channel + thread panel (`xl:w-96`);
  `ChatChannelPane.vue`, `ChatRepliesPane.vue`, `useChatRailActions.ts` (join / new channel / add
  people / leave team / new team).
- Data layer untouched: `useChat.ts`, `teams/useChatTeams.ts`, `chatRealtime.ts`, `transport.ts`,
  `earlierPages.ts` (CH6a anchoring + `keepEarlierSharing`).
- Route: `router/routes/core.ts` `/chat` has `fullBleed: true` (the `routeTable.test` snapshot pins it).

## What to build next (in this order unless the owner says otherwise)

**CR2 — keyboard + Jump to latest** (web only).
- `/` focuses the rail search; Esc in the thread panel already closes it (keep); Esc in the stage marks
  the conversation read is NOT wanted (reading already moves on open).
- Up arrow from an EMPTY composer moves focus into the log (`ChatMessageList` exposes `scroller`);
  rows are `tabindex="-1"`, so give the log a roving focus: Up/Down move between rows, Enter opens a
  post's thread, E edits your own line. Slack's model (Q-CHATUI3 recommends Slack's for the log, J/K
  for the rail).
- "Jump to latest": when the scroller is more than ~100 px from the bottom and new lines arrive, a
  small pill at the bottom of the log ("N new messages ↓"); `useChatScroll` in `earlierPages.ts`
  already decides when to follow the bottom — extend it rather than adding a second scroll owner.
- Tests: extend `ChatConversationStage.test.ts` and `ChatRail.test.ts`; a browser pass (recipe below).

**CR4 — empty workspace** (web only; cheap, do with CR2 if small).
- The stage with nothing open on a workspace with no conversations and no teams: a first-run stage
  with the two acts ("New conversation", "New team" when `can_manage`) instead of "Pick a conversation
  or a channel…". A team's empty General: "Welcome to <team>" line from its maker (the description).

**CR3 — compact density** — only after Q-CHATUI2 is ruled (a person's setting in `chat_person_state`,
D-CHAT24's "a person's own state"; a migration, so two merges per `lint:migration-ordering`). Do not
start without the owner's ruling.

**Open questions to put to the owner** (recommendations are in the plan §8): Q-CHATUI1 own lines told
apart (rec. no), Q-CHATUI2 compact density when (rec. after CR1, on request), Q-CHATUI3 keyboard model
(rec. Slack's log + J/K rail), Q-CHATUI4 threads in direct conversations (rec. not now, D-CHAT19).

## How to work

- Worktree `~/Projects/FuelGuard-office-chat` (branch from `origin/main`, name `claude/office-chat-<item>`;
  every branch switch runs the graphify hook for minutes — run checkouts in the background). The main
  checkout `~/Projects/FuelGuard` sits on another branch; never switch it.
- Fast loop: `pnpm --filter @silvicom/web typecheck`, `pnpm --filter @silvicom/web exec vitest run
  src/features/chat src/pages/ChatPage.test.ts`. Gates before pushing: `lint:tokens` (web),
  `lint:ui-adoption`, `lint:filesize`, `lint:funcsize`, `lint:boundaries`, `lint:comment-claims`,
  `lint:date-format`, `lint:tests`, `lint:record-id`, AND plain `pnpm lint` (eslint — CI runs it too),
  then the full `pnpm --filter @silvicom/web test`.
- **Browser pass without a staging login** (worked 2026-10-26; scripts kept in `tools/chat-fixtures/`,
  untracked — commit them with CR2 if they stay useful):
  1. `node tools/chat-fixtures/mock-api.mjs` — fixtures on :8080 (6 conversations, 2 teams, 5 channels,
     a thread; `POST /__mode {"mode":"data"|"empty"|"fail"}` switches without a restart).
  2. `cd apps/web && node ../../tools/chat-fixtures/build-web.mjs` — builds `dist` with
     `VITE_DEV_BYPASS=true VITE_SUPABASE_URL=http://localhost:8080 VITE_API_URL=http://localhost:8080`
     (it reuses `preview-local.mjs`'s env loader; edit `webRoot` at the top if the worktree path differs).
  3. `pnpm --filter @silvicom/web exec vite preview --port 4392` and open `http://localhost:4392/chat`
     in the built-in browser; 1440×900 and 390×844, light and dark, data / empty / fail.
  The dev-bypass user is `dev-admin-001` ("Miki Jokovic" in the fixtures).
- PR: title = release-notes line for an office reader; body under the four headings of
  `.github/pull_request_template.md` via `--body-file`. Auto-merge is NOT allowed on this repository:
  turn on Auto-fix in the app, then `gh pr merge --merge` once a single `gh pr checks` read is green.

## Traps paid this round (so they are not paid again)

- `lint:comment-claims` refuses "pinned by `<file>`" unless a real test TITLE is quoted — write "`x.test.ts` holds the rules" or quote the title.
- `KebabMenu` teleports to `document.body`: in tests, `w.unmount()` BEFORE clearing `document.body.innerHTML`, or Vue throws `nextSibling of null` on the next render. Menu items are found with `document.body.querySelectorAll("button")`, not on the wrapper.
- `AppSearchField` emits after a `setTimeout` even at `debounce: 0` — `await new Promise(r => setTimeout(r, 1))`, not `flushPromises()`.
- A `vi.mock` factory must be synchronous in what it returns: an `async` helper that returns the query object makes `data.value` undefined.
- `routeTable.test` snapshots route meta: a meta change needs `vitest run src/router/routeTable.test.ts -u` and the diff checked (one line).
- Tailwind 4 important is the SUFFIX (`min-h-0!`); `lint:template-integrity` allows it on a call site, not inside a primitive.
- A hover-only toolbar must be faded (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`), never `hidden` — a `display:none` button cannot take focus, so the keyboard never reaches it.
- With the UAT banner showing, every full-bleed page scrolls by the banner's 28 px (AppShell, known and left): the composer's hint line sits just under the fold on staging; production has no banner.
- A green mutant means a bad test: dropping the day rule in `chatGrouping` survived until a midnight-inside-the-window case was added.
