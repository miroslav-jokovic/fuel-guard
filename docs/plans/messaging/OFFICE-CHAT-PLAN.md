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
| — | **Release 1 = CH1a → CH3b + CHA1: direct and group chat, live, ledgered.** About 3 release nights | |
| CHA2 | Compliance console: `chat.compliance` surface on the Permissions page, step-up + reason, search, conversation view with versions, Access log | CH1b |
| CHA3 | Export (PDF + JSONL + hash manifest), legal holds, retention setting + ledgered purge job | CHA2 |
| CH5 | Teams and channels, `parent_id` replies | CH3b |
| CH6 | Mentions, reactions, pins, saved, muted section, Activity, browser notifications | CH5 |
| CH7 | Files | CH2 |
| CH8 | Search (`tsvector` + GIN, readable conversations only; the console reuses it org-wide) | CH2 |
| CH9 | Presence, status, typing (Presence/Broadcast, ephemeral, never stored) | CH3b |
| CH10 | Web Push | Q-CHAT4 |
| CH11 | "Chat about this" on loads, drivers, trucks, cases | Q-CHAT6 |
| CH12 | AI catch-up (D-CHAT16), off by default, after release 2 | CHA3, CH5 |

**Release 2 = CHA2 + CHA3 + CH5** (compliance console, teams and channels). After that each item ships
on its own.

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

## 11. Progress log

- 2026-10-23: plan opened; existing messaging, production usage and the AWS shape measured (§1).
- 2026-10-23: owner: "like Microsoft Teams … more and more users". Delivery moved from Postgres Changes to Broadcast-from-database; added scale (§3) and the Teams map (§4).
- 2026-10-23: owner: "enterprise grade, lightweight, good audit logs, Admin able to audit messages, not expensive, research the last six months". Added §5 (ledger, console, holds, notice), §6 (cost from Supabase's billing page: Pro includes 5 M Realtime messages and 500 peak connections, then $2.50/M and $10/1,000, counted per recipient), §7 (practices), D-CHAT12–16, CHA1–3, CH12, Q-CHAT11–13. D-CHAT2 now carries signals only, so the subscribe-time authorisation gap cannot leak content. `audit_logs` measured at 5.07 M rows / 1.23 GB, which is why the ledger is its own table.
- 2026-10-23: owner ruled Q-CHAT2 (a Permissions-page permission decides who audits; admins by default, like Ask AI), Q-CHAT11 (a), Q-CHAT12 (no in-product notice; the employment contract covers it), Q-CHAT13 (b). §5.2, §7, D-CHAT14, CH2, CHA2 and CH12 updated. Still open: Q-CHAT1, Q-CHAT3–Q-CHAT10.
- 2026-10-23: owner: "rest as recommended, start release 1". Every Q-CHAT is ruled. Release 1 (CH1a → CH3b + CHA1) started.
- 2026-10-23: CH1a #1734 merged (0511 schema, versions, ledger; 0512 functions) and applied to staging (`verify:live staging`: schema 0512). CH1b #1735 merged (`/api/chat`). CH2 (the `/chat` page) built with a browser pass on a stubbed API at 1440×900, 1920×1080 and 390×844. The pass found three things jsdom could not: list rows squeezed onto one cut-off line (fixed with AppButton `size="row"`), Send under the Ask AI launcher (the panel now stops at `--assistant-clearance`), and list and conversation too short side by side on a phone (a phone shows one or the other, with Back). Moving the nav counts into `useNavCounts` and the catalogue lookups into `surfaceLookups.ts` kept two files at their 500-line budget. Next: CH3a (broadcast trigger + `realtime.messages` policies) and CHA1 (nightly verifier).
- 2026-10-23: CH2 #1736 and CH3a #1737 merged (0513 on staging, `verify:live staging`: commit 1ddf418, schema 0513). CH3b built: `features/chat/transport.ts` is the only file that touches Realtime (D-CHAT10). It joins `chat:user:<me>` from the signed-in shell, so the sidebar badge is live on every page, and `chat:conv:<open>` from /chat, both `private: true` after `setAuth()`. `chatRealtime.ts` decides what a signal means: refetch the inbox, or `/sync?since_rev=` and merge into the cached page. A merge that would leave a seq hole is refused and the page is refetched. A channel that comes back after a drop triggers one catch-up. Polls relax to 60 s only while the link is `live`. The page says "Reconnecting…" only when a channel has failed, not while it first joins. Load test: `scripts/chat-load-test.mjs` (staging only, its own org, test users deleted or banned at the end). **Not run yet:** the session's permission check refused to create 300 accounts on staging, so the owner runs it. p95 delivery, Realtime message count and DB CPU go here when it has run.
- 2026-10-23: CHA1 built: `chat-ledger-verify` in the `general` lane (`modules/messaging/chatLedgerVerify.ts`). The lane's lease (0506) keeps it in one process. It runs at 05:00 Central every night, the fixed-hour shape of the storage reconcile, because the api rarely lives 24 h. Per org it calls `chat_ledger_verify(org, 0)` over the whole chain. On a problem it logs `[chat-ledger] … ` with `console.error` and sends a `system`, `critical` notification to each admin, deduped `chat_ledger:<org>:<day>`. An unreadable chain is an error and is never reported as intact. ⚠ The admin recipients are a labelled interim: CHA2 replaces them with the holders of `chat.compliance`. Not in CHA1: a platform-console page for a mismatch (§5.1 "pages through platform-health"); today the signals are the log line and the admins' bell. Measured that day: production and staging have 0 messages, so no message predates the ledger.

Sources consulted 2026-10-23: Supabase docs (Realtime limits, Postgres Changes, Broadcast,
Authorization, billing); CometChat "Chat UI Architecture in 2026"; Stream "How to Sync Chat State After
a User Goes Offline" and "Chat Application Architecture"; SystemDesignSchool chat-app design; Hanzo /
ViewExport 2026 Slack eDiscovery guides; Microsoft Purview eDiscovery guides; pg-tamper-evident-audit
and 2026 hash-chain write-ups; 2026 employee-monitoring legal guides (Time Doctor, CurrentWare);
TechRepublic / Windows Report on Teams 2026 updates.
