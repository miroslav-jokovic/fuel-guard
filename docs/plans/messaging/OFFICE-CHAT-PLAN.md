# Office chat — a Teams-style chat inside Silvicom 360 (2026-10-23)

Opened 2026-10-23 at the owner's request: *"Internal chat between users in office … we are almost
switched to AWS so count on that."* The owner brought a proposal written by ChatGPT (Socket.IO or
SignalR, Redis, six new `chat_*` tables, S3 attachments, four phases) and asked for it to be compared
with this codebase and turned into a precise, reliable plan. Same day, the owner made the target
explicit: *"some Chat system like Microsoft Teams, just internally in our app, also we will have more
and more users added."* So this plan has two goals. Its features are Teams': chats, teams with channels,
replies, mentions, reactions, files, search, an activity feed and presence. Its design has to hold
long after today's 14 office users (§3).

This is a decision log. Decisions are `D-CHAT*`, questions for the owner `Q-CHAT*`, work items `CH*`.
The progress log is at the END (append there, never into the tables).

## 1. What already exists (measured 2026-10-23)

The proposal assumes a blank page. It is not one: **office↔driver messaging was built in Phase 5M/7
(D54, D-PM4) and has never carried a message.**

| Fact | Measured | Where |
|---|---|---|
| Schema | `message_threads` (org, subject, `load_id`, status, `last_message_at`), `thread_participants` (role `driver`\|`office`, `last_read_at`), `messages` (client-UUID PK, `attachment_path`, `edited_at`, soft delete only — `MG001` refuses a hard DELETE), `message_reports` | `0096_messages.sql` |
| Access model | By PARTICIPATION, not role: `auth_in_thread()` in RLS, the same check in the service. A manager not in a thread does not read it | 0096; `routes/messages.ts` header |
| Realtime | `messages` is in the `supabase_realtime` publication; the driver app subscribes to Postgres Changes with a poll as fallback ("poll is the guarantee, realtime is the speed") | `apps/driver/src/features/messages/useMessages.ts` |
| Web side | `/messages` dispatch inbox (`MessagesPage.vue`, 295 lines), 30 s / 15 s poll | `apps/web/src/features/messages/useMessages.ts` |
| API | One router for both sides, `requireModule("messages")`, writes share the driver budget `driverWriteLimit` (20/min, **300/day**) | `modules/messaging/routes/messages.ts` |
| Notifications | `notify()` → bell + Expo push to the driver's phone; web has the bell, **no browser/desktop notification and no Web Push** | `notify.ts`, `notificationPush.ts` |
| Permissions | Surface `dispatch.messages`, gate `section("dispatch")`, `startsOnFor: []` | `surfaceCatalogue.ts:151` |
| Production use | **0 threads, 0 messages.** 2 orgs, 16 auth users; active members: 7 admin, 3 dispatcher, 1 safety manager, 1 fleet manager, 1 technician, 1 driver | `supabase db query --linked` |
| Database | 4.6 GB today | `pg_database_size` |
| Browser↔Supabase | The SPA already holds a Supabase session (`lib/supabase.ts`); CSP already allows `wss://*.supabase.co` | `appHttp.ts:57` |
| AWS shape | One EC2 per environment, Docker Compose + Caddy, **`API_REPLICAS` api containers** + a worker; Supabase stays the database and does not move (PR #1714) | `infra/server/compose.yml` |

### What the existing code would get wrong for office chat

Invisible today because nothing has ever been sent; each one is fatal at Teams scale.

1. **`listThreads` reads every message of every thread the user is in**, on every inbox poll, to
   compute last message and unread in JavaScript. PostgREST stops at 1,000 rows without an error, so
   unread counts and previews go wrong *quietly* within weeks of real use. `getThread` returns the whole
   history with no paging.
2. **The client never chooses participants.** Right for a driver thread; wrong for "message Ana" or
   "add Marko to the Shop channel".
3. **300 messages a day** is the driver budget; an active office user passes it before lunch.
4. **The browser can write `messages` directly** (`messages_send`, `messages_own_update` are client
   INSERT/UPDATE policies), skipping the rate limit, notifications and audit. Nothing uses them. SP6
   removed the same shape from memberships/invites.
5. **An edit overwrites the body.** `edited_at` records that it changed, not what it said.
6. **Unread is computed by counting rows.** Fine for 10 threads, not for a user in 80 conversations
   and 30 channels with thousands of messages each.

## 2. The proposal against this codebase

| ChatGPT proposed | Here | Ruling |
|---|---|---|
| Six new `chat_*` tables | Four tables exist, empty, with the right access model | **Extend 0096** — one messaging engine (D-CHAT1) |
| Socket.IO / `ws` in the API, Redis when scaling | api runs `API_REPLICAS` containers behind Caddy, so an in-process socket server needs Redis fan-out + sticky sessions on day one, and becomes a component we must keep up at 01:07 deploys | **Supabase Realtime Broadcast, no socket server, no Redis** (D-CHAT2), behind a transport seam so a later move is one file (D-CHAT10) |
| "Persist first, then publish; transactional outbox" | Broadcast-from-database sends from a trigger *inside the insert's transaction*; a rolled-back message is never announced | Nothing extra to build (D-CHAT2) |
| SignalR if moving to .NET | Not moving to .NET | Dropped |
| Attachments in S3 with signed links | Files live in Supabase Storage (private buckets, signed URLs, nightly S3 copy #1704) | **Supabase Storage** (D-CHAT6) |
| Malware scanning | Internal users only | Type allow-list + size cap; scanning only if Q-CHAT1 opens chat to outsiders |
| Postgres FTS before Elasticsearch | Agreed | CH8 |
| Web Push + mobile push | Expo push exists for the driver; web has none | Browser notifications while a tab is open first, Web Push CH10 |
| Presence, typing, read receipts | Realtime Presence + Broadcast; receipts from the read sequence | CH9 |
| Load / incident conversations | `load_id` exists on threads | CH11 |

The proposal's architecture is sound and matches what the repo already does: the backend authorises
everything, Postgres is the source of truth, and realtime only delivers. What it gets wrong is cost: it
plans to build infrastructure this stack already has.

## 3. Designing for "more and more users"

**Design target:** 1,000 office users in one org, 300 online at once, 100 messages per user per day
at peak, channels up to the whole org. Today is 14 users. The target is set at roughly 70× so that
nothing in the design needs a rewrite before then. Each line below says what breaks first and when.

| Concern | At the target | What holds it |
|---|---|---|
| **Delivery fan-out** | A message to a 1,000-member channel | Postgres Changes authorises **per subscriber per change**, single-threaded, ~3,000 msg/s total with RLS, and latency rises with subscriber count (Supabase docs). Broadcast sends once per topic. **D-CHAT2** |
| **Connections** | One websocket per open tab (supabase-js multiplexes every channel on it) | Supabase Pro allows **500 concurrent connections with the spend cap on, 10,000 without**, and 100 channels per connection. ~300 online users with two tabs each is the first wall → **Q-CHAT9** |
| **Channels per tab** | A user in 200 conversations | Never one channel per conversation: one per-user topic plus the open conversation's topic (D-CHAT2) |
| **Unread counts** | 100+ conversations per user | Sequence numbers, not row counts (D-CHAT5) |
| **Missed events** | Laptop sleeps, Wi-Fi drops, deploy | Sequences reveal a gap; the client refetches from its last seq (D-CHAT5). The poll stays as the guarantee |
| **Storage** | ~1 KB per message with indexes + search vector; 200 users × 60/day × 250 days ≈ 3 M rows ≈ **3 GB/year** | Indexes on `(thread_id, seq)` keep the working set to recent pages; monthly partitioning is not needed below ~10 M rows. Watch against the compute tier (DATA-LIFECYCLE-PLAN §8) |
| **Writes** | 100k messages/day ≈ 3/s average | Trivial for Postgres; the per-thread seq row lock serialises only one conversation's writers |
| **The API** | Every send is an HTTP call | The send path stays at a few round trips; the board's 28 serial calls (PLATFORM-RELIABILITY §1) are the shape to avoid |

## 4. What "like Teams" means here

| Teams | Silvicom chat | Item |
|---|---|---|
| Chat: 1:1 and group chats | `direct` (unique per pair) and `group` threads, rename, add/remove people | CH1–CH3 |
| Teams → channels | `chat_spaces` (a team, e.g. Dispatch, Safety, Shop, Accounting) holding `channel` threads; public channels anyone in the team can join, private channels by invitation | CH5 |
| Channel posts with replies | `messages.parent_id` — a reply thread under a post, its own unread | CH5 |
| @mentions, @team, @channel | `message_mentions`; they feed the Activity list and the bell (D-CHAT7) | CH6 |
| Reactions | `message_reactions` (one row per user/emoji) | CH6 |
| Edit, delete | Edit keeps prior text (`message_edits`); delete hides, keeps the row (Q-CHAT5) | CH1 |
| Files tab | Attachments per message and a Files list per conversation | CH7 |
| Search | Full-text over conversations the user can read | CH8 |
| Presence and status | Available / Busy / Away / Do not disturb, auto-away on idle | CH9 |
| Activity feed | Mentions, replies to you and reactions, in one list | CH6 |
| Desktop notifications | Browser notifications, then Web Push | CH6, CH10 |
| Pinned and saved messages | `pinned_at` on messages, per-user saved list | CH6 |
| **Meetings, calls, screen share** | **Not in this plan.** Video needs a media server (LiveKit, Amazon Chime SDK) — a separate product | **Q-CHAT8** |
| Context the generic tools lack | "Chat about this" on a load, driver, truck, case | CH11 |

## 5. Decisions (proposed — owner confirms or overrules)

| ID | Decision | Why |
|---|---|---|
| D-CHAT1 | **One messaging engine.** Office chat extends `message_threads` / `thread_participants` / `messages`; a thread gets a `kind`: `driver` (today's), `direct`, `group`, `channel`. The driver path keeps its server-resolved audience | Two engines drift. The tables are empty, so reshaping costs migrations, not a data move |
| D-CHAT2 | **Delivery = Supabase Realtime Broadcast from the database, on PRIVATE topics.** An insert trigger calls `realtime.send` for (a) the conversation topic `conv:<id>`, which carries the full message to whoever has it open, and (b) each member's `user:<id>` topic, which carries a small "conversation X is now at seq N" so their list and badges update. Members of a channel larger than 50 people get no per-user push. Their unread dot refreshes on the 60 s poll or when they open the app, as in Teams and Slack, where big channels are not urgent. Who may join which topic is enforced by RLS policies on `realtime.messages`, with the same participation predicate. The poll stays at 60 s while connected and 15 s when not | Postgres Changes' per-subscriber authorisation is the documented scaling wall (§3). A tab holds only 2 subscriptions, whatever its user's conversation count |
| D-CHAT3 | **All writes go through the API.** Drop `messages_send`, `messages_own_update` and `reports_own`; the browser keeps SELECT only | One write path = one rate limit, one notification, one audit. SP6 precedent |
| D-CHAT4 | **The server validates every named participant**: an active membership in the same org, office role unless Q-CHAT1 widens it. A direct thread is unique per pair (`direct_key` = sorted ids, unique per org) | Rule 2 of §1, re-stated, not removed |
| D-CHAT5 | **Per-conversation sequence numbers.** A trigger gives each message `seq = thread.last_seq + 1`, and each member stores `read_seq`. Unread is `last_seq − read_seq`, so there is no counting. A client that receives seq N+2 after N knows it missed one and refetches from N. The inbox and history come from SQL functions with keyset paging (50 per page) | Defects 1 and 6. A gap you can see is how you know delivery is reliable |
| D-CHAT6 | Attachments: private bucket `chat-files`, path `org/<org>/thread/<thread>/<message>/<file>`, API mints 5-minute signed URLs after the participation check; PDF / images / Office docs, 25 MB cap | Same store, backup and access rule as every other document |
| D-CHAT7 | **Chat is not the bell.** Ordinary messages raise the chat badge and a browser notification. Only mentions and replies to you reach the bell, and they are grouped per conversation | Sixty chat lines a day would bury the fraud alerts the bell exists for |
| D-CHAT8 | Office budget separate from the driver's: 60/min, 3,000/day per user | Defect 3 |
| D-CHAT9 | Its own surface, `chat` (General group), on for every office role by default; creating teams is admin-grantable | Chat is for everyone. Gating it on `section("dispatch")` would be the `canManage` mistake (CLAUDE.md, No workarounds) |
| D-CHAT10 | **Transport seam.** The web reaches realtime only through `features/chat/transport.ts` (subscribe(user), subscribe(conversation), onGap) | If connections outgrow Supabase (Q-CHAT9) or pricing changes, a self-hosted socket service replaces one file, not the feature |
| D-CHAT11 | Multi-org isolation: every row carries `org_id`, every function and policy checks it; the people picker lists one org | Two orgs in production today, more if the platform is sold (D-S360) |

## 6. Work queue

Each item is one PR unless noted. A column and its first reader ship in separate merges
(`lint:migration-ordering`), so every migration below is followed by a separate code merge.

| ID | What | Depends on |
|---|---|---|
| CH0 | This plan; owner answers Q-CHAT1–Q-CHAT10 | — |
| CH1a | Migration: thread `kind`, `direct_key`, `last_seq`; participant `member_role` (`owner`\|`member`), `read_seq`, `left_at`, `muted`; `messages.seq` + seq trigger; `message_edits` (append-only); drop the client write policies (D-CHAT3); `chat_inbox()` / `chat_history()` functions. PGlite matrix: non-member reads nothing, left member reads nothing new, browser cannot INSERT, seq has no gaps under concurrent sends | CH0 |
| CH1b | API `/api/chat`: list, open (paged), create direct/group (validated, idempotent on client id), send, edit, retract, read, leave, add/remove member (audited). `expectOrgScoped` everywhere. `listThreads`/`getThread` move onto the functions, which fixes the driver path too | CH1a on staging |
| CH2 | Web `/chat`, Teams layout: left rail (Activity · Chat · Teams), conversation list, conversation with infinite scroll up, composer, people picker, sidebar badge. Poll only | CH1b |
| CH3a | Migration: broadcast trigger + `realtime.messages` policies (guarded: the `realtime` schema does not exist on PGlite, so the matrix tests the policy predicate function separately) | CH1a |
| CH3b | `transport.ts` (D-CHAT10): per-user + open-conversation topics, gap refetch, "Reconnecting…" state, re-auth on token refresh. **Load test on staging: 300 simulated clients, one 300-member channel, p95 delivery measured and written into §8** | CH2, CH3a |
| — | **First release = CH1a → CH3b: direct and group chat, live.** About 3 release nights | |
| CH4 | Admin: retention setting, audited export (Q-CHAT2), reports queue | CH1b |
| CH5 | Teams and channels: `chat_spaces`, public/private channels, join/leave, `parent_id` replies | CH3b |
| CH6 | Mentions, reactions, pins, Activity feed, browser notifications, mention → bell | CH5 |
| CH7 | Files: upload, preview, per-conversation Files list | CH2 |
| CH8 | Search: generated `tsvector` + GIN, results limited to readable conversations | CH2 |
| CH9 | Presence, status, typing; "Seen" from `read_seq` in direct/group chats | CH3b |
| CH10 | Web Push (service worker + VAPID) for a closed tab | Q-CHAT4 |
| CH11 | "Chat about this" on loads, drivers, trucks, cases | Q-CHAT6 |

## 7. Open questions

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| Q-CHAT1 | Who can use it? | (a) office members only; (b) + drivers; (c) + outside partners | **(a).** Drivers keep their dispatch thread (D54) with its driving-safety rules. Outsiders need a different identity model |
| Q-CHAT2 | Can an admin read conversations they are not in? | (a) never; (b) audited compliance view; (c) audited export with step-up | **(c).** People write honestly only in a chat they trust; an export covers a lawsuit or HR case |
| Q-CHAT3 | First release scope | DMs + groups; + live delivery; + teams/channels | **DMs + groups, live (CH1–CH3)**, teams/channels as the next release |
| Q-CHAT4 | Alert when the Silvicom tab is closed? | (a) none, badge next visit; (b) Web Push; (c) email after N min | **(a) first, (b) as CH10** |
| Q-CHAT5 | Retention and edits | (a) keep forever, edits keep prior text, delete hides; (b) delete after N years; (c) real deletion | **(a)** and pin in `RETENTION_FORBIDDEN` until counsel names a period. Decide before CH2 ships |
| Q-CHAT6 | Does seeing a load grant its chat? | (a) members only; (b) everyone who sees the load | **(a)** |
| Q-CHAT7 | Are the two production orgs separate companies? | yes / no | Assumed **yes** (D-CHAT11) |
| Q-CHAT8 | Calls and meetings | (a) out — share a Teams/Zoom/Meet link; (b) build on LiveKit or Amazon Chime SDK later | **(a).** Video is a separate product with its own servers and costs; chat is worth shipping without it |
| Q-CHAT9 | Supabase realtime connection ceiling | (a) Pro with spend cap: 500 connections; (b) remove the spend cap: 10,000, billed per use | **(a) now**, with a platform-health alert at 350; move to (b) when it fires |
| Q-CHAT10 | Who creates teams and channels? | (a) admins only; (b) anyone, admins can archive | **(a) for teams, (b) for channels inside a team you belong to** — Teams' default |

## 8. Progress log

- 2026-10-23: plan opened; existing messaging, production usage and the AWS shape measured (§1).
- 2026-10-23: owner: "like Microsoft Teams … more and more users". Delivery moved from Postgres Changes to Broadcast-from-database (Supabase limits read that day: Pro 500/10,000 connections, 100 channels per connection, Postgres Changes ~3,000 msg/s with RLS). Added §3 (scale), §4 (Teams feature map), sequence numbers (D-CHAT5), the transport seam (D-CHAT10) and Q-CHAT8–10.
