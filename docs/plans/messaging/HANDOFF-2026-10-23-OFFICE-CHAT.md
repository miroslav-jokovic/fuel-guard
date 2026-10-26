# Handoff — office chat, release 1 (2026-10-23)

Plan: `docs/plans/messaging/OFFICE-CHAT-PLAN.md`. All 13 questions are ruled (§10). Decisions are
D-CHAT1–16 and the work queue is §9. Read §5 (audit), §7 (practices) and §9 before writing code.

## Where it stands

| Item | PR | State |
|---|---|---|
| Plan | #1733 | MERGED |
| CH1a — 0511 schema (thread `kind`, `seq`/`rev`, `message_versions`, hash-chained `chat_ledger`, client write policies dropped) + 0512 functions (`chat_inbox`, `chat_history`, `chat_sync`, `chat_send`, …, `chat_ledger_verify`, `chat_people`) | #1734 | MERGED `112bff5`; **on staging (schema 0512)** |
| CH1b — `/api/chat` (one 0512 function per route, `OFFICE_ROLES`, `chat_message` budget 3,000/day) | #1735 | MERGED `3e9e3c1` |
| CH2 — `/chat` page, surface `chat` (STAFF), sidebar badge, `useNavCounts`, `surfaceLookups.ts`, `requireSurface("chat")` | #1736 | OPEN — CI re-run (bundle job hung on "Install Chromium"); merge when green |
| CH3a — 0513 Realtime Broadcast signals (no content) + `realtime.messages` join policy (`auth_chat_topic`) | #1737 | OPEN — CI running; merge when green (independent of #1736) |
| CH3b — web transport | — | NOT STARTED |
| CHA1 — nightly ledger verifier | — | NOT STARTED |

Nothing is in production. Production gets it only when the owner approves a release.

## Next, in order

1. **Merge #1736 and #1737 when green.** Before merging #1737, re-check migration numbers: open PR #1699
   holds 0510, #1698 holds 0509. If a parallel chat took 0513, renumber.
2. **Owner action (Supabase dashboard), staging then production:** Realtime Settings → turn off
   "Allow public access" (0513 header).
3. **CH3b — `apps/web/src/features/chat/transport.ts`** (D-CHAT10: the only file that touches Realtime).
   - Subscribe to `chat:user:<me>` and to `chat:conv:<open>`, each with `{ config: { private: true } }`,
     event `chat`. Call `supabase.realtime.setAuth()` first, and again on token refresh.
   - On a signal: invalidate the inbox. For the open conversation, call
     `/api/chat/:id/sync?since_rev=<held rev>`, merge into the cached page, and refetch the page on a seq gap.
   - Show "Reconnecting…" whenever a channel is not `SUBSCRIBED`.
   - While subscribed, stretch the polls to 60 s; keep 30 s/10 s when not.
   - **Load test on staging:** 300 simulated clients and one 300-member channel. Record p95 delivery,
     the Realtime message count and DB CPU in plan §11.
4. **CHA1 — nightly `chat-ledger-verify`.**
   - A scheduler in the `general` lane, registered in `apps/api/src/schedulers.ts`. Read
     `docs/WORKER-DEPLOYMENT.md`; the scheduler must run in exactly ONE process.
   - Per org, call `chat_ledger_verify(org)`. On `problem != null`, `notify()` with category `system`
     and severity `critical` (a new category would need a CHECK migration, `notificationCategoryCheck.test.ts`),
     dedupe key `chat_ledger:<org>:<YYYY-MM-DD>`, plus `console.error`.
   - Recipients: admins. This is a LABELLED interim; CHA2's `chat.compliance` holders replace it.
5. **Release 2:** CHA2 (compliance console), CHA3 (export, holds, retention), CH5 (teams and channels).
   ⚠ `chat.compliance` must have a SECTION gate (e.g. `section("settings")`, `startsOnFor: []`) to
   appear on the Permissions page (`isEditableSurface`). Q-CHAT2 was ruled that way.

## Traps paid for this session

- **`docs/plans/<new dir>` and `apps/web/src/features/<new dir>` need an area** in `AREAS`
  (`scripts/release-train.mjs`), or `gates` fails. `lint:release-train` is not in `pnpm lint`;
  run every gate from `ci.yml`.
- **CI's bundle job hangs on "Install Chromium"** (twice on 10-23, 20+ min). `gh run cancel <id>`, wait
  until the run shows completed, then `gh run rerun <id> --failed`.
- **Every branch switch in a worktree runs the graphify hook** (minutes). Use a separate worktree per
  branch, or run checkouts and rebases in the background.
- `lint:filesize`: `AppShell.vue`, `surfaceCatalogue.ts` and `app.ts` sit right under 500 lines.
  Split them; don't trim them.
- `navEquivalence.test.ts`: a new sidebar entry moves its snapshots. Read the diff line by line, then
  add a dated paragraph to the file's header (done for Chat).
- The PGlite matrices can't see `realtime`. `office-chat-realtime.test.mjs` installs a shim, so copy
  that pattern for CH9 presence.
- Browser pass: `VITE_DEV_BYPASS=true node scripts/preview-local.mjs --port N` in `apps/web`. Read the
  port from the END of the log, and kill old servers (`lsof -ti tcp:N | xargs kill`). Script:
  `chat-pass.mjs` (session scratchpad, not kept). The dev user id is `dev-admin-001`.
- A watcher that marks a conversation read must be `immediate`: a conversation opened from the cache
  already has its data.

## Worktrees

- `~/Projects/FuelGuard-office-chat`: branch `claude/office-chat-ch2` (#1736).
- `~/Projects/FuelGuard-chat-rt`: branch `claude/office-chat-ch3a` (#1737).
- `~/Projects/FuelGuard-chat-plan`: the merged plan branch, removable.
