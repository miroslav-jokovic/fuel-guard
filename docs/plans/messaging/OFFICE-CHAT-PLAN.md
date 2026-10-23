# Office chat — people in the office talking to each other inside Silvicom 360 (2026-10-23)

Opened 2026-10-23 at the owner's request: *"Internal chat between users in office … we are almost
switched to AWS so count on that."* The owner brought a proposal written by ChatGPT (Socket.IO or
SignalR, Redis, six new `chat_*` tables, S3 attachments, four phases) and asked for it to be compared
with this codebase and turned into a precise, reliable plan.

This is a decision log. Decisions are `D-CHAT*`, questions for the owner `Q-CHAT*`, work items `CH*`.
The progress log is at the END (append there, never into the tables).

## 1. What already exists (measured 2026-10-23)

The proposal assumes a blank page. It is not one: **office↔driver messaging was built in Phase 5M/7
(D54, D-PM4) and has never carried a message.**

| Fact | Measured | Where |
|---|---|---|
| Schema | `message_threads` (org, subject, `load_id`, status, `last_message_at`), `thread_participants` (role `driver`\|`office`, `last_read_at`), `messages` (client-UUID PK, `attachment_path`, `edited_at`, soft delete only — `MG001` refuses a hard DELETE), `message_reports` | `0096_messages.sql` |
| Access model | By PARTICIPATION, not role: `auth_in_thread()` in RLS, the same check in the service. A manager not in a thread does not read it | 0096; `routes/messages.ts` header |
| Realtime | `messages` is already in the `supabase_realtime` publication; the driver app subscribes to Postgres Changes with a poll as fallback ("poll is the guarantee, realtime is the speed") | `apps/driver/src/features/messages/useMessages.ts` |
| Web side | `/messages` dispatch inbox (`MessagesPage.vue`, 295 lines), 30 s / 15 s poll — D-PM4 ruled realtime was the driver's need, not the office's | `apps/web/src/features/messages/useMessages.ts` |
| API | One router for both sides, `requireModule("messages")`, writes share the driver budget `driverWriteLimit` (20/min, **300/day**) | `modules/messaging/routes/messages.ts` |
| Notifications | `notify()` → bell + Expo push to the driver's phone (1-minute push loop); web has the bell, **no browser/desktop notification and no Web Push** | `notify.ts`, `notificationPush.ts` |
| Permissions | Surface `dispatch.messages`, gate `section("dispatch")`, `startsOnFor: []` | `surfaceCatalogue.ts:151` |
| Production use | **0 threads, 0 messages.** 2 orgs; active members: 7 admin, 3 dispatcher, 1 safety manager, 1 fleet manager, 1 technician, 1 driver (14 people in the office) | `supabase db query --linked` |
| Browser↔Supabase | The SPA already holds a Supabase session (`lib/supabase.ts`) and CSP already allows `wss://*.supabase.co` | `appHttp.ts:57` |
| AWS shape | One EC2 per environment, Docker Compose + Caddy, **`API_REPLICAS` api containers** + a worker, Supabase stays the database (D-AWS, PR #1714) | `infra/server/compose.yml` |

### What the existing code would get wrong for office chat

These are defects only at office-chat scale; they are invisible today because nothing has ever been sent.

1. **`listThreads` reads every message of every thread the user is in**, on every inbox poll, to
   compute the last message and the unread count in JavaScript. With a year of office chat that is
   tens of thousands of rows per request, and PostgREST silently stops at 1,000 — so unread counts
   and "last message" go wrong *quietly*. `getThread`
   also returns the whole history with no paging.
2. **The client never chooses participants** — the rule that file exists to enforce. Right for a
   driver thread (the audience is "this driver + every dispatch-capable user"); wrong for "message
   Ana". Office chat needs the client to name people, and the server to validate each one.
3. **300 messages a day** is the driver budget; a dispatcher in a busy group chat passes it before
   lunch and gets 429s.
4. **The browser can write `messages` directly.** `messages_send` / `messages_own_update` are client
   INSERT/UPDATE policies, so PostgREST accepts a message that skipped the API — no rate limit, no
   notification, no audit. Nothing uses them (the driver writes through the API outbox). SP6 removed
   the same shape from memberships/invites.
5. **An edit overwrites the body.** `edited_at` records that it changed, not what it said. For a
   record that may be read by a lawyer after a crash, that is not enough (Q-CHAT5).

## 2. The proposal against this codebase

| ChatGPT proposed | Here | Ruling |
|---|---|---|
| Six new `chat_*` tables | Four tables exist, empty, with the right access model | **Extend 0096**, don't build a second messaging engine beside the first (D-CHAT1) |
| Socket.IO / `ws` in the API, Redis when scaling | api runs `API_REPLICAS` containers behind Caddy: an in-process socket server needs Redis fan-out + sticky sessions on day one. Supabase Realtime is already paid for, already in the CSP, already used by the driver app, and **does not move in the AWS migration** | **Supabase Realtime, no socket server, no Redis** (D-CHAT2) |
| "Persist first, then publish; transactional outbox" | Postgres Changes are read from the WAL: a message is published only after its transaction commits. That IS the outbox, for free | Nothing to build (D-CHAT2) |
| SignalR if moving to .NET | Not moving to .NET | Dropped |
| Attachments in S3 with signed links | Files live in Supabase Storage (private buckets, signed URLs, nightly S3 copy #1704). A second file store is a second backup, a second retention rule, a second access check | **Supabase Storage**, private bucket, signed URLs minted by the API (D-CHAT6) |
| Malware scanning | 14 internal users, no inbound files from strangers | Type allow-list + size cap; scanning only if Q-CHAT7 opens chat to outsiders |
| Elasticsearch later, Postgres FTS first | Agreed | `tsvector` generated column + GIN, CH6 |
| Web Push + mobile push | Expo push exists for the driver; web has none | Browser notifications while a tab is open first (no service worker), Web Push later (Q-CHAT4) |
| Presence, typing, read receipts | Supabase Realtime Presence + Broadcast; read receipts from `last_read_at` (exists) | CH4 |
| Driver chat, restricted while moving | Driver messaging exists, separate, motion-aware work belongs to the driver app | Out of scope until Q-CHAT1 says otherwise |
| Department channels, load/incident threads | `load_id` exists on threads | Channels CH5; entity threads CH7 |
| Retention, legal hold | Messages are soft-delete only already | Q-CHAT5 |

The proposal's architecture (backend authorises everything, Postgres is the source of truth, realtime
is only delivery) is sound and matches what the repo already does. What it gets wrong is the cost: it
plans to build infrastructure this stack already has.

## 3. Decisions (proposed — owner confirms or overrules)

| ID | Decision | Why |
|---|---|---|
| D-CHAT1 | **One messaging engine.** Office chat extends `message_threads` / `thread_participants` / `messages`; a thread gets a `kind`: `driver` (today's), `direct`, `group`, `channel`. The driver path keeps its server-resolved audience; office kinds let the client name people | Two engines drift. The tables are empty, so reshaping costs migrations, not a data move |
| D-CHAT2 | **Delivery = Supabase Realtime Postgres Changes on `messages`, RLS-checked, with the poll as fallback** (60 s when realtime is up, 15 s when it is down). No socket server, no Redis, no new container | At 14 office users each insert is checked against ~14 subscribers — trivial. Supabase's documented ceiling for this mode is in the hundreds of concurrent users per org; past that the move is to Broadcast-from-trigger (`realtime.send`) on private per-thread topics, without changing the tables |
| D-CHAT3 | **All writes go through the API.** Drop `messages_send`, `messages_own_update` and `reports_own`; the browser keeps SELECT only (needed for Realtime) | One write path = one rate limit, one notification, one audit. SP6 precedent |
| D-CHAT4 | **The server validates every named participant**: active (not suspended) membership in the same org, office role (not `driver`) unless Q-CHAT1 widens it. A direct thread is unique per pair (`direct_key` = sorted user ids, unique per org) so "message Ana" twice opens the same conversation | Rule 2 above, re-stated for office kinds instead of removed |
| D-CHAT5 | **Inbox and history are computed in SQL, paged.** One function returns the user's threads with last message, unread count and participants (keyset on `last_message_at, id`); history pages 50 at a time by `(created_at, id)` | Defect 1 |
| D-CHAT6 | Attachments: private bucket `chat-files`, path `org/<org>/thread/<thread>/<message>/<name>`, API mints 5-minute signed URLs after the participation check; PDF / images / Office docs, 25 MB cap | Same store, backup and access rule as every other document |
| D-CHAT7 | **Chat is not the bell.** A chat message raises the chat badge and (if allowed) a browser notification; it does NOT write `notification_events`. Only @mentions and messages in a muted-to-mentions thread go to the bell | Sixty chat lines a day in the bell bury the card-fraud alerts the bell exists for |
| D-CHAT8 | Office budget separate from the driver's: 60/min, 3,000/day per user | Defect 3 |
| D-CHAT9 | Its own surface, `chat` (General group), on for every office role by default | Chat is for everyone in the office; hiding it behind `section("dispatch")` would be the `canManage` mistake again (CLAUDE.md, No workarounds) |

## 4. Work queue

Each item is one PR unless noted. Columns and their first reader ship in separate merges
(`lint:migration-ordering`).

| ID | What | Depends on |
|---|---|---|
| CH0 | This plan; owner answers Q-CHAT1–Q-CHAT5 | — |
| CH1a | Migration: `kind`, `direct_key` (+ unique per org), participant `member_role` (`owner`\|`member`), `left_at`, `muted` (`none`\|`mentions`\|`all`); relax `thread_participants.role` check; drop the three client write policies (D-CHAT3); `chat_inbox(p_user, p_before, p_limit)` and `chat_history(p_thread, p_before, p_limit)` functions; `message_edits` (append-only prior bodies) if Q-CHAT5 says so. PGlite matrix: a non-participant reads nothing, a left member reads nothing new, the browser cannot INSERT | CH0 |
| CH1b | API: `/api/chat` — list (paged), open (paged history), create direct / group (participant validation, idempotent on client thread id), send, edit, retract, read, leave, add/remove member (owner only, audited). `expectOrgScoped` on every query. Rewrites `listThreads`/`getThread` on the SQL functions so the driver path gets the fix too | CH1a released to staging |
| CH2 | Web: `/chat` page — conversation list, thread, composer, new-message picker (people from memberships), unread badge in the sidebar; poll only. Design per `DESIGN-SYSTEM-CONTRACT.md`, shared `packages/ui` | CH1b |
| CH3 | Realtime on the web: one inbox channel per signed-in tab (Postgres Changes on `messages`, RLS-scoped), invalidates the inbox + open thread; backs the poll off to 60 s while subscribed; re-subscribes on token refresh. Browser `Notification` when the tab is hidden and the thread isn't muted | CH2 |
| CH4 | Presence (online dot) and typing via Realtime Presence/Broadcast on a private channel; read receipts ("Seen") from `last_read_at` | CH3 |
| CH5 | Department channels (Dispatch, Safety, Accounting, Shop): admin creates, members join; mentions `@name` → bell (D-CHAT7) | CH3 |
| CH6 | Attachments (D-CHAT6), then search (generated `tsvector`, GIN, results limited to threads the user is in) | CH2 |
| CH7 | Entity threads: "Chat about this" on a load, driver, truck, case — a `group` thread linked to the record by FK, shown on that record's page | Q-CHAT6 |
| CH8 | Web Push (service worker + VAPID) for a closed tab | Q-CHAT4 |

**A usable office chat is CH1a → CH3** (four merges, two of them migrations, so two release nights at
minimum). CH4–CH8 are each independently shippable after it.

## 5. Risks

- **Realtime silently stops** (token refresh, sleep, Supabase incident). Mitigation is the rule the
  driver app already follows: realtime is the speed, the poll is the guarantee; the UI shows "Reconnecting…"
  when the channel is not `SUBSCRIBED`, never a stale list that looks live.
- **Key rotation**: Realtime authorises with the user's access token from the SPA's Supabase client.
  The 10/23 rotation showed the publishable key is inlined at build time
  — a rotated key breaks chat delivery exactly like it breaks sign-in; no new exposure, but CH3's
  staging check must include a live subscription.
- **Custom Supabase domain** later would need its `wss://` origin in CSP `connectSrc`.
- **Discovery**: trucking chat logs are subpoenaed after crashes. Whatever Q-CHAT5 decides must be
  decided before CH2 ships, not after people have written in it.

## 6. Open questions

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| Q-CHAT1 | Who can use office chat? | (a) office members only; (b) office + drivers in the same chat; (c) + outside partners | **(a).** Drivers already have their thread with dispatch (D54), with its safety rules; mixing them into office chat brings motion restrictions and Apple's UGC rules into a desktop feature. Outsiders need a different identity model entirely |
| Q-CHAT2 | Can an admin read conversations they are not in? | (a) never, as today; (b) yes, through an audited "compliance view"; (c) export only, audited, step-up | **(c).** People write honestly only in a chat they trust; an audited export covers a lawsuit or an HR case without a standing window into everyone's DMs |
| Q-CHAT3 | Which features are must-have for the first release? | DMs + groups only; + realtime; + presence/typing; + files | **DMs + groups + realtime (CH1–CH3).** Typing and presence are nice; delivery that is instant and reliable is the feature |
| Q-CHAT4 | Notification when the Silvicom tab is closed? | (a) none — badge on next visit; (b) Web Push; (c) email after N minutes unread | **(a) for the first release**, (b) as CH8 if people miss messages. (c) duplicates chat into email |
| Q-CHAT5 | Retention and edits | (a) keep forever, edits keep prior text (`message_edits`), retract hides but keeps; (b) delete after N years; (c) allow real deletion | **(a)**, and add chat to `RETENTION_FORBIDDEN` until counsel names a period. Reversible later; (c) is not |
| Q-CHAT6 | Entity threads: does anyone with access to a load see its chat? | (a) participants only, others asked to join; (b) everyone who can see the load | **(a)** — the proposal is right that seeing a load must not grant its conversation |
| Q-CHAT7 | Is the other org (2 orgs in production) a separate company whose people must never see each other? | yes / no | Assumed **yes**: every row is org-scoped and the people picker lists one org only |

## 7. Progress log

- 2026-10-23 — plan opened; existing messaging, production usage and the AWS shape measured (§1).
