# Office chat — a Teams-style chat inside Silvicom 360 (2026-10-23)

Opened 2026-10-23 at the owner's request: *"Internal chat between users in office … we are almost
switched to AWS so count on that."* The owner brought a proposal written by ChatGPT (Socket.IO or
SignalR, Redis, six new `chat_*` tables, S3 attachments, four phases) and asked for it to be compared
with this codebase and turned into a precise, reliable plan. The same day the owner sharpened the
brief twice:

- *"some Chat system like Microsoft Teams, just internally in our app, also we will have more and more
  users added"*. That means Teams' features (§4) and a design that holds long after today's 14 office
  users (§3).
- *"modern advanced, enterprise grade, and architecture have to be lightweight … good audit logs and
  Admin to be able to audit messages … we dont want this to turn in some expensive feature … research
  best practices that are used in last 6 months"*. That covers the audit and compliance design (§5),
  cost (§6) and the practices this plan adopts (§7).

This is a decision log. Decisions are `D-CHAT*`, questions for the owner `Q-CHAT*`, work items `CH*`.
The progress log is at the END (append there, never into the tables).

## 1. What already exists (measured 2026-10-23)

The proposal assumes a blank page. It is not one: **office↔driver messaging was built in Phase 5M/7
(D54, D-PM4) and has never carried a message.**

| Fact | Measured | Where |
|---|---|---|
| Schema | `message_threads` (org, subject, `load_id`, status, `last_message_at`), `thread_participants` (role `driver`\|`office`, `last_read_at`), `messages` (client-UUID PK, `attachment_path`, `edited_at`, soft delete only — `MG001` refuses a hard DELETE), `message_reports` | `0096_messages.sql` |
| Access model | By PARTICIPATION, not role: `auth_in_thread()` in RLS, the same check in the service | 0096; `routes/messages.ts` header |
| Realtime | `messages` is in the `supabase_realtime` publication; the driver app subscribes to Postgres Changes with a poll as fallback ("poll is the guarantee, realtime is the speed") | `apps/driver/src/features/messages/useMessages.ts` |
| Web side | `/messages` dispatch inbox (`MessagesPage.vue`, 295 lines), 30 s / 15 s poll | `apps/web/src/features/messages/useMessages.ts` |
| API | One router for both sides, `requireModule("messages")`, writes share the driver budget `driverWriteLimit` (20/min, **300/day**) | `modules/messaging/routes/messages.ts` |
| Notifications | `notify()` → bell + Expo push to the driver's phone; web has the bell, **no browser notification and no Web Push** | `notify.ts`, `notificationPush.ts` |
| Audit | `audit_logs` is append-only (AU010, SP8), **5.07 M rows, 1.23 GB**; `writeAudit()`; step-up re-authentication exists (`requireFreshAuth.ts`, SP9: HMAC-bound token after a fresh password grant) | `lib/audit.ts`, SQL |
| AI | `lib/anthropic.ts` is already in the API (document reading, Ask AI) | |
| Permissions | Surface `dispatch.messages`, gate `section("dispatch")`, `startsOnFor: []` | `surfaceCatalogue.ts:151` |
| Production use | **0 threads, 0 messages.** 2 orgs, 16 auth users; active members: 7 admin, 3 dispatcher, 1 safety manager, 1 fleet manager, 1 technician, 1 driver | `supabase db query --linked` |
| Database | 4.6 GB | `pg_database_size` |
| AWS shape | One EC2 per environment, Docker Compose + Caddy, `API_REPLICAS` api containers + a worker; Supabase stays the database and does not move (PR #1714) | `infra/server/compose.yml` |

### What the existing code would get wrong for office chat

Invisible today because nothing has been sent; each one is fatal at Teams scale.

1. **`listThreads` reads every message of every thread the user is in** on every poll. PostgREST stops
   at 1,000 rows without an error, so unread counts and previews go wrong *quietly*. `getThread`
   returns the whole history unpaged.
2. **The client never chooses participants.** Right for a driver thread; wrong for "message Ana".
3. **300 messages a day** is the driver budget.
4. **The browser can write `messages` directly** (`messages_send`, `messages_own_update`), skipping
   rate limit, notification and audit. Nothing uses them. SP6 removed the same shape elsewhere.
5. **An edit overwrites the body.** `edited_at` says it changed, not what it said.
6. **Unread is computed by counting rows.**
7. **No record of who read what as an administrator**: today an admin with database access is the only
   "auditor", and that path leaves no trace.

## 2. The proposal against this codebase

| ChatGPT proposed | Here | Ruling |
|---|---|---|
| Six new `chat_*` tables | Four exist, empty, with the right access model | **Extend 0096** (D-CHAT1) |
| Socket.IO / `ws`, Redis when scaling | api runs `API_REPLICAS` containers: an in-process socket server needs Redis + sticky sessions on day one, plus another component to keep alive at every deploy | **Supabase Realtime Broadcast, no socket server, no Redis** (D-CHAT2), behind a seam (D-CHAT10) |
| Transactional outbox | Broadcast-from-database sends from a trigger inside the insert's transaction; a rolled-back message is never announced | Nothing extra to build |
| S3 attachments | Supabase Storage (private buckets, signed URLs, nightly S3 copy #1704) | Supabase Storage (D-CHAT6) |
| Audit history | Mentioned in one line | **A tamper-evident chat ledger + an audited compliance console** (§5) |
| Elasticsearch later | Agreed: Postgres FTS | CH8 |

The proposal's architecture is sound: the backend authorises everything, Postgres is the source of
truth, and realtime only delivers. What it gets wrong is cost: it plans to build infrastructure this
stack already has.

## 3. Designing for "more and more users"

**Design target:** 1,000 office users in one org, 300 online at once, 100 messages per user per day at
peak, channels up to the whole org. Today is 14. The target is ~70× today, so nothing needs a rewrite
before it.

| Concern | At the target | What holds it |
|---|---|---|
| **Delivery fan-out** | A message to a 1,000-member channel | Postgres Changes authorises **per subscriber per change**, single-threaded, ~3,000 msg/s total with RLS; Broadcast sends once per topic (Supabase docs). D-CHAT2 |
| **Connections** | One websocket per open tab, all channels multiplexed on it | Supabase Pro: **500 peak connections included, $10 per extra 1,000**; 100 channels per connection. Q-CHAT9 |
| **Channels per tab** | A user in 200 conversations | Two subscriptions per tab, whatever the conversation count (D-CHAT2) |
| **Unread** | 100+ conversations per user | Sequence numbers, not row counts (D-CHAT5) |
| **Missed events** | Sleep, Wi-Fi drop, deploy | Sequence gap → refetch from last seq; the poll stays as the guarantee (D-CHAT5) |
| **Storage** | ~1 KB/message with indexes + search vector; 200 users × 60/day × 250 days ≈ 3 M rows ≈ **3 GB/year** | Indexes on `(thread_id, seq)`; no partitioning below ~10 M rows. Watch against the compute tier (DATA-LIFECYCLE-PLAN §8) |
| **Ledger** | One row per message and per admin act | Its own table, not `audit_logs` (already 1.23 GB) (D-CHAT12) |
| **Writes** | 100 k/day ≈ 3/s | Trivial; the per-thread seq lock serialises only one conversation's writers |

## 4. What "like Teams" means here

| Teams | Silvicom chat | Item |
|---|---|---|
| 1:1 and group chats | `direct` (unique per pair) and `group` threads | CH1–CH3 |
| Teams → channels | `chat_spaces` (Dispatch, Safety, Shop, Accounting …) holding public/private `channel` threads | CH5 |
| Channel posts with replies | `messages.parent_id`, a reply thread with its own unread | CH5 |
| @mentions, @channel | `message_mentions` → Activity + bell (D-CHAT7) | CH6 |
| Reactions, pins, saved | `message_reactions`, `pinned_at`, per-user saved list | CH6 |
| Edit, delete | Edit keeps prior text; delete hides and keeps (D-CHAT13) | CH1 |
| Files tab | Attachments + per-conversation Files list | CH7 |
| Search | Full-text over conversations the user can read | CH8 |
| Presence and status | Available / Busy / Away / Do not disturb, auto-away | CH9 |
| Activity feed, desktop notifications | Mentions, replies, reactions; browser notifications, then Web Push | CH6, CH10 |
| Muted section in the chat list (Teams, 2026) | Muted conversations grouped, never notify | CH6 |
| Copilot catch-up summary (Teams, 2026) | Optional "Catch me up" on demand (D-CHAT16) | CH12 |
| Compliance admins + eDiscovery (Purview) | Compliance console, legal hold, export (§5) | CHA1–CHA3 |
| **Meetings, calls** | **Not in this plan.** Video needs a media server | Q-CHAT8 |
| What Teams can't do | "Chat about this" on a load, driver, truck, case | CH11 |

## 5. Audit and compliance: admins can audit messages

The owner's requirement: *"good audit logs and Admin to be able to audit messages."* This supersedes the
first draft's recommendation that nobody reads a conversation they are not in. It keeps the reason
behind that recommendation: an audit that leaves no trace of itself destroys the trust that makes
people write in the chat. So **auditing is a capability that is itself audited.** That is how Microsoft
Purview and Slack Enterprise Grid's Discovery API work: chat content is reachable only through compliance
tooling, by named compliance roles, not by ordinary managers or by default.

### 5.1 Two records, two purposes

| Record | Holds | Who reads it |
|---|---|---|
| **`chat_ledger`**, new and append-only (D-CHAT12) | Every chat fact: message sent (with SHA-256 of the body), edited (hash of old and new), retracted, member added/removed, conversation created/renamed/archived, hold set/released, retention changed, **every compliance search, view and export with its reason**. One hash chain per org | The compliance console; the nightly verifier |
| **`audit_logs`**, existing | Administrative acts only: compliance access opened, export made, hold changed, retention changed, who was granted compliance access | The existing Settings → Audit log, so the org's ordinary audit trail shows that someone looked |

**Tamper evidence** follows the plain-Postgres pattern several 2026 write-ups converge on:
- Writes go through one `chat_ledger_append()` function, and no role has INSERT/UPDATE/DELETE on the table.
- BEFORE UPDATE/DELETE/TRUNCATE triggers always raise.
- Each row stores `prev_hash` and `hash = sha256(prev_hash ‖ canonical row)`.
- Appends take `pg_advisory_xact_lock(org)`, so two writers can never fork the chain. Each org has its
  own chain, so orgs never wait on each other.
- A nightly `chat-ledger-verify` job (worker, `general` lane) recomputes the chain and checks each live
  message's body hash against the ledger. A mismatch pages through platform-health.

This catches the case RLS cannot: a service-role bug or a person with database access rewriting
history.

### 5.2 The compliance console (Settings → Chat compliance)

- **Who (Q-CHAT2, ruled):** a permission on Settings → Permissions, the surface `chat.compliance`,
  set up like Ask AI (`ask-ai`): it starts on for admins only (`startsOnFor: []`), and an admin can grant
  or remove it per role or per person on the Permissions page. Each grant is an access change, so it
  already takes step-up and writes `audit_logs` (SP8/SP9). The API asks `requireSurface("chat.compliance")`,
  so a refused grant also blocks the endpoint, not only the link.
- **Entry:** step-up re-authentication (`requireFreshAuth`, the SP9 pattern) plus a **required reason**
  (free text + category: HR, legal, safety incident, customer dispute, security). The reason is written
  to both records before any content is returned.
- **Search:** across all of the org's conversations, by person, conversation, date range, keyword or
  has-file. Results show content including edits (all versions) and retracted messages, marked as such.
- **Export:** a conversation or search result as PDF (readable) + JSONL (machine), with a manifest
  holding each message's hash and the ledger head hash at export time. That is a chain of custody a
  court can check. Exports are stored like `dq_exports`: an append-only record of the export, the file
  itself purged after N days.
- **Legal hold** per person *and* per conversation. Slack's holds are per person only, so a conversation
  can fall outside a hold when no held person is in it. A held message is never purged, whatever the
  retention setting.
- **Retention** per org (D-CHAT13): default keep forever; an org may set N years, never shorter than a
  hold. Purging is an explicit, ledgered act of the retention job, never a side effect.
- **Notice (Q-CHAT12, ruled):** no banner and no acknowledgement in the product. Every user is an
  employee, and the review right is in their employment contract. Users can't see who has been reviewed,
  because that would tip off an investigation. Compliance holders see every access in the console's own
  Access log, which is how one admin watches another.
- **No second approval (Q-CHAT11, ruled (a)):** the step-up, the reason and the Access log are the
  control. A four-eyes step can be added later without changing the ledger.


### 5.3 What admins do NOT get

- No reading of chat through ordinary pages, the API's normal routes, or Ask AI. The compliance console
  is the only way in.
- No editing or deleting another person's message. A moderator "remove" is a retraction recorded as
  done by the moderator, with a reason, and the original survives.
- Drivers' threads (D54) are reachable in the console too: they are company records under the same rule.

## 6. Cost: lightweight by construction

No new server, no Redis, no new vendor. Everything below runs on what is already paid for.

| Item | Today (14 users) | At 300 users | Basis |
|---|---|---|---|
| Realtime messages | ~0.2 M/month — inside the **5 M included** on Pro | ~10–15 M/month → **~$15–25/month** over the included 5 M ($2.50 per million) | Billed **per recipient**: 50 msgs/user/day × ~5 recipients × 22 days, plus the per-user signals. D-CHAT2 keeps signals tiny and skips per-user pushes in big channels |
| Realtime connections | ~20 peak — inside 500 included | ~500–600 peak → **~$10/month** | $10 per 1,000 over 500 |
| Database | +~0.1 GB/year | +~3 GB/year | May bring the next compute step closer; measured in CH3b |
| Files | Supabase Storage at ~$0.021/GB | Same | 25 MB cap per file |
| AI catch-up (optional) | $0 unless switched on | Capped per user per day; Haiku-class model | D-CHAT16 |
| API/EC2 | No change | Possibly API_REPLICAS +1 | Send path = a few round trips |

**Realistic total: $0/month extra now, ~$25–50/month at 300 users.** A Teams or Slack seat with
compliance features costs that much *per user*.

## 7. Practices adopted (research 2026-10-23)

Practices from the last six months of published chat-architecture and Supabase guidance, and what this
plan does with each:

| Practice | Adopted as |
|---|---|
| A conversation is a durable log: persist first, deliver second, order by a per-conversation sequence, and keep the durable path separate from ephemeral presence (Stream, SystemDesignSchool) | D-CHAT2, D-CHAT5 |
| Optimistic send with a client idempotency key; the server's id and time are authoritative; a failed send shows Retry and never loses the text (CometChat "Chat UI Architecture in 2026") | Already the 0096 contract (client UUID PK); CH2 adds pending → sent → seen states |
| Delta sync on reconnect: "everything since seq N" for every conversation in one call, not a full reload (Stream) | `GET /api/chat/sync?cursor=` (CH3b) |
| Pushes are wake-ups, not content | D-CHAT2: **realtime carries signals, never message bodies** |
| Supabase: Broadcast-from-database with `realtime.send`/`broadcast_changes` on **private** channels, authorised by RLS on `realtime.messages`; turn off public channel access | CH3a |
| Supabase pitfall: channel policies are checked **at subscribe time**, so a removed member keeps an open subscription until token refresh | Harmless under D-CHAT2: signals carry no content, and every fetch is re-authorised by the API. Removal also sends that user a `left` signal so the tab drops the channel |
| Supabase: private Broadcast can replay up to 25 recent messages on rejoin | Used as the fast path after a short drop; the sync call is the guarantee |
| Binary broadcasts need supabase-js ≥ 2.91 | JSON payloads only; pin the version in CH3b |
| Compliance access only through dedicated tooling by named roles, holds per custodian, chain of custody on export (Purview, Slack Discovery) | §5, plus per-conversation holds to close Slack's gap |
| Tamper-evident log in plain Postgres: WORM triggers, SHA-256 chain, serialised appends, scheduled verify (2026 write-ups) | D-CHAT12 |
| Monitoring notice: some US states (CT, DE, NY …) require notice of electronic monitoring; best practice is a written, acknowledged policy | Covered by the employment contract (Q-CHAT12 ruled); nothing in the product |
| Teams 2026: muted section, AI catch-up on demand | CH6, CH12 |

## 8. Decisions (proposed — owner confirms or overrules)

| ID | Decision | Why |
|---|---|---|
| D-CHAT1 | **One messaging engine.** Extend 0096; a thread gets a `kind`: `driver`, `direct`, `group`, `channel`. The driver path keeps its server-resolved audience | Two engines drift; tables are empty |
| D-CHAT2 | **Delivery = Broadcast from the database, on private topics, carrying signals only.** The insert trigger sends `{conversation, seq, kind}` to `conv:<id>` (viewers of the open conversation) and to each member's `user:<id>` for conversations of ≤ 50 members. Bigger channels update their unread dot by the 60 s poll or on focus. The client fetches content through the API (`/sync`), which authorises every request. The poll runs every 60 s while connected and every 15 s when not | Scales (§3), costs little (§6), and stays correct after a removal (§7). Content never sits in a realtime payload or log. Price: one extra round trip (~100 ms) per received message |
| D-CHAT3 | **All writes through the API.** Drop `messages_send`, `messages_own_update`, `reports_own`; the browser keeps SELECT only | One write path = one rate limit, one ledger row |
| D-CHAT4 | **Server validates every named participant**: active membership, same org, office role. Direct threads unique per pair | §1 defect 2 |
| D-CHAT5 | **Per-conversation sequence numbers**; unread = `last_seq − read_seq`; gaps trigger sync. Keyset-paged SQL functions for inbox and history | §1 defects 1 and 6 |
| D-CHAT6 | Attachments: private bucket `chat-files`, API-minted 5-minute signed URLs after the participation check; type allow-list, 25 MB | Same store and backup as every document |
| D-CHAT7 | **Chat is not the bell.** Only mentions and replies to you reach the bell, grouped per conversation | Keeps the fraud alerts visible |
| D-CHAT8 | Office write budget 60/min, 3,000/day per user | §1 defect 3 |
| D-CHAT9 | Surface `chat` (General), on for every office role; teams/channel creation per Q-CHAT10 | Not the `canManage` mistake |
| D-CHAT10 | **Transport seam**: the web reaches realtime only through `features/chat/transport.ts` | Outgrowing Supabase replaces one file |
| D-CHAT11 | Multi-org isolation on every row, function, policy and ledger chain | 2 orgs today |
| D-CHAT12 | **`chat_ledger`: append-only, hash-chained per org, verified nightly**; administrative acts also in `audit_logs` | §5.1 |
| D-CHAT13 | Edits keep every prior version (`message_versions`); retraction hides and keeps; chat tables + ledger pinned in `RETENTION_FORBIDDEN` until an org sets a retention period through the audited setting | Chat is evidence after a crash; deletion is irreversible, keeping is not |
| D-CHAT14 | **Compliance console** behind `chat.compliance` (a Permissions-page surface: admins by default, grantable per role or person, Q-CHAT2) + step-up + required reason; the only way to read others' conversations | §5.2 |
| D-CHAT15 | Legal hold per person and per conversation; holds beat retention | §5.2 |
| D-CHAT16 | AI catch-up is **off by default**, on demand only (never background), runs over messages the caller can already read, per-user daily cap, and is ledgered | Modern without becoming a cost line or a side door |

## 9. Work queue

One PR each unless noted. A column and its first reader ship in separate merges
(`lint:migration-ordering`).

| ID | What | Depends on |
|---|---|---|
| CH0 | This plan; owner answers §10 | — |
| CH1a | Migration: thread `kind`, `direct_key`, `last_seq`; participant `member_role`, `read_seq`, `left_at`, `muted`; `messages.seq` + trigger; `message_versions`; **`chat_ledger` + `chat_ledger_append()` + WORM triggers**; drop client write policies; `chat_inbox()`/`chat_history()`/`chat_sync()`. PGlite matrix: non-member reads nothing, left member reads nothing new, browser cannot INSERT, seq gapless under concurrency, **ledger refuses UPDATE/DELETE and two concurrent appends never fork** | CH0 |
| CH1b | API `/api/chat`: list, open, sync, create direct/group, send, edit, retract, read, leave, members — each writes its ledger row in the same transaction (an RPC, not two calls). `expectOrgScoped` everywhere. Driver `listThreads`/`getThread` move onto the functions | CH1a on staging |
| CH2 | Web `/chat`, Teams layout (Activity · Chat · Teams rail, list, conversation, composer with pending/sent/seen, people picker, badge). Poll only | CH1b |
| CH3a | Migration: broadcast trigger (signals) + `realtime.messages` policies; staging setting "public channels off" | CH1a |
| CH3b | `transport.ts`, replay-then-sync, "Reconnecting…", re-auth on token refresh. **Load test on staging: 300 simulated clients, one 300-member channel; p95 delivery, Realtime message count and DB CPU written into §11** | CH2, CH3a |
| CHA1 | `chat-ledger-verify` nightly job + platform-health page on mismatch | CH1a |
| CHA4 | **Audit of release 1 (2026-10-23), the two holes it found.** (a) The ledger's head is ANCHORED nightly in the storage backup's S3 bucket and checked against the previous anchor before the chain is trusted — a `postgres`-role rewrite that recomputes every hash, or a cut tail, is otherwise invisible to a chain that only checks itself. (b) The Realtime signal path gets a health record (0515, `platform_realtime_health`): the trigger records each send it could not make, a quarter-hourly probe proves a broadcast from the database reaches a subscriber, and `GET /api/version` → `realtime` folds both into `ok` | CHA1, CH3a |
| — | **Release 1 = CH1a → CH3b + CHA1 + CHA4: direct and group chat, live, ledgered, anchored, watched.** About 3 release nights | |
| CHA2 | Compliance console (**built 2026-10-23**, migration 0516): `chat.compliance` surface on the Permissions page (Settings directory, `section("settings")`, admins by default), step-up + reason on every act, conversations and messages search across the org (driver threads, retracted words and every earlier version included), the conversation view, the Access log; CHA1's notices now go to the permission's holders | CH1b |
| CHA3a | Migration: `chat_holds` (per person or per conversation, set and released with a reason, never deleted) and `chat_exports` (the record of an export, the `dq_exports` shape: the row outlives its bytes); `chat_hold_set` / `chat_hold_release` / `chat_holds_list`; `chat_compliance_export_rows` — one conversation or one messages search, every version and retraction, each line's SHA-256 and the ledger head at that instant, appending `compliance_export` with the reason in the same transaction. PGlite matrix | CHA2 |
| CHA3b | API + console: a Holds tab (set/release, step-up + reason, `audit_logs` beside the ledger); Export on the conversation view and on a messages search → JSONL + PDF + `manifest.json` in the private `compliance-exports` bucket, 5-minute signed links, bytes swept after 7 days while the row stays | CHA3a on staging |
| ~~CHA3c~~ | ~~Retention setting + ledgered purge job~~ — **not built**, Q-CHAT15 | Q-CHAT15 |
| CH5a | Migration: `chat_spaces` (teams) + `chat_space_members`; `message_threads.space_id` + `visibility` (`public`/`private`) for `channel` threads; `messages.parent_id` (one level of replies) + the reply counters; functions: create/rename/archive a team, add/remove team members, create/join/leave a channel, browse a team's public channels, post a reply, a reply page, and `chat_inbox` widened to channels. PGlite matrix (§9.1) | CH3b |
| CH5b-1 | Migration 0520: a `chat.teams` holder manages (renames, archives, adds, removes, sets roles in) a team they are not in, reads its people, and lists every team (`chat_team_directory`) — never its channels (D-CHAT21) | CH5a on staging |
| CH5b-2 | `chat.teams` made a Permissions-page row (`STAFF` + `startsOnFor: []` becomes editable, D-CHAT21) with its own Settings → Chat teams page (list, new team, archive); API `/api/chat/teams…`, channel and reply routes, `p_manager` = the caller's answer to `chat.teams`; CH011/CH012 mapped | CH5b-1 on staging |
| CH5c | Web: the Teams rail (team → channel list → channel posts with their replies), browse and join, the reply pane, the Chat badge counting channels the D-CHAT2 way | CH5b |
| CH6 | Mentions, reactions, pins, saved, muted section, Activity, browser notifications — split below (§9.2) | CH5 |
| CH6a | Web only: "Show earlier" in a conversation, a channel's posts and a post's replies, reading the `before_seq` the API already returns (Q-CHAT16) | CH5c |
| CH6b-1 | Migration 0521: `chat_set_mute`; `message_mentions` derived from the body's `<@id>` tokens by trigger on send, reply and edit (D-CHAT22), CH013 for a token naming somebody not in the conversation (Q-CHAT20); `chat_person_state.activity_read_at`; `chat_activity`, `chat_activity_unread` + `chat_activity_mark_read` (D-CHAT25); `chat_notify_targets`, who the bell tells of a line (D-CHAT23); notification categories `chat_mention`, `chat_reply` (CHECK + contract together). PGlite matrix `office-chat-mentions.test.mjs` | CH5c |
| CH6b-2 | API + web: @ typeahead in the composer, mention chips in the bubble, mention/reply bell items grouped per conversation (D-CHAT23), the mute menu and a Muted section in the Chats list, the Activity tab | CH6b-1 on staging |
| CH6c-1 | Migration 0522: `message_reactions` (the six of D-CHAT26), `chat_pins`, `chat_saved`; ledger actions `reaction_added`/`reaction_removed`/`message_pinned`/`message_unpinned`; a reaction or pin bumps the message's `rev` so `/sync` re-delivers it (D-CHAT24); history, sync, posts and replies return `reactions` and `pinned_at` (drop + create by full signature). PGlite matrix | CH6b-1 |
| CH6c-2 | API + web: reaction bar, Pin + a Pinned panel per conversation, Save + a Saved list; reactions to your messages join Activity | CH6c-1 on staging |
| CH6d | Web only: browser notifications while the tab is open and hidden (Q-CHAT4 (a)), asked for from a button, honouring mute (Q-CHAT18) | CH6b-2 |
| CH7 | Files | CH2 |
| CH8 | Search (`tsvector` + GIN, readable conversations only; the console reuses it org-wide) | CH2 |
| CH9 | Presence, status, typing (Presence/Broadcast, ephemeral, never stored) | CH3b |
| CH10 | Web Push | Q-CHAT4 |
| CH11 | "Chat about this" on loads, drivers, trucks, cases | Q-CHAT6 |
| CH12 | AI catch-up (D-CHAT16), off by default, after release 2 | CHA3, CH5 |

**Release 2 = CHA2 + CHA3 + CH5** (compliance console, teams and channels). After that each item ships
on its own. CHA2 shipped in release 1's train (v2026.10.24), so release 2 is CHA3a–b and CH5a–c: two
migrations (0517 CHA3a, 0518 CH5a — numbers re-checked against main at merge) and five PRs. CHA3 and
CH5 do not depend on each other and can merge in either order.

### 9.1 Release 2's shape (2026-10-24)

- **D-CHAT17 — who creates a team (Q-CHAT10, ruled as recommended: admins create teams, anyone in a
  team creates channels in it, admins archive).** "Admins" is a Permissions-page surface, `chat.teams`
  (`startsOnFor: []`, admins by default, grantable per role or person — the Ask AI and
  `chat.compliance` pattern), not `isAdmin` in code: the next owner who wants dispatch leads to make
  teams changes one cell, not a deploy. The API asks it; the "New team" button reads it.
- **D-CHAT18 — a channel is a conversation.** A `channel` thread with a `space_id`. Public channels
  are listed to every team member and joined by becoming a participant, so `auth_in_thread()`,
  `chat_sync`, the ledger triggers, the realtime signals and the compliance console all work on a
  channel unchanged. A private channel is joined only by being added. Every team starts with a
  public **General** channel that its members are in.
- **D-CHAT19 — replies are messages.** `parent_id` names a top-level message in the same conversation,
  one level deep (Teams' shape). A reply takes the conversation's next `seq` and `rev`, so the
  sequence, the ledger, sync and the console see one ordered log. The channel view shows the top-level
  posts with each one's reply count and last reply; the reply pane is a page of one post's replies.
  Unread stays `last_seq − read_seq`, so a reply makes the channel unread as a post does — Teams'
  "new reply in a conversation you follow" without a second read boundary. A per-post read boundary
  is CH6's, with mentions.
- **D-CHAT20 — an export proves itself.** `manifest.json` holds each line's SHA-256 (the body the
  ledger hashed, and each earlier version's), the export's own SHA-256 of the JSONL, and the
  org's ledger head (`seq`, `hash`) at the instant of the export; the export's ledger row carries the
  manifest's hash. A court-side check is: recompute the line hashes, find them in the ledger, and find
  the export's row in the ledger with the same manifest hash. The PDF is the readable copy, the JSONL
  the evidence.
- **D-CHAT21 — `chat.teams` is a permission every office role can be given, with a page of its own
  (2026-10-25; owner chose (A) of three).** Measured while starting CH5b, D-CHAT17 could not be built
  as written: (1) only a `section(...)` gate was editable on the Permissions page (Q-SURF3,
  `isEditableSurface`) and a grant never lifts past a section (D-SURF2), so no section held by every
  office role existed to gate on — `section("settings")`, `chat.compliance`'s, would have left a
  dispatcher ungrantable, D-CHAT17's own example; (2) a surface needs a real route, and `chat.teams` had
  none; (3) 0519 asked team membership before `p_manager`, so a holder outside a team got CH001 and
  "admins archive" held only for teams the admin was in. The ruling: a `STAFF` surface that declares
  `startsOnFor` is editable too — the narrowest widening of Q-SURF3 that makes a cross-section
  permission expressible; `chat` itself declares none and stays as it is, and `lint:surfaces` keeps
  refusing `startsOnFor` on every other non-section gate. `chat.teams` is `STAFF`, `startsOnFor: []`
  (admins only until somebody is given it), `module: "messages"`, reached from Settings, path
  `/settings/chat-teams`: every team of the org, New team, archive. 0520 lets a holder manage a team's
  membership and name without being in it, and never read it (D-CHAT4; reading another person's
  messages stays the compliance console's, D-CHAT14). Rejected: (B) `section("settings")` — no model
  change, but D-CHAT17's example would need re-ruling; (C) ship channels and replies first and leave
  team creation unbuilt.
- **Matrix rows CH5a must pin:** a non-member of a team cannot see its channels; a team member sees a
  public channel's posts only after joining; a private channel is invisible to a team member who is
  not in it; a person removed from a team is removed from its channels; a reply's parent must be a
  top-level message of the same conversation; replies never nest.
- **Matrix rows CHA3a must pin:** a hold cannot be deleted or edited (only released, by a new row);
  an export without a valid reason leaves no row and returns nothing; the export row's manifest hash
  matches what the function returned; another org's conversation is CH001.

### 9.2 CH6's shape (2026-10-25)

Measured on main at d85df01 (schema 0520) before splitting:

- **Mute is a column with no door.** 0511 gave `thread_participants.muted` (`none`/`mentions`/`all`) and
  `chat_inbox` returns it; the API's `unread_total` already leaves `all` out of the badge. Nothing
  sets it: no function, route or menu. So CH6b-1's `chat_set_mute` is the first writer.
- **Paging back is built on two of three floors.** `chat_history`, `chat_channel_posts` and
  `chat_replies` take `p_before_seq`, the three API routes pass `before_seq` through, and the answer
  carries it. Only the web stops: `ChatConversationPane` prints "Earlier messages are not shown yet",
  and the channel and reply panes show the first page only. CH6a is web-only for that reason.
- **The bell is ready for chat.** `notify()` → `emit_notification` already applies the org's
  categories, the person's muted categories and quiet hours, and the dedupe ledger (0432);
  `notificationRoute.ts` maps a category to an office page; `notificationCategoryCheck.test.ts` holds
  the contract and the latest CHECK together, so the categories and their CHECK land in one PR.
- **Every change to a line already travels one log.** A send, edit or retract bumps the thread's `rev`
  and the line's (0511 `messages_guard_update`), and `/sync` returns lines with `rev > since`. A
  reaction or a pin that bumps the same `rev` reaches every open tab with no new transport.
- **Nothing exists** for mentions, reactions, pins, saved or Activity — no table, column or code.
  A body token format can be chosen now with no rewrite: a line written before it carries no token,
  so it simply has no mentions.

Decisions (**ruled 2026-10-26, as recommended** — owner: "Proceed as recommended"):

- **D-CHAT22 — a mention lives in the body, as `<@user-id>`.** The body stays the one record of what was
  written: the ledger's `body_sha256` already covers the mention, an edit that adds or drops one needs
  no second write, and the export, the PDF and the console show it in place. `message_mentions` is an
  index a trigger derives from the body on insert and on edit — never written by hand — so "who was
  mentioned" cannot disagree with "what was said". A token must name a current participant
  (narrowed by Q-CHAT20 from "or, in a public channel, a member of its team"); anything else refuses
  the send (CH013) rather than leaving a dangling name, and an edit is judged only on the tokens it
  adds. The web renders the token as the person's name; the
  console and the PDF resolve it from the conversation's members. Rejected: a `mentions: uuid[]` field
  beside a plain-text body — two records of one fact, and the ledger would hash only one of them.
- **D-CHAT23 — the bell gets one item per conversation per unread stretch.** D-CHAT7 already says only
  mentions and replies to you reach the bell. The dedupe key is `chat_mention:<thread>:<your read_seq>`
  (and `chat_reply:…`): five mentions before you look are one bell item, and the first after you read
  is a new one. Derived from the read boundary that exists, not from a counter. Two categories so
  either can be muted on the notification preferences page. Never for your own line; never in a
  conversation muted `all` (Activity still lists it); `mentions` still rings for a mention.
- **D-CHAT24 — conversation acts are ledgered; a person's own state is not.** Reactions and pins are
  seen by everyone in the conversation, so they are ledgered (four new actions) and re-delivered by
  `/sync` through the line's `rev`. Saved, mute, read and Activity-read are one person's bookmarks —
  as `read_seq` is today, they are not ledgered and never shown to anyone else, the console included.
- **D-CHAT25 — Activity is derived, not stored.** Mentions of you, replies to a post you wrote or
  replied to, and (from CH6c) reactions to your lines, in conversations you are still in, newest
  first, keyset-paged. One function over `message_mentions`, `messages.parent_id` and
  `message_reactions`; no feed table to keep in step. Read state is one instant per person
  (`chat_person_state.activity_read_at`): unread Activity = items after it. This is also D-CHAT19's
  deferred "per-post read boundary" answered by Q-CHAT17 (a).
- **D-CHAT26 — six reactions, fixed.** 👍 ❤️ 😂 😮 😢 ✅ (the last for "done", which an office uses
  more than 😡). A key in the shared contract and the CHECK, held together by a parity test like
  the notification categories'. A free emoji picker is a later widening of one list, not a rewrite.

- **Matrix rows CH6b-1 must pin:** a token for a non-participant (a team member who has not joined a
  public channel, one not in a private channel, another org) is CH013 and leaves no line; an edit that removes a mention removes its index
  row and one that adds one adds it; a retracted line's mentions leave Activity; Activity never
  lists a conversation the reader has left; another person's mute or Activity-read is untouched by
  mine; another org is CH001.
- **Matrix rows CH6c-1 must pin:** one reaction of a kind per person per line; reacting bumps the
  line's `rev` and writes one ledger row; a retracted line refuses reactions and pins; saving is
  invisible to every other reader; the ledger refuses UPDATE/DELETE of the new actions as of all others.

## 10. Open questions

| ID | Question | Candidates | Recommendation |
|---|---|---|---|
| Q-CHAT1 | Who uses it? | | **RULED 2026-10-23, as recommended:** (a). Drivers keep their dispatch thread (D54) |
| Q-CHAT2 | Who may audit messages? | | **RULED 2026-10-23:** a permission on Settings → Permissions (`chat.compliance`): admins by default, the owner grants it to other roles or people there |
| Q-CHAT3 | Release 1 scope | | **RULED 2026-10-23, as recommended:** DMs + groups, live, ledgered; console + channels in release 2 |
| Q-CHAT4 | Alert when the tab is closed | | **RULED 2026-10-23, as recommended:** (a) first, (b) CH10 |
| Q-CHAT5 | Retention | | **RULED 2026-10-23, as recommended:** (a) |
| Q-CHAT6 | Does seeing a load grant its chat? | | **RULED 2026-10-23, as recommended:** (a) |
| Q-CHAT7 | Are the two production orgs separate companies? | | **RULED 2026-10-23, as recommended:** Assumed yes |
| Q-CHAT8 | Calls and meetings | | **RULED 2026-10-23, as recommended:** (a) |
| Q-CHAT9 | Realtime connections | | **RULED 2026-10-23, as recommended:** (a) |
| Q-CHAT10 | Who creates teams and channels? | | **RULED 2026-10-23, as recommended:** (b) |
| Q-CHAT11 | Four-eyes approval for compliance access? | | **RULED (a):** no; logged, and visible to other holders |
| Q-CHAT12 | Monitoring notice | | **RULED:** none in the product; it is in the employment contract (all users are employees) |
| Q-CHAT13 | AI catch-up | | **RULED (b):** build CH12 off by default, after release 2 |
| Q-CHAT14 | The API answers a burst of `/sync` requests slowly: on the one uat instance, 20 at once took 1.6 s (median) and 40 at once took 6.2 s, against 1.2 ms of database time each (load test 2026-10-23, §11). At the design target, a message to a 300-member channel that 300 people have open is 300 at once. What fixes it? | (a) **Measure first:** time each stage of a `/sync` request (`requireAuth`'s membership check, `requireModule`, `requireSurface`, the function) on uat, and see whether the time is in those database round trips, in the connection pool, or in the event loop the in-process schedulers share. (b) Cache the per-request answers that change rarely (module entitlement, surface claim) for a few seconds per user. (c) The client waits a random 0–1 s before it syncs, so a burst arrives spread out. (d) More API replicas (`API_REPLICAS`). (e) Carry the content in the signal for small conversations. That gives up D-CHAT2's reason: a removed member could read on until their token refreshes | **RULED 2026-10-23, as recommended ("proceed as recommended, best solutions possible"):** measured (a), then (c) and (b). Not (d) yet, not (e). See §11 |
| Q-CHAT15 | CHA3 listed "retention setting + ledgered purge job", but Q-CHAT5 was ruled (a): **keep forever**, pinned in `RETENTION_FORBIDDEN` until counsel names a period. Built now, the purge job is code that may never run and the one path that deletes evidence. Build it now? | (a) **Not now.** Holds and export are built; the setting and purge job wait for counsel's period, and are then one PR (0511's `silvicom.chat_retention` exception and the `retention_changed`/`retention_purged` ledger actions already exist for it). (b) Build the setting and the job now, switched off. (c) Build the setting only, with no job | **RULED (a) 2026-10-26.** A purge job nobody may switch on is still a deletion path to review, test and keep working, for no use; when counsel names a period it is one PR on ground already laid. Revisit at 10,000 messages in production (today: 1 direct thread) or on a legal request |
| Q-CHAT16 | Release 2 left "Earlier messages are not shown yet" in a conversation, and a channel or a reply thread shows its first page only (50 lines). Does paging back belong in CH6? | (a) **Yes, first, as CH6a.** Web only — the SQL and the API already page (§9.2) — and it is the one gap a user hits today in all three panes. (b) A separate item after CH6. (c) Leave it until somebody asks | **RULED 2026-10-26, as recommended: (a).** Smallest step, no migration, and it lands before mentions make people scroll back to find what they were tagged in (Activity opens a line that may be older than the first page, so CH6b-2 needs it anyway) |
| Q-CHAT17 | D-CHAT19 deferred a per-post read boundary ("new replies to a post you follow") to CH6. Build it? | (a) **No: Activity carries it.** Replies to a post you wrote or replied to are Activity items with Activity's one read instant (D-CHAT25); the channel stays unread by `last_seq − read_seq`. (b) A `chat_post_reads(user, post, read_seq)` row per post, so each post shows its own "3 new replies". (c) Both | **RULED 2026-10-26, as recommended: (a).** (b) is a write per post opened and a second unread count to reconcile with the first, for a badge Activity already gives the person who cares about the post. Revisit if people ask for per-post counts after using Activity |
| Q-CHAT18 | Browser notifications (CH6d): what does one say, and when? | (a) **Sender and conversation, plus the first 80 characters**; direct and group lines ring unless muted, channel lines only for a mention or a reply to you; never while the conversation is open and the tab visible. (b) As (a) but no text — "New message from Ana in Dispatch". (c) A per-person choice between (a) and (b) | **RULED 2026-10-26, as recommended: (a).** It is the person's own screen, behind their login, and the text is what makes the notification worth reading; the same rules as the bell (D-CHAT23) so one person's mute means the same thing in both. (c) is one setting more if a shared-screen office asks |
| Q-CHAT19 | `@channel` / `@team` (one mention reaching every member)? | (a) **Not in CH6.** Names only. (b) In channels, team owners only. (c) Anyone, as Teams' default | **RULED 2026-10-26, as recommended: (a).** In a 300-member channel it is a bell item for each of 300 people from one line, and nobody has asked. (b) is one token kind more when somebody does |
| Q-CHAT20 | Found building CH6b-1: D-CHAT22 let a token in a public channel name a team member who has not joined it, but CH5a lets a team member read a public channel only after joining — so the bell and Activity would point somebody at words they may not read. Which way? | (a) **A mention names somebody in the conversation only.** In a channel the composer offers to add a team member who is not in it ("Add Ben to # Loads"), which any channel member may already do; then the mention works. (b) Allow it; the bell and Activity say "Ana mentioned you in # Loads" without the words, with a Join button. (c) A mention joins the person to the channel | **RULED 2026-10-26, as recommended: (a).** One rule for every kind of conversation, Activity lists only what you can open, nothing is readable before joining. (b) is a second kind of item that says something was said without saying it; (c) puts a person in a channel by somebody else's sentence |

## 11. Progress log

- 2026-10-23: plan opened; existing messaging, production usage and the AWS shape measured (§1).
- 2026-10-23: owner: "like Microsoft Teams … more and more users". Delivery moved from Postgres Changes to Broadcast-from-database; added scale (§3) and the Teams map (§4).
- 2026-10-23: owner: "enterprise grade, lightweight, good audit logs, Admin able to audit messages, not expensive, research the last six months". Added §5 (ledger, console, holds, notice), §6 (cost from Supabase's billing page: Pro includes 5 M Realtime messages and 500 peak connections, then $2.50/M and $10/1,000, counted per recipient), §7 (practices), D-CHAT12–16, CHA1–3, CH12, Q-CHAT11–13. D-CHAT2 now carries signals only, so the subscribe-time authorisation gap cannot leak content. `audit_logs` measured at 5.07 M rows / 1.23 GB, which is why the ledger is its own table.
- 2026-10-23: owner ruled Q-CHAT2 (a Permissions-page permission decides who audits; admins by default, like Ask AI), Q-CHAT11 (a), Q-CHAT12 (no in-product notice; the employment contract covers it), Q-CHAT13 (b). §5.2, §7, D-CHAT14, CH2, CHA2 and CH12 updated. Still open: Q-CHAT1, Q-CHAT3–Q-CHAT10.
- 2026-10-23: owner: "rest as recommended, start release 1". Every Q-CHAT is ruled. Release 1 (CH1a → CH3b + CHA1) started.
- 2026-10-23: CH1a #1734 merged (0511 schema, versions, ledger; 0512 functions) and applied to staging (`verify:live staging`: schema 0512). CH1b #1735 merged (`/api/chat`). CH2 (the `/chat` page) built with a browser pass on a stubbed API at 1440×900, 1920×1080 and 390×844. The pass found three things jsdom could not: list rows squeezed onto one cut-off line (fixed with AppButton `size="row"`), Send under the Ask AI launcher (the panel now stops at `--assistant-clearance`), and list and conversation too short side by side on a phone (a phone shows one or the other, with Back). Moving the nav counts into `useNavCounts` and the catalogue lookups into `surfaceLookups.ts` kept two files at their 500-line budget. Next: CH3a (broadcast trigger + `realtime.messages` policies) and CHA1 (nightly verifier).
- 2026-10-23: CH2 #1736 and CH3a #1737 merged (0513 on staging, `verify:live staging`: commit 1ddf418, schema 0513). CH3b built: `features/chat/transport.ts` is the only file that touches Realtime (D-CHAT10). It joins `chat:user:<me>` from the signed-in shell, so the sidebar badge is live on every page, and `chat:conv:<open>` from /chat, both `private: true` after `setAuth()`. `chatRealtime.ts` decides what a signal means: refetch the inbox, or `/sync?since_rev=` and merge into the cached page. A merge that would leave a seq hole is refused and the page is refetched. A channel that comes back after a drop triggers one catch-up. Polls relax to 60 s only while the link is `live`. The page says "Reconnecting…" only when a channel has failed, not while it first joins. Load test: `scripts/chat-load-test.mjs` (staging only, its own org, test users deleted or banned at the end). **Not run yet:** the session's permission check refused to create 300 accounts on staging, so the owner runs it. p95 delivery, Realtime message count and DB CPU go here when it has run.
- 2026-10-23: CHA1 built: `chat-ledger-verify` in the `general` lane (`modules/messaging/chatLedgerVerify.ts`). The lane's lease (0506) keeps it in one process. It runs at 05:00 Central every night, the fixed-hour shape of the storage reconcile, because the api rarely lives 24 h. Per org it calls `chat_ledger_verify(org, 0)` over the whole chain. On a problem it logs `[chat-ledger] … ` with `console.error` and sends a `system`, `critical` notification to each admin, deduped `chat_ledger:<org>:<day>`. An unreadable chain is an error and is never reported as intact. ⚠ The admin recipients are a labelled interim: CHA2 replaces them with the holders of `chat.compliance`. Not in CHA1: a platform-console page for a mismatch (§5.1 "pages through platform-health"); today the signals are the log line and the admins' bell. Measured that day: production and staging have 0 messages, so no message predates the ledger.
- 2026-10-23: **Staging load test** (`scripts/chat-load-test.mjs`, owner-run, its own org; 300 test users, all deleted afterwards). 300 clients joined `chat:user:<me>` and one 300-member channel's `chat:conv:` in 8 s, with no join refused. The channel round sent 40 messages, 1.5 s apart: 11,700 of 12,000 signals arrived (300 short, consistent with one message announced to nobody, which the poll covers). Send → signal was **p50 295 ms, p95 619 ms, p99 704 ms**. The 50-member group round, where each member also hears on their own topic: its delivery numbers are not usable. The script expected one signal per member instead of two, and the test machine was itself saturated, so its own delay inflated every figure. The script is fixed (seq registered before the send, two signals per group member, sync only on the conversation's signal as a tab does, its own event-loop delay reported) and owed a rerun.
  - **Database:** chat's share was small. Per pg_stat_statements: `/sync`'s function 2,380 calls at 1.2 ms; `chat_send` with 0513's 51 announcements per group message 80 calls at 14 ms mean, 50 ms max; `realtime.authorize` 655 joins at 0.7 ms. The whole-machine CPU the script read (70% / 94%) includes staging's own Samsara/HOS schedulers, which lead pg_stat_statements by far, so it is not chat's cost.
  - **The API is the bottleneck:** per Railway's HTTP log, `/sync` took p50 1,582 ms / p95 2,313 ms with 20 at once, and p50 6,183 ms / p95 12,809 ms / max 25 s with 40 at once, on one uat instance, all 200. So the time to see a message was about 2 s in the channel round, mostly waiting for the API. Q-CHAT14.
  - **Realtime message count:** not measured by the script; read it from the staging project's usage page. By construction: 40 channel messages × 300 recipients + 40 group messages × 50 × 2 = 16,000, plus the joins.
  - **Cold start:** the first smoke run's joins were all refused (`MissingPartition`). Realtime makes the daily `realtime.messages` partitions only while a project's Realtime service runs, and staging's had been idle. **Production's partitions stop at 2026-09-18** (measured the same day), so the first Chat tab after release will be refused once. realtime-js rejoins on its own, the page shows "Reconnecting…" and catches up when it joins, and any message sent before the partitions exist arrives by poll.
- 2026-10-23: **Q-CHAT14 ruled and built.** (a) The measurement was already in the logs: the `[metrics]` lines of the deployment under test show the event loop's worst delay at 21–59 ms a minute while `/sync` held at about 11 requests/s and its median climbed from 1.6 s to 6.1 s. So the ceiling was downstream, in PostgREST and the database, not in Node. Each `/sync` made four PostgREST calls, three of them sequential: membership (already cached 15 s, SP7), module entitlement (`requireModule`, not cached) and two surface-access reads (`surfaceClaimFor`, not cached), before its 1.2 ms chat function. Fixes:
  - (b) `lib/ttlCache.ts`: a per-process 15 s cache, the SP7 life. Concurrent misses share one read, a failed read is never cached, and a write that lands mid-read stops it from storing. `requireModule` caches per (org, module). Entitlements are written by `admin-api`, so the 15 s expiry is the only bound there. `surfaceClaimFor` caches per (org, role, person) and never caches a claim read while a table failed. `writeAccessCell` forgets the org's claims at once. The session endpoint and `requireSurface` share it, so the sidebar and the gate agree. A warm `/sync` is now one PostgREST call instead of four, and this applies to every API route, not only chat.
  - (c) `chatRealtime.ts` `spread`: each tab waits a random 0–1 s before fetching what a signal announced, and coalesces signals while it waits. A signal for a rev the tab already holds fetches nothing. A reconnect is spread the same way.
  - Owed: the load test rerun to measure the result (owner runs it; the script is fixed, #1741).
- 2026-10-23: **"Allow public access" off ("set this properly", owner).** Read through the Management API (`/v1/projects/<ref>/config/realtime`).
  - **Staging:** `private_only` was null and an anonymous public join was SUBSCRIBED. The owner asked for the change, so it is set (`PATCH` 204, read back `true`, limits unchanged).
  - **Production was held** (and then set early — see the 2026-10-23 entry below). The driver app's message channel (`useMessages.ts`) is PUBLIC (`messages-inbox`, `messages-<thread>`, Postgres Changes) and is the only other channel in the repo, so switching production would silently drop every installed driver app to its poll. 0514 adds per-person private topics (`driver:inbox:<me>`, `driver:thread:<id>`) and their `realtime.messages` policy, and the driver hook joins them. Production order: 0514 released, then a driver build/OTA with the hook, then `private_only` on production.
  - **Found on the way:** production's Realtime tenant still has **Free-plan limits** (200 connections, 100 messages/s, 100 joins/s, 256 KB payload). The organisation is on Pro (API: `plan: pro`), and staging has 10,000 / 2,500 / 2,500 / 3,000 KB. At 100 messages/s and 200 connections, production cannot reach §3's design target. Raise it to the Pro quotas (500 / 500 / 500 / presence 50 / 3,000 KB, Supabase "Realtime limits"). This session's permission check refused a production change, so the owner runs it.

- 2026-10-23: **the owner set production's `private_only` on early**, before the 0514 release and the driver OTA. Measured first: production has 0 driver threads, 0 messages and 1 driver login, so an installed driver app falling back to its poll costs nobody anything. Both environments now refuse public channels. The production Realtime limits were raised to Pro's the same day (500 connections / 500 msg/s / 500 joins/s / 3,000 KB, then `max_bytes_per_second` 1,000,000).
- 2026-10-23: **Audit of release 1** against the owner's six words (enterprise grade, safe, auditable, lightweight, reliable, modern). Held: lightweight (4 migrations, ~3,100 lines, no new dependency or service), architecture (one engine, rules in SQL once, realtime behind one seam), safety (every rule in the matrices), reliability by design. Not yet earned: "auditable" — the record exists but no admin can read it in the product until CHA2, and the chain verified only against itself; and "enterprise grade" as PROOF — the Q-CHAT14 rerun is owed and nothing has run in production. Two holes became CHA4, built the same day:
  - **The anchor** (`modules/messaging/chatLedgerAnchor.ts`): each night, after `chat_ledger_verify` passes, the verifier puts `chat-ledger-anchors/<org>/<day>-<seq>-<hash>.json` in the storage backup's S3 bucket (#1704's: another account and region, versioned, Object Lock 90 d, an IAM user that cannot delete). The next night, BEFORE trusting the chain, it lists that prefix (the anchor is its key, so no GetObject), checks the ledger still holds the anchored seq with the anchored hash and that the head has not moved back, and reports `ledger truncated below its anchor` / `anchored ledger entry altered|missing` as a critical problem like any chain break. A rewrite is now confined to the hours since the last anchor. With no bucket (staging) the log line says "chain self-checked only". `schedulers.ts` hands the target across; messaging may not import org.
  - **Signal health** (0515): `chat_signal()` records each send it could not make in `platform_realtime_health` (the error sentence, never the message); `realtime-probe` (general lane, every 15 min) joins `platform:realtime-probe` with the service role, has `realtime_probe_send(nonce)` broadcast from Postgres, and records whether and how fast the nonce came back through the real Realtime service and websocket. `GET /api/version` → `realtime`: `pending` (no probe yet, or the table not applied yet — 42P01 is held behind its migration), `ok`, `degraded` (probe fine, some send failed today; healthy, visible), `failing` (the broadcast did not arrive), `stale` (the probe stopped), `unknown` (unreadable). `failing`, `stale` and `unknown` turn `ok` false, so `platform-health.yml` pages on a Realtime that has stopped delivering. **Staging check done 2026-10-24 (02:42–02:51 UTC):** the service role joins the private probe topic (no policy needed). The FIRST probe, 90 s after the deploy, joined and announced but heard nothing in 10 s (`failing`); the same probe run by hand two minutes later arrived at once, and the next scheduled probe passed at 121 ms (`ok`). So the first database broadcast after an idle spell is dropped by a cold Realtime tenant — the cold-start case the load test met as `MissingPartition`, seen from the other side — and a deploy onto an idle staging reads `failing` for one tick. `platform-health.yml` watches production only and needs two non-ok reads 15 min apart, so one cold tick does not page; a second in a row would, and should.
  - Still owed from the audit: the Q-CHAT14 load-test rerun (owner runs `scripts/chat-load-test.mjs` on uat).
- 2026-10-23: **CHA2 built** — Settings → Chat compliance (`/settings/chat-compliance`, surface `chat.compliance`: `section("settings")`, `startsOnFor: []`, `module: "messages"`, reached from the Settings directory, so it has its own row on the Permissions page and the admin holds it by default, Q-CHAT2). Migration **0516**: `chat_compliance_conversations`, `chat_compliance_messages`, `chat_compliance_thread`, `chat_compliance_access_log`, service-role only. Each read that returns words appends its `compliance_search` / `compliance_view` row — actor, reason `{category, text}`, filters, page — in the same transaction, BEFORE returning; a reason outside the five categories or under ten characters is CH009 and leaves no row. The API (`/api/chat/compliance`, mounted ahead of the chat's own router) asks the settings section, the surface, and `requireFreshAuth()` on every content route; the reason travels in the body; each answered act also writes `audit_logs` (`chat_compliance.search|view`, category and reason in `meta`), and when that row cannot be written the content is withheld (503). The console sees every conversation of the org — driver threads too (§5.3) — retracted messages with their words, and every version an edit replaced; a keyword search finds a phrase that survives only in an earlier version; `%` and `_` are letters. The Access log is read by every holder and leaves no row of its own. The page: one reason card (matter + sentence) that gates every search; Conversations, Messages and Access log tabs; a conversation opens whole in a modal, oldest first, with who left when. A `step_up_required` refusal becomes the password prompt and the same act runs again. CHA1's labelled interim (admins) is gone: `surfaceHolders(admin, org, "chat.compliance")` in the org module resolves the recipients through the Permissions page's own resolver, and `schedulers.ts` hands it across. Not in CHA2: export, holds, retention (CHA3).
- 2026-10-24: **Release 1 and CHA2 shipped to production** as v2026.10.24 (b347ef5, release PR #1750; migrations 0511–0516 applied first). The Realtime probe's first two production ticks failed — 13:57Z `MissingPartition` (production's Realtime had made no `realtime.messages` partition since 09-18; the first join made 10-24…10-27), 14:11Z no signal within 10 s — and the 14:26Z tick was `ok`: the cold start staging showed, once more. The same release built the AWS production image with `PRODUCTION_VITE_API_URL` = `api.360.silvicominc.com`, which has no certificate until the GoDaddy delegation, and `360.silvicominc.com`'s CSP refused it: the page was blank on AWS until the 3f517ed image was redeployed and the variable set back to the Railway API (AWS migration plan). Chat was reachable on the Railway web host throughout; it reaches `360.silvicominc.com` with the next release's image.
- 2026-10-24: **Release 2 broken down** (§9, §9.1): CHA3a–b, CH5a–c, D-CHAT17–20. Q-CHAT15 asked: the retention purge job is not built while Q-CHAT5 keeps everything forever.
- 2026-10-24: **CH5a merged** (#1754, 0518 + 0519); staging's migration run then failed on 0518's
  channel-shape rule over the load test's table-inserted channel. Fixed 2026-10-25 by #1755: the rule
  is added `not valid` (a history edit otherwise) and the load test makes its channel with
  `chat_team_create`. Staging at 0519.
- 2026-10-25: **D-CHAT21 ruled** (§9.1) and CH5b split in two: CH5b-1 is migration 0520 (a `chat.teams`
  holder manages teams they are not in; `chat_team_directory`), matrix `office-chat-teams` 79, two
  mutations caught (archive back on the member-only lookup; the org filter dropped from
  `chat_manage_space`).
- 2026-10-25: **CH5b-1 merged** (#1756, 0520 on staging). **CH5b-2 built**: `isEditableSurface` also
  answers for a `STAFF` gate that declares `startsOnFor` (`lint:surfaces` refuses it on every other
  non-section gate); surface `chat.teams` (`STAFF`, `startsOnFor: []`, `module: "messages"`, reached
  from Settings, `/settings/chat-teams`). One measured side effect: the Settings entry's ROLE half now
  reaches every office role (a technician can be given Chat teams); the entry still opens only when a
  screen behind it does. API: `routes/chatTeams.ts` — `/api/chat/teams` (rail + `can_manage`),
  `/teams/directory` and `POST /teams` behind `requireSurface("chat.teams")`, every other team act
  passes `holdsSurface("chat.teams")` as `p_manager`; `/api/chat/channels/:id/{join,members,leave,
  archive,posts,posts/:postId/replies}`. Mounted ahead of the conversation router. CH011 → 422
  `reply_not_allowed`, CH012 → 409 `name_in_use`. A reply counts in the `chat_message` budget.
  `chatMessageSchema` carries `parent_id`/`reply_count`/`last_reply_at` so history and sync place a
  channel's lines. Web: Settings → Chat teams (`ChatTeamsPage.vue`: list, New team, Archive);
  `PeoplePicker.vue` now shared by New conversation and New team.
- 2026-10-25: **CH5b-2 merged** (#1757, on staging at 0520). **CH5c built**: /chat gains Chats | Teams
  tabs (`?view=teams`); the Teams side (`features/chat/teams/ChatTeamsView.vue`) is the rail (teams →
  the channels you are in, General first, unread per channel; public channels you are not in folded
  under "N more channels to join"), the open channel (`?ch=`: top-level posts with reply count and last
  reply, a post box) and, beside it from `xl` and instead of it below, one post's replies (`?post=`).
  New channel (public, or private with people from the team), Add people (team owners), Leave channel
  (never General), Leave team, and New team for a `chat.teams` holder (the API's `can_manage`).
  A channel you are not in is offered with Join and never read. The Chats list asks the inbox for
  `kinds=direct,group` (new API filter); the sidebar badge keeps every kind, so channels count in it
  the D-CHAT2 way — `last_seq − read_seq`, a reply included. Realtime: a signal for an open channel
  refetches its posts/replies (they sit under `conversationKey(id)`, so there is no page for `/sync`
  to merge into), and a signal to me refreshes the rail with the inbox. The bubble, the composer and
  the pending line were lifted out of `ChatConversationPane` so all three views share them.
- 2026-10-25: **CH5c merged** (#1758, d85df01, on staging at 0520) — release 2 complete on staging.
  **CH6 planned** (§9.2): measured first (mute has a column and no writer; paging back exists in SQL
  and API, not the web; the bell and `/sync`'s `rev` carry chat with no new transport), then split
  into CH6a (paging, web), CH6b-1/-2 (0521: mentions, mute, Activity; then its reader), CH6c-1/-2
  (0522: reactions, pins, saved; then its reader) and CH6d (browser notifications, web). Proposed
  D-CHAT22–26 and Q-CHAT16–19, each with a recommendation. Migration numbers re-checked against main
  at each merge. Plan merged (#1759).
- 2026-10-26: owner: "Proceed as recommended" — D-CHAT22–26 and Q-CHAT16–19 (a) ruled. **CH6a built**
  (web only): "Show earlier messages / posts / replies" at the top of the conversation, the channel and
  the reply pane, from the `before_seq` each page already carried (`features/chat/earlierPages.ts`). The
  earlier pages are held in the same query entry as the newest one, prepended, so `applySync` still
  sees one gapless page; `keepEarlier` is each query's `structuralSharing`, which TanStack applies to
  every write of the entry (a fetch and `setQueryData` alike), so the 10 s poll's newest page joins the
  earlier ones instead of replacing them — and lets them go, rather than showing a hole, when more than
  a page arrived since. A page that lands above keeps the reader's line in place; a refresh where
  neither end moved does not move the list (before, any re-render jumped to the bottom). A `?post=`
  link to a post older than the channel's first page offers "Show earlier posts" too.
- 2026-10-26: building CH6b-1 found D-CHAT22 at odds with CH5a's join rule; raised as Q-CHAT20 and
  ruled (a) the same day (owner: "analyze and proceed as recommended"). **CH6b-1 built**: migration 0521
  — `message_mentions` kept equal to the body by two triggers (BEFORE refuses with CH013, AFTER adds and
  removes rows; driver conversations and system lines never read), `chat_set_mute`, Activity as one
  item function behind both the list and its unread count, `chat_activity_mark_read` forward-only and
  never past now, and `chat_notify_targets` so CH6b-2's API asks who the bell tells instead of
  restating D-CHAT23. Categories `chat_mention` / `chat_reply` widened with the contract. Matrix
  `office-chat-mentions.test.mjs`, every rule mutation-checked.

Sources consulted 2026-10-23: Supabase docs (Realtime limits, Postgres Changes, Broadcast,
Authorization, billing); CometChat "Chat UI Architecture in 2026"; Stream "How to Sync Chat State After
a User Goes Offline" and "Chat Application Architecture"; SystemDesignSchool chat-app design; Hanzo /
ViewExport 2026 Slack eDiscovery guides; Microsoft Purview eDiscovery guides; pg-tamper-evident-audit
and 2026 hash-chain write-ups; 2026 employee-monitoring legal guides (Time Doctor, CurrentWare);
TechRepublic / Windows Report on Teams 2026 updates.
- 2026-10-26: **the page redesigned** — `CHAT-REDESIGN-PLAN.md` (audit 17/30 → REDESIGN; D-CHATUI1–15; CR1 built). `/chat` is a full-bleed workspace: one rail of conversations, every team's channels and the muted ones (the Chats | Teams tabs and `?view=` are gone; `?c=`, `?ch=`, `?post=` are unchanged), message rows in runs under day lines with a "New" line where unread started, a composer that grows, the thread as a side panel. Web only; no API or schema change; CH6b–d land on the new rows.
- 2026-10-26: **Q-CHAT15 ruled (a)**: no retention setting or purge job until counsel names a period; revisit at
  10,000 production messages or a legal request. The redesign plan's Q-CHATUI1–4 were ruled the same day
  (`CHAT-REDESIGN-PLAN.md` §8).
- 2026-10-27: **CH6b-2 split in two; the API half built** (`claude/office-chat-ch6b-2-api`). Routes:
  `PUT /api/chat/:id/mute`, and `GET /api/chat/activity` (keyset page + badge), `/activity/unread`,
  `POST /activity/read`, mounted ahead of `/:id`. The bell: after a new line, a post or a reply,
  `chatNotify.ts` asks 0521's `chat_notify_targets` and hands each row to `notify()` with the key the
  database chose — titled from the sender's view ("Ana mentioned you in # Loads", "Ana replied in
  # Loads"), the first 80 characters with every token as `@Name` (the bell follows Q-CHAT18 (a)), and the
  conversation as the entity (`chat_channel` / `chat_conversation`) because one item stands for a
  stretch of lines, so the web bell opens `?ch=` or `?c=`. A retried send rings nothing; a bell that
  fails never fails the line; an edit rings only for the people it newly names (D-CHAT22) — the one
  table read in chat's code, org-filtered, and only when the new words carry a token. The shared token
  reader (`chatMentionIds`, `chatBodyText`) takes the id from `isRecordId` rather than a second id
  regex (D-US13). The web half — typeahead, chips, mute menu and Muted section, Activity tab — is next.
- 2026-10-27: **CH6b-2 API half MERGED** (#1777, main 15d1627). **Mentions on the web built**
  (`claude/office-chat-ch6b-2-mentions`): a token is drawn as a chip of the person's name (the
  reader's own stronger), in the rail's preview as `@Name`, and as `@someone` for a person the
  office's people list no longer holds — never the id. `@` in the composer lists who this
  conversation may name: its members, and in a channel the team's others as "Add to # Loads", added
  through the channel's own route before they are named (Q-CHAT20 (a)); members first; Enter/Tab
  picks, Esc closes only the list. The field shows `@Name` and the line carries `<@id>`
  (`mentionDraft.ts`); an edit round-trips the same way, so editing around a mention keeps it. Names
  come from `/api/chat/people`, now asked when the page opens; a channel's people from the new
  `GET /api/chat/:id/members`. The browser pass (fixtures `tools/chat-fixtures`, now `MOCK_PORT`)
  found what jsdom could not: the list read the model before v-model wrote the key just typed, so a
  pick came out "@@Dana Whitfield"; it reads the field itself now, and the composer test types one
  input event per key as a browser does (six cases failed before the fix). Still owed by D-CHAT22:
  the compliance console and the PDF show a token raw — they resolve names from the conversation's
  members in a later step. Next: the mute menu and Activity (CH6b-2's third PR).
- 2026-10-27: **Mentions MERGED** (#1781, main 53b260b). **Mute and Activity on the web built** — the
  last of CH6b-2 (`claude/office-chat-ch6b-2-activity`). Every conversation's and channel's header has
  a menu with its mute — "Notify me of everything", "Only when I'm mentioned", "Mute" — General
  included (Leave stays off General); `all` moves it to Muted as before. Activity is a rail item above
  Chats with its count, and a place on the stage at `?activity=1`: who, what and where ("Ben replied
  in # Loads"), the words with their chips, newest first, a page at a time; pressing one opens the
  conversation, the channel, or the post's thread. Showing the list reads it up to the newest item
  shown, and an item that was unread then keeps its dot until Activity is closed — the "New" line's
  rule (D-CHATUI6); the browser pass found the first build wiping the bold within a second. A signal
  on your own topic now refreshes Activity with the rail (pinned by a test of the handlers, which had
  none). Fixtures: Activity and mute in `tools/chat-fixtures`. **CH6b-2 is complete**; next CH6c-1
  (0522 is taken by finance's #1698 — check the next free number first) or CH6d.
- 2026-10-27: **CH6b-2 MERGED** (#1783, main 98db8dd; staging verified at schema 0521). **CH6c-1 built**
  (`claude/office-chat-ch6c-1`, migration **0523** — 0522 went to inventory's #1790 first). Three
  tables: `message_reactions` (the six of D-CHAT26 as keys `thumbs_up` `heart` `laugh` `surprised`
  `sad` `done`; one of a kind per person per line by primary key), `chat_pins` (one per line, anybody
  in the conversation sets or takes it off) and `chat_saved` (one person's bookmark). Reactions and pins
  are written by `chat_react` / `chat_pin` and ledgered by TRIGGER as `reaction_added` /
  `reaction_removed` / `message_pinned` / `message_unpinned`, each moving the line's `rev` to the
  conversation's next, so `/sync` re-delivers the line; the realtime signal now also fires on `rev`
  alone (`trg_chat_signal`), or a 👍 would reach other tabs only at the next poll. A save moves no `rev`
  and writes no ledger row (D-CHAT24). A retracted line refuses all three (CH004, as an edit) and stops
  showing what it had; an archived conversation refuses reactions and pins (CH005), not saves.
  `chat_history`, `chat_sync`, `chat_channel_posts` and `chat_replies` gain `reactions`
  (`[{reaction, users}]` in D-CHAT26's order), `pinned_at` and the caller's own `saved`; `chat_pins`
  and `chat_saved` (keyset-paged) list them. `CHAT_REACTIONS` in the shared contract is held to the
  CHECK, `chat_react`'s list and the readers' order by `chatReactionCheck.test.ts`. Matrix
  `office-chat-reactions.test.mjs` (57 rows, §9.2's five among them) plus three realtime rows; ten
  mutants of 0523 each failed a row. **Not in 0523: reactions in Activity** (D-CHAT25's third reason) —
  the API parses `reason` against `CHAT_ACTIVITY_REASONS`, so a function emitting `reaction` before the
  API knows it would fail every Activity request for the deploy minutes. CH6c-2 therefore widens the
  contract (and gives the item who reacted, which today's shape has no column for) first; the function
  follows in a migration of its own after it. Next: CH6c-2 once 0523 is on staging.
