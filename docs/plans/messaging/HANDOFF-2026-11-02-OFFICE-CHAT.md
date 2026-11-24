# Office chat — handoff 2026-11-02 (evening)

Owner's standing instruction (2026-11-02): **"build the functionality that is left in the plan, as
proposed and recommended."** Q-CHAT21 was ruled (c) by that instruction. Follow the design rules: tokens and
shared components only, no inline styles, every gate green, and tests that fail when the code is broken.
Prove the tests by mutation: break the code, run the tests, `cp` the original bytes back, confirm with `cmp`.
Open a PR, merge when CI is green (`rtk proxy gh pr merge <n> --merge`), and ask the owner only where the
plan says the owner must act.

Plans: `docs/plans/messaging/OFFICE-CHAT-PLAN.md` (§9.4 CH11, §9.5 CH12, the progress log at the end) and
`CHAT-REDESIGN-PLAN.md` (Q-CHATUI6, Q-CHATUI7).

## Merged today (all on staging, waiting for the next release)

| PR | What | Migration |
|---|---|---|
| #1906 | CH7 files | 0540 |
| #1911 | Reactions in Activity | 0541 |
| #1913 / #1916 | CH8 search (database / API + web) | 0542 |
| #1917 / #1924 / #1927 | CH11 "Chat about this": database / API + chat header / load, driver and truck pages | 0543 |
| #1920 / #1926 | Compliance console and export carry files (§9.3's open item, closed) | 0544 |
| #1928 / #1931 | Q-CHAT21 (c): card-fraud incidents and roadside inspections (D-CHAT35 DataQs via the inspection, D-CHAT36 card last four only) | 0546 |
| #1930 | A search result opens at the message it found (`&line=`, `useChatFocusWalk`) | — |
| #1932 | Q-CHATUI6 (a), database: `chat_line_links` | 0547 |
| #1934 | Compliance search on the index (`message_versions` indexed, `chat_compliance_like` dropped) | 0548 |

## In flight

1. **#1937 — CH12 AI catch-up, database (0549)**, branch `claude/chat-ai-catchup-db`, checkout
   `~/Projects/FuelGuard-chat-rt`. CI was running when the session stopped.
   - **Before merging:** confirm CI is green and that main's highest migration is still 0548 (`git fetch && git ls-tree --name-only -r origin/main supabase/migrations | tail -2`); renumber if not.
   - **Contents:** `chat_ai` module key, `ai_catchup` ledger action, and three functions:
     - `chat_catchup_lines`: unread lines only, the newest 200, marks nothing read;
     - `chat_catchup_left`: 20 per person in any 24 hours;
     - `chat_catchup_record`: CH017 at the limit, writes the ledger row, adds the tokens to `org_usage_month`.
   - **Decisions:** D-CHAT37 (the switch is a module, turned on per carrier in the platform console) and D-CHAT38 ("already read" means "may read").
2. **Q-CHATUI6 (a), the API and web half**: branch `claude/chat-entity-links-web`, checkout `~/Projects/FuelGuard-chat-ch6c`. Local WIP commit da3a741, **not pushed**.
   - **Built:** `packages/shared/src/chatLinksContract.ts` (`chatLinkParts`), and `POST /api/chat/links` in `routes/chatSearch.ts` with `chatLinks.ts`.
   - **Web:** `useChatLineLinks.ts` (`provideChatLineLinks` is called by `ChatPage`; `useChatLineLinksHere` is used by `ChatMessageList`). `ChatBody` takes `links` and renders them through `chatAboutRoute`; `ChatMessageRow` passes them on.
   - **Tests passing:** API 11, web 7 new, `ChatPage` 24.
   - **Left to do:**
     - mutation pass;
     - gates (`lint`, `lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:ui-adoption`, `lint:boundaries`, plus web and API typecheck);
     - a progress-log entry in the plan;
     - merge main in (0547 and 0548 are already on main);
     - push, then open the PR.

## Still to build

1. **CH12, API and web, after #1937 is on staging.**
   - **Route:** `POST /api/chat/:id/catchup`, gated by `requireModule("messages")` and `requireModule("chat_ai")`.
   - **Flow:** call `chat_catchup_left`; if it's 0, return 429. Otherwise read `chat_catchup_lines`; if there are none, answer "You're up to date". Otherwise call the model, then `chat_catchup_record` with the sha256 of the summary.
   - **Model:** env `CHAT_CATCHUP_MODEL`, default `claude-haiku-5-5`, through `apps/api/src/lib/anthropic.ts`. With no key configured, return 503.
   - **Shared:** add `chat_ai` to `MODULE_KEYS` and its label in `packages/shared/src/entitlements.ts`. The platform console lists `MODULE_KEYS`.
   - **Web:** a "Catch me up" item in the conversation's and channel's ⋮ menu, shown only when the module is on. A dialog shows the summary, notes it was written by AI from N unread messages, and shows the remaining count.
   - **Cap:** a test must hold the 20/day limit equal between the SQL and the shared contract.
2. **CH9 (presence, typing) and CH10 (Web Push) are blocked on the owner:** production's Realtime connection limits and VAPID keys. Ask; don't build around them.

## Traps met today

- **Migration-number races with the hiring and ads sessions.** Re-check main right before every merge. A lower number must not land after a higher one, so merge in number order.
- **Branch switches with untracked files.** `git stash` doesn't save untracked files, so a switch carries them along: 0549 leaked into #1934 this way. Use a temporary `git worktree add` instead (memory: `untracked-files-follow-a-branch-switch`).
- **Full `pnpm ci:local` was stopped by the system for low memory.** Run the gates individually and let GitHub CI run the full set.
- **After merging main, run `pnpm install --frozen-lockfile --prefer-offline`**, because new workspace packages appear (`@silvicom/ads-golden`). Then `pnpm --filter @silvicom/shared run build:rn`; the matrices read `packages/shared/dist`.
- **Every branch conflicts on the plan's progress log.** The resolver keeps main's entries, then this branch's. The schema snapshot: take main's copy, then run `node scripts/gen-schema-snapshot.mjs`.
- **The ledger stamps its own time,** so a 24-hour window can't be tested with old-dated rows.
- **`lint:comment-claims` needs the full path** of a test file named in a comment.
- **The feature boundaries gate's `WEB_ALLOW` stays empty.** Combine features in a page through slots instead (the fraud drawer is the example).
- **Mock server (port 8093) and preview server (port 4395):** stopped. Test files are under `~/Projects/FuelGuard/.playwright-mcp`.
