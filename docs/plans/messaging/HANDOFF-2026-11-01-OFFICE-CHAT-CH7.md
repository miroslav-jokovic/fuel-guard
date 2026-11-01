# Handoff — office chat, 2026-11-01: CH7 (files) half-built, then the rest of the plan

Paste the block at the bottom into a fresh chat. Everything above it is the record.

## What shipped today (all merged to main)

| PR | What | Decisions |
|---|---|---|
| #1881 | New conversation's tick boxes aligned (PeoplePicker rows are one `role="checkbox"` AppButton; picked people as chips) | — |
| #1888 | Modern look: person colours (`--identity-1..8` tokens, `AppAvatar :identity`), composer card with emoji + @, quiet New button with described menu items (`KebabMenuItem`), `AppAvatarStack` in headers, `ChatEmptyStage`, dialogs open on their search (`BaseModal :initial-focus`) | D-CHATUI22–25 (CHAT-REDESIGN-PLAN) |
| #1897 | CH6c-2: reactions (six), pin + Pinned list, save + Saved stage (`?saved=1`); Activity contract accepts `reaction` | `BaseModal` gained `closed` (fires after Headless UI restores focus) |
| #1900 | CH6d: desktop alerts while the tab is open, per Q-CHAT18 (a); per-browser choice `fg.chat.desktop-alerts`; control at the rail's foot | — |

## In progress: CH7 files — branch `claude/chat-ch7-files`, worktree `~/Projects/FuelGuard-chat-design`

Pushed as a WIP commit, **no PR yet**. Web and API typecheck clean at the commit.

**Done and tested**
- Migration **0539_office_chat_files.sql** (D-CHAT27–30): private `chat-files` bucket (25 MB), `chat_attachments` (append-only, ledgered `file_attached` with sha256), a message may be only files (deferred constraint trigger, CH014), `chat_send_files` (line + files in one transaction, checks each object is in storage, CH015), `chat_file_can_upload`, `chat_file_for`, `chat_files`, `chat_line_files`; the four readers return `attachments`. Matrix `supabase/tests/office-chat-files.test.mjs` **40/40**; three mutants each caught; all 8 office-chat matrices green. `table-modules.json` entry, `schema.generated.sql` regenerated, `RETENTION_FORBIDDEN` + `reconcileChatFileOrphans` (nightly sweep) registered.
- Shared: `chatFilesContract.ts` (`CHAT_FILE_TYPES` allow-list, 25 MB, 10 per line, declaration/ref/link/list schemas), `chatMessageSchema.attachments`, send + reply requests take `files` (words OR files), `chatPreview` says "Sent a file". Tests: shared 5, API parity `chatFileCheck.test.ts` 2.
- API: `chatFiles.ts` (sign upload after `chat_file_can_upload`; at send, read every stored file back and check size, sha256 and magic bytes before `chat_send_files`; 5-min links, documents as downloads), `routes/chatFiles.ts` (`POST/GET /:id/files`, `GET /files/:fileId`, gates per route, mounted ahead of the conversation router), both send routes take files, CH014/CH015 mapped, `filesForBell`. `routes/chatFiles.test.ts` 16 pass; messaging suite 186 pass.
- Web: `FilePickButton` (components/ui), `useChatAttachments` (check, hash, sign, PUT, states, retry), `ChatComposerFiles` strip, composer paperclip + drop + paste + `uploadTo` prop, files threaded through all three stages, `ChatPage`, `ChatChannelStage` and `useChatSend` (`PendingLine.files`, retry resends them). `useChatFileLink`, `ChatAttachmentImage` (uses the new `AppButton size="media"`).

**Left for CH7, in order**
1. `ChatAttachmentFile.vue` (document card: icon, name, `chatFileSize`, Download → `fetchChatFileLink` → open) and `ChatAttachments.vue` (images in a wrapping row, then cards); render it in `ChatMessageRow` under the words (not on a removed line). `ChatPendingRow`: show "Sending N files…".
2. Header menu **Files** dialog (`ChatFilesDialog`, like `ChatPinnedDialog`: mounted on first open) over `GET /:id/files`, with a data hook in `useChatFileLink.ts` or its own.
3. Tests: `useChatAttachments` (refuses a kind / >25 MB / eleventh; uploads; failed + retry; clear), composer (paperclip only with `uploadTo`; Send held while uploading; files-only send emits `("", refs)`), row renders attachments, `AppButton` `media` size test, `useChatSend` sends `files`. Mutate to prove (cp the bytes back).
4. Mock API (`tools/chat-fixtures/mock-api.mjs`): `POST /:id/files`, a PUT target, send with `files`, `GET /files/:id`, `GET /:id/files`; browser pass light + dark (see "Local preview").
5. Gates (CI's `run:` lines — incl. `pnpm --filter ./apps/web lint:tokens`, `lint:ui-adoption`, `lint:light-dark`, `lint:ui-contrast`, `lint:codegen`, `lint:table-writers`, `node scripts/check-migration-ordering.mjs`), full suites with `CI=true`, `VITE_SUPABASE_*` placeholders for `pnpm build`.
6. **Re-check the migration number before merging**: open PRs #1892/#1896 claimed 0537/0538; main had 0537_ads_foundation. If 0539 is taken, rename the file and the strings in `chatFileCheck.test.ts`.
7. Plan entry (OFFICE-CHAT-PLAN progress log + D-CHAT27–30 in §9.2-style text; CHAT-REDESIGN-PLAN Q-CHATUI5 → answered by CH7), PR with the four template headings, merge when CI is green.
8. Known follow-up to record, not build now: compliance console + export (CHA2/CHA3b) do not yet show or include files — an export without them is incomplete; write it as an open item.

## After CH7 — the rest of the queue (OFFICE-CHAT-PLAN §9, CHAT-REDESIGN-PLAN §8)

| Item | Note |
|---|---|
| Activity reactions migration | `chat_activity` emits `reason='reaction'` with `reaction`/`reactor_*`. **Merge only after #1897 is RELEASED to production** (a release runs migrations before code). Web already renders it (`activityLine`). |
| CH8 search | `tsvector` + GIN, readable conversations only; header search (Q-CHATUI7) |
| CH9 presence / typing | Needs the owner to raise production Realtime limits first (plan §11 note) — ask before building |
| CH10 Web Push | Needs VAPID keys + service worker; owner action for keys |
| CH11 "Chat about this" on loads/drivers/trucks | Q-CHAT6 ruled (a) |
| CH12 AI catch-up | Off by default |
| Q-CHATUI6 entity links ("L-20481", "Truck 702") | Needs a server resolver; open question, recommendation (a) |

## Traps met today

- `tools/chat-fixtures/build-web.mjs` once hard-coded another worktree; it is now relative and honours `MOCK_PORT`.
- Run the mock on `MOCK_PORT=8093`; `vite preview` needs `VITE_SUPABASE_URL=http://localhost:8093 VITE_SUPABASE_ANON_KEY=x` in its env. `/api/messages` 404s in the console are the mock's gap, not a bug.
- Headless UI holds focus inside a dialog until after its leave transition and then restores it — focus a page element on `BaseModal @closed`, not `@close`.
- A `KebabMenu` item with two lines needs `size="row"` or it is clamped to `h-9`.
- `lint:ui-adoption`: rail headings stay uppercase eyebrows; exports nobody calls fail; error copy must say what failed.
- `rtk gh pr merge` can hang: use `rtk proxy gh pr merge <n> --merge`.
- jsdom here has no `localStorage` — install one in the test (see `useChatDesktopAlerts.test.ts`).

## Local preview

```
cd ~/Projects/FuelGuard-chat-design
MOCK_PORT=8093 node tools/chat-fixtures/mock-api.mjs &          # sample data
MOCK_PORT=8093 node tools/chat-fixtures/build-web.mjs           # builds apps/web/dist
cd apps/web && VITE_SUPABASE_URL=http://localhost:8093 VITE_SUPABASE_ANON_KEY=x npx vite preview --port 4395 --strictPort
# open http://localhost:4395/chat ; dark mode: document.documentElement.style.colorScheme='dark'
```

---

## Paste this into the new chat

> Continue the office chat work from `docs/plans/messaging/HANDOFF-2026-11-01-OFFICE-CHAT-CH7.md` (on
> branch `claude/chat-ch7-files`, worktree `~/Projects/FuelGuard-chat-design`). Read that file, then
> `docs/plans/messaging/OFFICE-CHAT-PLAN.md` §9 and `CHAT-REDESIGN-PLAN.md` §5/§8. Finish CH7 (files) from
> "Left for CH7" step 1, following the design rules: tokens and shared components only, no inline styles,
> every gate in ci.yml green, tests that fail when the code is broken. Open the PR, merge when CI is green,
> then continue down "After CH7", asking me only where the handoff says the owner must act.
