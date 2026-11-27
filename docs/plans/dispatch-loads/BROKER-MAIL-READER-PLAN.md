# Broker mail — the mail reader (gateway): build plan

Status: **APPROVED FOR BUILD 2026-11-24** (rulings Q-BMR1–9; owner's go the same day). P0 comes first: no
feature code before its proofs pass. Written against `origin/main` = `ec396df52` (migrations through 0641). Decisions are `D-BMR*`,
questions `Q-BMR*`, facts `F*`, assumptions `A*`. The feature rulings Q-BM1–12 (analysis document)
are final and not reopened here.

Precondition for every phase: the existing registration's own scope and credential work is complete
and checked. This plan depends only on that end state and changes nothing about that registration.

## 1. Goal

A small program, separate from the 360 API, that reads the dispatchers' Outlook mailboxes through
Microsoft Graph and gives 360 only **envelope facts**, through the database. Later phases let it put
a reply **draft** in the dispatcher's own Outlook. It never sends mail, has no inbound port, and can
do nothing in the database except call a short list of functions.

First deliverable: a **measure-only week** — read, match, count; write nothing to any mailbox, text
nobody, show nothing to dispatchers — that answers "how many broker emails can we tie to a load, and
how many texts would the feature have sent".

## 2. Rulings (owner, 2026-11-24)

| # | Ruling |
|---|---|
| Q-BMR1 | **Two registrations ("badges").** The existing one stays on the app server for EFS reports and Pilot prices, with its own scope and the address rule. A **new one, with no secret at all**, is used only by the gateway on Lambda and is scoped only to dispatcher mailboxes. Supersedes "no second app" (2026-11-23), which was ruled before it was known that the mailbox scope belongs to the registration, not to the credential. |
| Q-BMR2 | Sign-in without a secret (AWS identity → Entra federated credential) is **proved on staging first**; fallback is a certificate whose key stays in AWS KMS. |
| Q-BMR3 | Staging: two shared test mailboxes + a canary, and a **staging-only registration** that can open only those. |
| Q-BMR4 | Shared address / list: **measure first**; proposed rule afterwards — only the load's dispatcher gets the row and the text. |
| Q-BMR5 | Colleague replies without copying the dispatcher: **accept for now**; if the week shows more than a few a week, the wider office gets the envelope-only role. |
| Q-BMR6 | Envelope rows are kept **90 days**. |
| Q-BMR7 | Gateway behind when a text is due: **hold up to 10 minutes**, then send the dispatcher's text; **never** send the backup notice without a fresh check; alarm in both cases. |
| Q-BMR8 | McLeod's broker reference: **one request to Alex after the week**, with the measured miss count. |
| Q-BMR9 | Measure week: **3 days with `Mail.ReadBasic`** (no body can be read at all), then `Mail.Read` for the rest. |
| Q-BMR10 | (2026-11-24, after F12 was found wrong) Our mail domains are **the gateway's own list**, `mail_gateway_config.mail_domains`, set with the org; empty = no mailbox. Not the invite allowlist, and no other setting changes. |
| Q-BMR11 | (2026-11-24) A linked dispatcher can be **left out on purpose**: `mail_gateway_config.excluded_user_ids uuid[]`, set by an admin act (audited), skipped by D-BMR5, and shown on the admin's mailbox list as "left out on purpose", never as a refusal. First use: two linked McLeod dispatchers the owner ruled out of the group. Unlinking them instead would move their loads on the Dispatch board. |

## 3. Measured facts

Code facts were checked on `origin/main` on the date above; vendor facts are from documentation
(sources at the end) and are **not yet run against our tenant** — P0 runs them.

| # | Fact | Where |
|---|---|---|
| F1 | No Lambda, no infrastructure-as-code tool, no second deploy target. One EC2 per environment, Docker Compose, GitHub OIDC + SSM. AWS setup is owner-run bash. | `infra/`, `image.yml`, `aws-production.yml` |
| F2 | The API has no direct Postgres connection (no `pg`/`postgres` dependency); everything is supabase-js with the service role. No custom database role exists. | all `package.json`, migrations |
| F3 | Tables are RLS-on with no client policies: a login that is not `service_role` is refused on every table even with a GRANT. | `check-rls.mjs`, 0635 |
| F4 | Default privileges revoke EXECUTE from PUBLIC; 414 of 444 definer functions also revoke explicitly. A new login can call nothing unless granted. | migrations |
| F5 | Table gates read `.from("…")` literals in the four existing apps and DML in RPC bodies. SQL sent over a wire connection is invisible to them. | `scripts/check-table-*.mjs` |
| F6 | A migration above 0260 that references a raw-layer table needs `-- raw-access-waiver:`; one that touches two modules' tables needs `-- cross-module-waiver:`. `tms_dispatchers` is raw, owned by `mcleod`. | `check-table-access.mjs:158`, `check-table-modules.mjs:181` |
| F7 | `schema-drift` and `schema.generated.sql` cover `public` only (tables, functions and their grants, policies). Role attributes (login, password) are not compared. | `scripts/schema-drift.mjs` |
| F8 | **Staging runs no schedulers and no worker** (`RUN_SCHEDULERS=false`). A scheduler-lane job cannot be proven on staging. | `infra/server/staging.env`, `deploy.sh` |
| F9 | The matrices and the snapshot generator create the Supabase roles themselves before applying migrations; a migration may create one more role. | `gen-schema-snapshot.mjs:47` |
| F10 | `lint:migration-ordering` sees columns, not functions. A caller of a new function is held behind its migration by hand. | memory note, 2026-09-02 |
| F11 | Dispatcher → user: `tms_dispatchers.user_id` (`is_system`, `is_active`). Member email: `org_member_directory` reads `auth.users.email` and `suspended_at`. | `mcleod/dispatchLinks.ts`, 0393 |
| F12 | ~~The company's own mail domains are stored: `organizations.allowed_domains`.~~ **Wrong (measured 2026-11-24):** that column is the *invite* allowlist, empty means "no restriction" (`shared/emailDomain.ts:19`), and production's is empty — the rule as written kept none of the 9 linked dispatchers. No list of our mail domains exists → Q-BMR10. | 0003, 0392, production |
| F13 | No broker or customer domain list exists. | `schema.generated.sql` |
| F14 | Load references for matching: `loads.ref`, `loads.pickup_number`, `loads.consignee_ref`, `load_stops.po_number`. **Corrected at build (2026-11-24):** `loads` has no `po_number`, and no code joins a McLeod movement to a load, so `mcleod_dispatch_movements.consignee_refno`/`blnum` wait for that join (the week counts the misses). | `schema.generated.sql`, `loads/dispatchLoads/search.ts` |
| F15 | Texts: `textOne` always applies the quiet window; `drainAlertTexts` is called only from the home-time run; the door check looks at the phone only; a delivery row has no link to its subject; the catalogue has no `mandatory` flag. | `messaging/alertTexts.ts`, `shared/alertRouting.ts` |
| F16 | The app image installs only api/web/admin packages; a new workspace app is not installed into it. A new app with a `test` script is run by CI's `test-packages` and `pnpm -r typecheck`. | `infra/image/Dockerfile:36`, `ci.yml:587` |
| F17 | `aws-production.yml` takes a `sha` on the `production` branch; `release.yml` has nightly / hotfix / rollback modes; rollback never reverses a migration. | workflows |
| V1 | Mailbox role + scope belong to the registration (service principal). One registration can hold different roles on different scopes; every credential of it gets all of them. | Microsoft, RBAC for Applications |
| V2 | Entra-consented permissions and Exchange roles **add up**. A registration with Exchange roles only, and no Graph permission consented, works. | same; Practical365 |
| V3 | `Application Mail.ReadBasic`: everything except body, preview and attachments. Accepted by message delta and folder delta. | Graph reference |
| V4 | The address rule (Conditional Access for workload identities) is assigned per registration and blocks any token request from outside the named addresses. | Microsoft |
| V5 | Message delta is per folder; `changeType=created`, `$select`, and `$filter=receivedDateTime ge …` (max 5,000) are supported. Folder delta returns the mailbox's folders and can answer `403 ErrorQuotaExceeded` on a full mailbox. | Graph reference |
| V6 | `conversationId` is per mailbox, and can differ between mailboxes or change when an outside party replies; unrelated mail can share one. | Microsoft Q&A |
| V7 | AWS outbound federation: account switch `enable-outbound-web-identity-federation`; `sts:GetWebIdentityToken` on a **regional** endpoint; issuer `https://<id>.tokens.sts.global.api.aws`; subject = role ARN. Entra accepts **RS256** only, matches the subject exactly, fails silently on a wrong one, and needs minutes after a change. Microsoft documents AWS only for Agent ID. | AWS, Microsoft |
| V8 | Supabase supports a custom login role; pooler user name `role.<project>` is inferred, not stated. | Supabase |

## 4. Architecture

```
 Microsoft 365                              AWS (own role per environment)            Supabase Postgres
 ┌────────────────────────┐   HTTPS out    ┌──────────────────────┐   TLS out   ┌──────────────────────────┐
 │ dispatcher mailboxes   │◄───────────────│ mail gateway (Lambda)│────────────►│ login mail_gateway        │
 │ scope of badge 2 only  │ closed list of │ one run per minute   │ functions   │ EXECUTE on mailgw_* only  │
 └────────────────────────┘ call shapes    │ no inbound port      │ only        │ no table, no other RPC    │
 ┌────────────────────────┐                └──────────────────────┘             ├──────────────────────────┤
 │ feeds mailbox (EFS,    │◄── badge 1: app server, secret + address rule       │ broker_mail_* (RLS on)    │
 └────────────────────────┘    (unchanged; not part of this plan)               └───────────▲──────────────┘
                                                                     service role, org + owner filtered
                                                                                ┌───────────┴──────────────┐
                                                                                │ 360 API + worker          │
                                                                                │ list, timers, texts, UI   │
                                                                                │ cannot sign in as badge 2 │
                                                                                └──────────────────────────┘
```

The gateway decides nothing about people. It keeps facts current; 360 owns the clock, the texts, the
permissions and the page.

## 5. Decisions

**D-BMR1 — One core, thin host.** All behaviour is `runCycle(deps)` in `apps/mail-gateway/src/`, with
Graph, the database and the clock passed in. `lambda.ts` only builds `deps`.

**D-BMR2 — Code home and boundaries.** New workspace app `apps/mail-gateway`, TypeScript/ESM. It may
import `@silvicom/shared` (`brokerMailContract.ts`) and nothing from `apps/*`; nothing imports it. No
supabase-js, no Express. Runtime dependencies: `postgres` (pooler transaction mode, `prepare:
false`), `@aws-sdk/client-sts`, `@aws-sdk/client-ssm`. `check-feature-boundaries.mjs` gets the rule
and a self-test case in the same PR. The file and function budgets apply to it.

**D-BMR3 — The database door is functions, not tables.**
- Migration creates `mail_gateway` as `nologin noinherit` (guarded `if not exists`; F9). **No
  password in any migration.** An owner-run script turns login on, sets a generated password and
  writes it to Parameter Store without printing it.
- Zero table privileges. EXECUTE on these `security definer` functions in `public`, each revoked from
  `public`, `anon`, `authenticated`:

  | Function | Does |
  |---|---|
  | `mailgw_begin_cycle(commit)` | takes the one-runner lease; returns settings and the derived mailbox list (D-BMR5) |
  | `mailgw_save_cursor(mailbox, folder, link)` | stores a folder's delta position |
  | `mailgw_record_messages(jsonb)` | upserts envelope rows; refuses a mailbox not in the derived list |
  | ~~`mailgw_match_refs(text[])`~~ | **folded into `mailgw_record_messages` at build (0643):** the gateway hands over tokens with each envelope and learns nothing back about any load |
  | `mailgw_mark_threads(jsonb)` | answered / still waiting, with `thread_checked_at` |
  | `mailgw_record_probe(mailbox, result)` | canary and "still connected" results (D-BMR14) |
  | `mailgw_end_cycle(counts)` | heartbeat + the cycle's counts |
  | P4: `mailgw_claim_drafts()`, `mailgw_complete_draft(…)` | the command side |

- **No function takes an org.** The org comes from the one row of `mail_gateway_config`
  (`org_id`, `enabled`, `body_reading`, `mail_domains text[]` — Q-BMR10, `excluded_user_ids uuid[]` —
  Q-BMR11), written by a migration-free admin act in P2 and by a seed
  statement in P1. The gateway cannot name a company.
- The migration carries `-- raw-access-waiver:` and `-- cross-module-waiver:` lines (F6) with the
  reason: the derived list is one SQL statement over `tms_dispatchers`, memberships and
  `organizations`, and must live in the database so the gateway cannot widen it. These are the
  gates' own declared exits for SQL, not a detour around them.
- A PGlite matrix proves the door — *"the gateway login can execute exactly the mailgw functions
  and no table"* — by walking every function and table in `public` with `has_function_privilege` /
  `has_table_privilege`. A later migration that forgets a revoke fails it.
- A signature never changes in place: a new shape is a new function; the old one is dropped a release
  after its last caller. The gateway treats "function does not exist" as *not ready*: it ends the run
  quietly (F10 — on staging the code can arrive minutes before its migration).
- Every door function takes the cycle id `mailgw_begin_cycle` returned and refuses a call outside
  that lease (`55P03`). The helpers (config, lease, derived list, token rule) are executable by no
  client role and not by `mail_gateway`. The one exception is `mailgw_derived_mailboxes`, which
  service_role may call, so P2's admin list shows the same rule.
- Role settings (`connection limit 3`, `statement_timeout`) pass `lint:role-settings`.

**D-BMR4 — Graph allowlist in code.** One function builds every Graph URL from a closed list. P1:
(1) folder delta, (2) message delta of one folder with `changeType=created` and a fixed `$select`,
(3) read one message's body (only when `body_reading` is on), (4) probe: `mailFolders/inbox?$select=id`.
P4 adds: (5) list Drafts of one conversation, (6) `createReply`, (7) PATCH the body of a draft whose
id 360 recorded, (8) DELETE such a draft. A unit test enumerates the list and fails on a ninth; a
second proves a mailbox outside the cycle's list is refused before any request (the probe has its own
list, D-BMR14). No send, no move, no mark-read, no attachments.

**D-BMR5 — Mailboxes are derived inside the database, every cycle.** Linked + active + non-system
`tms_dispatchers` → member not suspended → sign-in email → kept only if its domain is in
`mail_gateway_config.mail_domains` (Q-BMR10; empty = no mailbox, so a missing value fails closed), and not in
`mail_gateway_config.excluded_user_ids` (Q-BMR11).
Two McLeod logins for one person are one mailbox. No address is typed. The same list is what
"internal" means in D-BMR6, D-BMR9 and §7 step 3, and the gateway receives it from
`mailgw_begin_cycle`. It never reads it from anywhere else.

**D-BMR6 — What is read.** Folder delta gives the mailbox's folders. Message delta runs on Inbox,
every folder under Inbox, and Sent Items; never on Drafts (until P4), Deleted Items or Junk. Only
`created` changes are asked for, so a message a dispatcher files or deletes changes nothing in 360.
Selected fields: `internetMessageId`, `conversationId`, `from`, `toRecipients`, `ccRecipients`,
`receivedDateTime`, `sentDateTime`, `subject`. A body is opened only when `body_reading` is on and the
message is a **candidate**: external sender AND (a reference-shaped token in the subject OR a sender
domain that matched a load before). It is held in memory, searched for tokens, and dropped.

**D-BMR7 — What is stored.** `broker_mail_messages`: `org_id`, `owner_user_id`, `mailbox`,
`internet_message_id` (unique per mailbox), `conversation_id`, `from_address`, `from_domain`,
`received_at`, `subject` (≤ 255), `addressed_directly`, `was_candidate`, `body_was_read`,
`matched_refs text[]`, `match_state` (`one`/`several`/`none`/`not_tried`), `load_id`, `thread_state`
(`waiting`/`answered_by_owner`/`answered_by_colleague`), `answered_at`, `thread_checked_at`. No body,
no attachment, no quoted text; unmatched tokens are counted, not kept. Also `mail_gateway_cursors`,
`mail_gateway_cycles` (heartbeat, commit, counts; 14 days), `mail_gateway_mailboxes` (state per
mailbox: `connected`/`not_connected`/`over_quota`/`still_connected_after_unlink`), and
`mail_gateway_config`. Owning module: new `apps/api/src/modules/broker-mail`. Each table has a
lifecycle block, and the 90-day and 14-day windows are added to `RETENTION_RULES`
(`org/dataRetentionPolicy.ts`) in the same PR — the gate checks the two against each other.

**D-BMR8 — Matching happens in the database.** The gateway sends candidate tokens with each envelope
to `mailgw_record_messages`; SQL compares them, normalised, with F14 for loads active in the last 45 days.
The gateway cannot list loads. P1 is exact match only.

**D-BMR9 — "Answered" is decided inside one mailbox, with a second check.** All proof lives in the
owner's own mailbox, where `conversationId` is what Outlook itself groups by (V6 is about *between*
mailboxes): (a) a later Sent Items message on the conversation, or (b) a later arrival on it from an
internal domain (a colleague's reply-all). Because unrelated mail can share a conversation (V6), a
proof also needs the broker's address or domain among its recipients. A broker reply that Outlook
puts on a new conversation is simply a new row — the ruling already says a new broker message
restarts the clock. Message headers are not needed, so all of this works with `Mail.ReadBasic`.

**D-BMR10 — 360 owns the clock and the texts.** The gateway never queues a text. A minute-level
worker job in `broker-mail` finds rows `waiting` longer than the setting and queues through
`queue_notification_delivery`. The door check becomes: still `waiting` AND `thread_checked_at`
younger than 3 minutes; otherwise Q-BMR7. Needed first (F15): a `mandatory` catalogue flag that skips
the quiet window, a link from a delivery to its subject, a door hook per alert, a drain not tied to
the home-time run. All P3.

**D-BMR11 — The draft is composed in the API by the AI code 360 already has; the broker's text never
reaches the model (P4; owner direction 2026-11-24, replaces the first version of this decision).**
- *Why not in the gateway:* the one AI client (`apps/api/src/lib/anthropic.ts`: tool schema derived
  from Zod, four typed outcomes, model profiles in `packages/shared/src/ai.ts`) lives in the API, and
  the gateway may not import the API (D-BMR2). Composing in the gateway would mean a second copy of
  it, with its own key and spend rules.
- *What the gateway adds to a row:* `ask_kinds` — a closed list (`eta`, `location`, `tracking_link`,
  `appointment`, `pod`, `delay_reason`, `other`), found by fixed word rules on the subject and, when
  `body_reading` is on, the body in memory. An enum, never text.
- *What the model is given:* the ask kinds; the load's facts from 360's own tables (reference,
  McLeod status, accepted or not, truck, trailer, next stop city/state, appointment, ETA and when it
  was computed, miles left, GPS present or not); the dispatcher's first name; that broker's learning
  notes. Nothing a broker wrote.
- *What the model may do:* word the answer. It computes nothing. A check after the call refuses a
  draft containing a number, time or place that is not among the supplied facts. A missing fact is
  said as missing ("no live position right now"), never filled in. `other` produces the status plus
  an empty line for the dispatcher to answer the question itself.
- *Pattern:* the chat catch-up's (`messaging/chatCatchup.ts`) — forced tool with a Zod schema, model
  as a setting (default the catch-up's), a ledger row with the text's SHA-256 and token counts, not
  the words, counted against the carrier's month.
- *The road to Outlook:* the API writes the draft text on a command row; the gateway claims it,
  calls `createReply` + PATCH, and `mailgw_complete_draft` **clears the text** and keeps the draft id
  and hash. These are our words, not the broker's, and they stay in the database for seconds.
- So "Draft reply" is not a minute's wait, the API may **wake** the function (an invoke with an empty
  payload — it starts a cycle, passes nothing and returns nothing).

**D-BMR12 — One company per gateway.** A registration belongs to one Microsoft tenant; the config
row names one org. A second carrier is a second gateway.

**D-BMR13 — Staging can never reach a real mailbox.** The staging gateway uses the staging-only
registration (Q-BMR3). Its mailbox list is derived like production's: two staging users whose sign-in
emails are the test mailboxes, linked to two staging dispatcher rows. No override list exists.

**D-BMR14 — The scope is checked every day, both ways, without any directory permission.**
- *Canary:* once a day the gateway probes a mailbox that must be outside the scope. Refused = good.
  **Opened = the gateway stops itself** (`enabled` off through `mailgw_record_probe`) and the alarm
  fires.
- *Linked, not connected:* a derived mailbox Graph refuses is shown to the admin, not retried in a
  loop.
- *Unlinked, still connected:* a mailbox that left the derived list is probed once a day for 30 days
  (call shape 4 only — no message is read). While it still opens, the admin sees "ask IT to remove
  <name> from the mail group".

**D-BMR15 — Who can change the gateway can read the mail; keep that set small.** Production code is
moved only by the release role behind the approved `aws-production` environment. The staging deploy
role can touch only the staging function, which holds only the staging registration. The setup
script's `--check` proves with `simulate-principal-policy` that the app server's role can neither
update the function nor read the gateway's parameters.

## 6. Build, deploy, release

| Piece | Definition |
|---|---|
| Build | `pnpm --filter @silvicom/mail-gateway bundle`: esbuild → one `index.mjs` → zip. No build-time values, so production runs the bytes staging ran. |
| Artifact | `s3://<artifacts bucket>/mail-gateway/<commit>.zip`, written once on merge to main. |
| Runtime | Lambda `nodejs22.x`, arm64, 512 MB, timeout 50 s, reserved concurrency 1, no VPC. |
| Schedule | EventBridge Scheduler `rate(1 minute)` → alias `live`. The database lease also refuses an overlap. |
| Staging deploy | New job in `image.yml` (role `silvicom-github-deploy`): upload zip, `update-function-code`, `publish-version`, move `live`. |
| Production deploy | New job in `aws-production.yml` beside the server deploy (role `silvicom-github-release`), for the released commit, after migrations; skips with `RELEASE_TRAIN` like its siblings. Hotfix: builds the zip if S3 has none. Rollback: the same job with the older commit; a commit from before the gateway existed leaves the function as it is and says so in the summary. |
| Verify | The heartbeat row carries the commit. `GET /api/version` adds `mailGateway: { commit, lastCycleAt }` (read through `broker-mail/gatewayHealth.ts`), so `deploy-verify`, `verify:live` and `platform-health` need no AWS access. |
| Identity | Role `silvicom-mailgw-<env>`: its log group; `ssm:GetParameter` on `/silvicom-mailgw/<env>/*`; `sts:GetWebIdentityToken` for audience `api://AzureADTokenExchange`, RS256, ≤ 300 s. Nothing else. |
| Settings | Parameter Store: database URL, tenant id, client id, canary address. No Microsoft secret exists for badge 2. |
| Logs | `/aws/lambda/silvicom-mailgw-<env>`, 30 days. Counts and error classes only — never an address or a subject; a test checks the logger's call sites. |
| Alarms | Lambda `Errors` ≥ 3 in 15 min; no invocation in 10 min; canary opened → SNS `silvicom-alarms`. |
| AWS setup | `infra/mail-gateway/setup.sh <env>` — idempotent, **owner-run**, with a read-only `--check`. Creates bucket, function, role, schedule, log group, alarms, parameters, the two deploy roles' rights on this one function; turns on outbound federation. |
| Cost | 43,800 runs/month × ~10 s × 0.5 GB ≈ 219,000 GB-s: inside the free 400,000; ≈ $2.90/month per environment without it. Badge 2 needs no licence. |

## 7. The cycle

1. `mailgw_begin_cycle` → lease, config, mailbox list. `enabled` off ends the run.
2. Per mailbox (≤ 4 at once): folder delta; message delta per folder from its cursor. First run uses
   a 7-day window and saves the cursor **after every page**, so a long first read continues in the
   next minute instead of timing out.
3. Classify each new Inbox envelope: internal / external; candidate or not.
4. Candidates, when `body_reading` is on: read body, extract tokens, drop the body. Always:
   subject tokens → `mailgw_match_refs`.
5. `mailgw_record_messages`, then `mailgw_save_cursor` — in that order, so a crash re-reads instead
   of skipping (the upsert makes a re-read harmless).
6. Sent Items and internal arrivals → `mailgw_mark_threads` (D-BMR9); every open `waiting` row gets
   `thread_checked_at` from this cycle.
7. Once a day: canary and unlinked-mailbox probes (D-BMR14).
8. `mailgw_end_cycle(counts)`.

Graph 429/503: honour `Retry-After`, skip that mailbox this cycle, count it. A full mailbox
(`ErrorQuotaExceeded`) is a mailbox state, not a failure. Expected load ≈ 5 requests per mailbox per
minute against a limit of 10,000 per 10 minutes.

## 8. The measure-only week (P1)

Days 1–3 on `Mail.ReadBasic`, days 4–7 on `Mail.Read` (Simo changes one role assignment; allow two
hours). No drafts, no texts, no page. Per mailbox and day:

- messages in; external; candidates; bodies opened (0 on days 1–3)
- matched to one load / several / none — by subject alone, and (days 4–7) with the body; for "one":
  is the load's dispatcher the mailbox owner
- external messages with no reference in the subject, by sender domain
- arrived through a list rather than addressed directly (Q-BMR4)
- time to first reply; threads still `waiting` at 20 and at 25 minutes, split day / night — the
  texts and backup notices the ruled settings would have sent
- answered by the owner versus by a colleague (Q-BMR5)
- how often a broker's follow-up opened a new conversation (D-BMR9)

Check by hand: an admin reads 50 sampled rows against Outlook. Proposed pass marks: ≥ 70 % of broker
update threads tied to exactly one load; ≤ 5 % of sampled `waiting` rows wrong. The week ends with a
report and a go / change / stop ruling.

## 9. Phases

| Phase | Contains | Needs first |
|---|---|---|
| P0 | Simo: badge 2 (production) and the staging badge, both with **no** Graph permission consented and no secret; scope groups; test mailboxes; canary; federated credential; the list of shared mailboxes and lists with a dispatcher in them (B-6). Owner: `setup.sh staging`, database login script. Prove on staging: token by federation (V7's four traps), test mailbox read, canary refused, body refused under `ReadBasic`, pooler login (V8). | Simo's runbook finished |
| P1 | PR-a migration (login, tables, P1 functions, waivers) + door matrix. PR-b `apps/mail-gateway` core, Graph fake, boundary rule. PR-c workflows, `setup.sh`, `/api/version` heartbeat. Release, then the week. | P0; dispatchers told (A9) |
| P2 | Page (own list; admin "all": `dispatch.broker-mail`, `dispatch.broker-mail.all`), Settings › Broker mail, `broker_mail_settings`, the admin's mailbox list (D-BMR14). | P1 ruling |
| P3 | Texts: catalogue entries + `mandatory`, door hook, minute job, `broker_mail_backups`, held backup notice. | P2; **B-1** |
| P4 | Drafts: `Mail.ReadWrite` on the scope (Simo), `ask_kinds`, command functions, compose in the API (D-BMR11) with its fact check and ledger, wake-up invoke, remove-own-draft rule. | P3; **B-2** |
| P5 | Learning notes with the validator and 90-day expiry. | P4 |

Not in this plan any more: moving the EFS and Pilot readers into the gateway. With two badges it is
no longer needed to keep dispatcher mail away from the app server, it cannot be rehearsed on staging
(F8), and EFS is money data. It stays a possible later project with its own plan (**B-3**).

Tests: unit tests on `runCycle` with a Graph fake (paging, 429, token expiry, cursor reset, mailbox
removed mid-cycle, function-not-ready); the allowlist enumeration; the door matrix; a matrix for
`mailgw_record_messages` (refuses a foreign mailbox, idempotent, owner = the mailbox's user) and for
D-BMR9's two-part proof; API tests with `supabaseRecorder` asserting org + owner filters from P2.

## 10. Open blockers (after the second audit, 2026-11-24)

| # | Blocker | Candidates | Recommendation | Who |
|---|---|---|---|---|
| B-1 | P3's minute job is a scheduler, and staging runs none (F8): the texts could not be proven before production. | (a) switch all of staging's schedulers on — that starts every feed there, and is the staging cutover's own work; (b) prove in production with texts routed to one phone; (c) a third scheduler lane `mail` (`schedulerLanes.ts` is one list; each lane has its own lease) holding only the broker-mail tick and the text drain, which staging's api container runs alone | **(c)**: the text road is proven on staging against the test mailboxes with no other staging job started, and production gains a lane it can move or stop on its own. It needs a per-environment lane setting in `compose.yml` — read `docs/WORKER-DEPLOYMENT.md` and confirm at the start of P3; (b) is the fallback. | Claude at P3 |
| B-2 | ~~P4 sends an email's text to the model provider.~~ **Closed 2026-11-24** by D-BMR11. Ruled the same day: an `other` ask gets a draft with the load status and an empty line for the dispatcher's own answer. | — | — | — |
| B-3 | ~~Moving the EFS and Pilot readers into the gateway.~~ **Closed 2026-11-24, owner:** they stay on the app server with the existing registration. Not part of this plan. | — | — | — |
| B-4 | V2/V7/V8 are documentation, not measurements. | — | P0 proves each before PR-b depends on it; the KMS certificate is the fallback for V7. | Simo + owner + Claude |
| B-5 | Migration number race with parallel chats. | — | Take the number at PR time; renumber on conflict. | Claude |
| B-6 | Broker mail that arrives in a **shared mailbox or a list**, not a dispatcher's own (this is also Q-BMR4). A shared mailbox has no owner and no dispatcher link, so the derived list never contains it, and a "send as" reply may be saved there instead of in the sender's Sent Items. | ask the owner from memory / measure and guess / get the facts from Exchange | **Facts first:** P0's one list for Simo asks for every shared mailbox and distribution list that has a dispatcher as member or delegate, and whether sent-as copies are kept in the shared mailbox. None → closed. Any → P1 reads it envelope-only like the others and the week counts its mail; the owner then rules who owns such a row (proposed: the matched load's dispatcher). No build work depends on the answer before P2. | Simo (P0 list), then owner |

## 11. Assumptions

✔ confirmed in code or ruled · ✘ found wrong, plan changed · ? to be proven where stated.

| # | Assumption | Status |
|---|---|---|
| A1 | A narrow Postgres login with table grants is enough. | ✘ RLS denies it → functions only (D-BMR3) |
| A2 | The table gates see the gateway's writes. | ✘ not over a wire → RPC bodies, with the two waiver lines (F6) |
| A3 | The text road already does "mandatory at night" and "still unanswered at the door". | ✘ four changes (F15, D-BMR10) |
| A4 | A broker/customer domain list exists. | ✘ none → learned from matches; misses counted |
| A5 | One delta query covers a mailbox. | ✘ per folder → folder delta + per-folder cursors |
| A6 | `conversationId` ties a thread together across our mailboxes. | ✘ → all proof is inside one mailbox, with a recipient check (D-BMR9) |
| A7 | One registration can keep dispatcher mail away from the app server. | ✘ → two badges (Q-BMR1) |
| A8 | The gateway can be trusted to name its org. | ✘ → org comes from the config row; no function takes one |
| A9 | Dispatchers know 360 reads their mailbox envelopes. | ✔ owner, 2026-11-24 |
| A10 | A dispatcher's 360 sign-in email is their mailbox address. | ? D-BMR5 filters by domain; a refusal is shown, not guessed |
| A17 | The invite allowlist names our mail domains. | ✘ it is empty in production and means something else (F12) → Q-BMR10 |
| A11 | The database accepts a Lambda's changing address. | ✔ by inference (migrations run from GitHub's runners); owner confirms no network restriction in the dashboard |
| A12 | ≤ 16 mailboxes; one short pooled connection a minute is fine on the small database. | ✔ count; ? load watched in P1 |
| A13 | A subject line may be stored. | ✔ ruled 2026-11-24; it can contain a name — stated so it is a choice |
| A14 | A staging job can prove the gateway. | ✔ the gateway is not a scheduler-lane job; it runs on staging from P0 |
| A15 | Moving a message out of the Inbox must not close or delete its row. | ✔ by design: only `created` changes are read |
| A16 | Federation, roles-without-consent and the pooler login work as documented. | ? P0 (B-4) |

## 12. Progress log

- 2026-11-24 — plan written and self-audited.
- 2026-11-24 — vendor research; owner ruled Q-BMR1–9 (two badges, all recommendations).
- 2026-11-24 — second audit against code and vendor reference. Changed: org bound in the database
  (A8), waiver lines (F6), thread proof inside one mailbox (A6), folder delta, daily canary and
  unlink probe (D-BMR14), rollback and not-ready behaviour, retention rules, staging mailbox
  derivation, wake-up invoke. New blockers B-1, B-2, B-6; EFS/Pilot move taken out (B-3).
- 2026-11-24 — AI analysis: D-BMR11 rewritten — compose in the API with the existing AI code, from
  360's own facts; no broker text to the provider; B-2 closed.
- 2026-11-24 — owner ruled: `other` ask → status + empty line (B-2 fully closed).
- 2026-11-24 — owner confirmed B-3 (EFS and Pilot stay on the app server). Open-question review:
  B-1 now recommends a third scheduler lane `mail`; B-6 merged with Q-BMR4 and answered from
  Exchange facts in P0 instead of from memory. Plan approved for build; P0 next.
- 2026-11-24 — **P0 tooling written** (`infra/mail-gateway/`), not yet run: Claude's shell is refused
  AWS reads, AWS writes and production reads, so every step below is owner-run with `!`.
  - `setup.sh <env> [--check|--probe-code|--live|--stop]` builds everything in §6 except the deploy
    jobs (PR-c). Choices it adds to §6: (1) the role's token permission pins audience, RS256, ≤ 300 s
    **and** `sts:SubjectMode = AWSIdentity`, so the V7 traps are refused by IAM rather than
    remembered; AWS documents that for a role session `sub` is the **role ARN**, not the session
    ARN, which is what Simo's credential names. (2) The artifact bucket refuses any `PutObject`
    without `If-None-Match: *` (`s3:if-none-match`), so "production runs the bytes staging ran" is
    enforced by S3; PR-c uploads with `--if-none-match '*'`. (3) The Lambda trust uses
    `aws:SourceAccount` only. (4) Reserved concurrency 1 may be refused on the account's default
    quota; the script says so, and the database lease stays the overlap guard. (5) `--stop` is the
    owner's kill switch: it disables the schedule and touches nothing else.
  - **The P0 proofs run from the Lambda itself** (`probe/index.mjs`, replaced by PR-c's first
    deploy). From a laptop they would prove a different principal (another `sub`) on another network
    (A11). The probe returns verdicts, statuses and error codes only: ids are masked, and it never
    returns a token, a message or an address. `prove.sh` invokes it. Checked locally against fakes:
    a good run passes every step; ES384, a consented `roles` claim, a returned body or an opened
    canary each fail their own step.
  - `db-login.sh <env> check|probe|probe-drop|login`. The password never reaches the database in
    clear: a SCRAM-SHA-256 verifier is made locally (checked byte-for-byte against Postgres's own),
    and the password lives only in one SecureString. SQL goes through `supabase db query
    --project-ref` from an **empty** workdir, so a staging run cannot fall through to the
    production-linked checkout (checked: a missing ref is refused). V8 is proved with a throwaway
    role `mailgw_probe` that has no grant. That way PR-a's migration stays the only author of
    `mail_gateway`.
  - Simo's one list is written, untracked because it names mailboxes
    (`MAIL-GATEWAY-P0-FOR-SIMO-2026-11-24.md` in the owner's checkout). It covers both badges, scope
    groups, test mailboxes, canary, federated credential, RBAC and its test, the B-6 export, a
    Conditional Access check (badge 1's location rule must name badge 1 only, or it blocks Lambda),
    and every later role change (day-4 swap, P4). Before it is sent, the owner runs `setup.sh` for
    the issuer, and runs the D-BMR5 list query for the dispatcher group.
  - Still to do before P1 (D-BMR13): two staging users whose sign-in emails are the test mailboxes,
    linked to two staging `tms_dispatchers` rows, with the domain in staging's `mail_domains`.
- 2026-11-24 — P0, owner-run: `setup.sh staging` and `setup.sh production` built both AWS sides.
  Outbound federation is on (one issuer for the account). D-BMR15 was simulated as passing: neither
  server role can touch the gateway, and the staging deploy role cannot move production's.
  Reserved concurrency was refused: the account's Lambda quota is **10** (the new-account default).
  The database lease guards overlap; a free quota raise to 1,000 is asked of the owner. Dispatcher
  list measured on production: 9 linked dispatchers, 9 McLeod logins not linked to a 360 user, 2
  system. That measurement found F12 wrong; owner ruled **Q-BMR10** (b), the gateway's own
  `mail_domains`. Simo's list is waiting on the owner's yes/no for two mailboxes and on which unlinked
  logins are dispatchers.
- 2026-11-24 — owner: the two are out (Q-BMR11 (b) ruled, the gateway's own exclusion list); all nine
  unlinked McLeod logins answer brokers; the dispatchers have been told (A9 ✔). Of the nine, none
  has a 360 account matching it (member list measured). So D-BMR5 cannot derive their mailboxes
  until each person is a linked 360 user.
- 2026-11-24 — **P0 proofs on staging, three of four passed** (owner-run `prove.sh`, run from the
  gateway's own Lambda):
  - **Sign-in with no secret (V7, B-4): passed on the first try.** The token was RS256, came from the
    regional endpoint (`sts.us-west-2`), had `sub` exactly equal to the staging role ARN, and a
    300-second lifetime. Entra exchanged it for a Graph token. The KMS certificate fallback is not
    needed.
  - **No Entra-consented permission (first half of V2): passed.** The Graph token carries no `roles`
    claim, and a directory read is refused (403 `Authorization_RequestDenied`).
  - **Custom login through the pooler (V8) and Lambda's changing address (A11): passed.**
    `mailgw_probe.<project>` was accepted on 6543 and 5432 (Postgres 17.11), and a table read was
    refused (`permission denied for table organizations`). **The two projects sit on different
    pooler clusters** (staging `aws-0-us-west-2`, production `aws-1-us-west-2`). A wrong host says
    "tenant/user not found" before it asks for a password; `db-login.sh` now defaults per environment.
  - **Still to come:** mailbox readable under Exchange roles alone (second half of V2), canary
    refused, body refused under `Mail.ReadBasic`. These wait on the Exchange step. Every mailbox line
    answered 404 `ErrorInvalidUser` because the mailboxes do not exist yet.
  - **Who made the apps:** the owner, from his own account, with `infra/mail-gateway/entra-apps.sh`
    (Azure CLI). The admin's part shrank to one Exchange script, which ends with removing the owner
    from the two apps' owners.
- 2026-11-24 — **P1 PR-a built** (owner: "proceed while we wait for Simo"; PR-a needs no Graph proof).
  Migration 0643 contains the role, five tables, a door of six functions plus four helpers, and the
  door matrix `mail-gateway-door.test.mjs`. Changes from the plan, each recorded above: the token match
  is folded into the write (no `mailgw_match_refs`), and F14 is corrected. The matrix walks every
  function and table in `public` on the platform's default ACL, and **found that 38 older definer
  functions still carry PUBLIC execute**, which any login inherits. 34 are trigger functions, which
  Postgres refuses to call directly; the matrix proves that by calling one. The other 4 are the RLS
  helpers, whose ACL already names anon, authenticated and service_role one by one. 0643 revokes
  PUBLIC from those four, but only where all three named grants are present. Result: `mail_gateway`
  can call exactly the six door functions and holds no privilege on any of the 365 tables, views and sequences in `public`.
- 2026-11-24 — PR-a merged (#2644, migration 0643). **P1 PR-b built**: `apps/mail-gateway`, with
  `runCycle` + per-mailbox reader, the four-shape Graph allowlist (paging links are accepted back only
  for the same mailbox and kind), the secretless token, the door client (function-not-ready ends the
  run quietly), the typed logger, and the Lambda host. 31 tests run against a Graph fake. Choices made
  at build:
  - **Sent Items needs no new call shape.** Graph accepts well-known folder names, so `sentitems` and
    `inbox` are read by name; Inbox subfolders come from folder delta by `parentFolderId`. Shape 4
    (`inbox?$select=id`) gives the Inbox id they hang from.
  - **Order, per page:** record → close the threads this page proves → save the cursor; then one
    more pass over the cycle's answers. A crash re-reads instead of losing an answer, and an answer
    that came on an earlier page than its message is still applied.
  - **Sent Items is read only after every Inbox folder reached its end.** Only then does a mailbox
    earn `thread_checked_at` (D-BMR10).
  - **The canary is probed first when due.** If it opens, nothing else is read that minute.
  - **Tokens:** a number after PO, PU, BOL, PRO, REF or ORDER is offered both bare and prefixed. A
    load may store either form, and a miss is only counted.
  - Boundary rule (an import allowlist, and nothing may import the gateway) and the function budget's
    scope added, each with a planted-violation self-test.
- 2026-11-24 — PR-b merged (#2649). **P1 PR-c built.** Choices made at build:
  - **Bundle:** `pnpm --filter @silvicom/mail-gateway bundle` (esbuild) makes one zip. The commit is
    the only value built in, and building the same commit twice gave identical bytes (SHA-1 compared).
  - **Deploy:** `infra/mail-gateway/deploy.sh`. It stores the zip write-once, deploys from S3,
    publishes a version whose description is the commit, and moves `live`. `check` skips a commit
    when nothing the gateway is built from changed since the deployed one. Staging deploys from
    `image.yml`. Production deploys from `aws-production.yml`, which release.yml runs after
    migrations; a hotfix path builds when staging never stored the zip, and a rollback to a commit
    from before the gateway existed leaves the function as it is.
  - **Both jobs are OFF until the repository variable `MAIL_GATEWAY_DEPLOY` is `on`.** Before that,
    a deploy would replace the P0 probe that the last P0 proof needs.
  - **Heartbeat:** `GET /api/version` gains `mailGateway` (`off`, `ok`, `stale`, `stopped` or
    `unknown`, plus the commit and the last cycle). `off` is healthy; `stale`, `stopped` (canary
    shut-off) and `unknown` fold into `ok` and page through `platform-health`. The reader lives in the
    new API module `broker-mail`.
  - **Switches:** `db-login.sh seed | on | off | body on|off`. `seed` writes the config row switched
    off, and refuses outright when any excluded address is not a member of the org.
  - **Owner's order to go live, each step owner-run:**
    1. Simo's script, then `prove.sh` passes.
    2. `db-login.sh <env> login` and `seed`.
    3. Set `MAIL_GATEWAY_DEPLOY=on` and merge anything (or re-run `image.yml`).
    4. `setup.sh <env> --live`, then `db-login.sh <env> on`.

- 2026-11-25 — **P2 started** while P0's mailbox proofs wait on Simo (owner's handoff: P2 is not
  blocked by the Exchange step). P2's plan row says "needs the P1 ruling"; that holds for *showing the
  page to dispatchers*, not for building it, so the page ships **switched off for every role but
  admin** (`startsOnFor: []`) and the admin turns it on for the dispatcher role on Settings ›
  Permissions after the week's go/change/stop ruling. During the week the admin's own view and the
  mailbox list are what the §8 hand check needs. **P2-a (migration 0649)**:
  - `mailgw_mailbox_roster(org)`: every active, non-system McLeod dispatcher with a `reason` its
    mailbox is not read (`not_linked`, `not_member`, `suspended`, `no_email`, `other_domain`,
    `left_out`; null = read). `mailgw_derived_mailboxes` now returns the roster's null rows, so D-BMR5
    is written once and the admin's list cannot disagree with the gateway. Same signature and answer.
  - `broker_mail_settings` holds only `answer_within_minutes` (default 20): the one value that means
    something before the texts exist, because the page marks a row past it. The text switches and the
    backup time arrive with P3 as added columns; settings that changed nothing would mislead.
    The gateway's own switches stay owner-run (`db-login.sh`), and the page only shows them.
  - `broker_mail_set_left_out(org, user, bool)`: Q-BMR11's admin act, atomic, refusing a non-member.
    The API writes the audit row.
- 2026-11-25 — **P2-b built: the Broker mail page and Settings › Broker mail.** Choices made at build:
  - **"See every dispatcher's" is a named permission, `dispatch.broker_mail_all`, not the surface
    `dispatch.broker-mail.all` this plan drew.** A surface is a screen with its own route; this is a
    question about which rows one screen is sent, which is the shape of `dispatch.load_rates`. It ships
    to nobody but the admin (Q-BM9), and an admin switches it on per role on Settings › Permissions.
    The limit: named permissions are per role. Q-BM9's "per person override" would need per-person
    named grants, which nothing in 360 has yet. If the owner wants one person and not their role, that
    is new work for the permissions page; it is not routed around.
  - **The page (`/broker-mail`, `dispatch.broker-mail`) starts off for every role** (`startsOnFor: []`).
    It turns on through the existing screen switch, after the measure week's ruling. The API
    filters every query on `org_id` and `owner_user_id`, and `routes.test.ts` asserts both. Removing
    the owner filter turns two tests red (checked). Its queues: **Waiting** (unanswered, one load
    matched, last 7 days), **Needs a load** (unanswered, a broker candidate, no load or several), and
    **Answered** (last 24 h). A non-candidate external email is counted by the week and never queued.
    The wait badge is neutral, then amber in the last 5 minutes, then red at the answer-by time. The
    list refreshes every minute.
  - **Settings › Broker mail (`admin.settings.broker-mail`, ADMIN)** shows the gateway's state, never
    a switch for it. It has the answer-by time, and the mailbox list, which is the roster with Graph's
    last word on each mailbox ("Read", "Not connected — ask IT", "Not linked — link on McLeod fleets"),
    plus "Leave out" / "Read again" (Q-BMR11, audited). Mailboxes that left the roster but still open
    are listed for IT to remove (D-BMR14).
  - Not in P2: the email panel with the load's facts and the draft (P4), "Not for us" / "Handled by
    phone" (they need a write the gateway's proof would contradict; ruled with the texts in P3), and
    the Dispatch board's envelope badge (P3, when the texts make "waiting" actionable).
- 2026-11-25 — **P2 merged** (#2662 migration 0649, #2665 page and Settings). **P3 started (owner: "proceed").**
  - **B-1 confirmed, option (c): a third scheduler lane `mail`.** Measured: `schedulerLanes.ts` is one
    list; a lane's lease and its `/api/version` health are derived from it. `infra/server` reaches the
    hosts inside the app image of the same commit (`deploy.sh` copies it out of the image), so the
    lane and the hosts' lane settings ship together. Staging's api container today runs no lane at all
    (`RUN_SCHEDULERS=false` → `RUN_SCHEDULERS_IN_PROCESS=false`, worker ×0). So P3-b gives the api
    container its own `API_LANES` per environment: production `egress,mail`, staging `mail` alone. That
    is the broker-mail tick and its drain and nothing else, so no feed starts on staging. ⚠ A lane no
    process holds reads `missing` and turns `/api/version`'s `ok` false, so the lane and the compose
    change must never be split across merges. `docs/WORKER-DEPLOYMENT.md` is still written in
    Railway's words. It is updated in P3-b for the lanes only; the Railway leftovers stay for the AWS
    cleanup.
  - **Two drains, disjoint by alert.** `drainAlertTexts` drains every queued text of an org and has no
    claim step; its own comment forbids a second drain without one. So the catalogue marks the two
    broker-mail alerts as drained by broker mail. Home time's drain skips them, and the `mail` lane's
    drain takes only them. Each lane runs in one process, so no row can be in two drains.
  - **The door check reads the email from the item key** (`broker_mail:<message id>:backup`).
    `notification_deliveries` needs no subject column: before a held backup notice leaves, each line's
    email must still be `waiting` and freshly checked by the gateway. Answered lines are dropped, and
    when none is left the row is `skipped`. If the gateway is behind, the row stays queued (Q-BMR7:
    never a backup notice without a fresh check).
  - **Mandatory, as Q-BM11 ruled:** `broker_mail_waiting` is a catalogue flag that ignores the quiet
    window, cannot be muted in My alerts, and whose owner route cannot be switched off. STOP is still
    honoured at the door (it already is). The admin's mailbox list shows who stopped texts or never
    confirmed a number.
  - **P3-a (migration 0651):** the two alert categories in `notification_events`' CHECK;
    `broker_mail_settings.texts_on_since` (the moment texts were switched on; null = off) and
    `backup_after_minutes` (default 5); table `broker_mail_backups` (admin's choice, Q-BM10). The switch
    is a moment so that switching on never texts the week's backlog: only an email received after it
    can raise a text.
  - **Which emails text:** the two open queues the page shows, Waiting and Needs a load, so the text and
    the page cannot disagree about what is unanswered. Never an email older than the switch.
- 2026-11-25 — **P3-b built: the texts.** Choices made at build:
  - **The lane:** `mail` in `schedulerLanes.ts`; `infra/server` gives the api containers `API_LANES`
    (production `egress,mail`, staging `mail`), and `RUN_SCHEDULERS_IN_PROCESS` is now always true for
    the api containers. Only the lane list decides what they run. `docs/WORKER-DEPLOYMENT.md` is updated.
  - **The catalogue:** two relations, `mailbox_owner` and `dispatcher_backup`. A relation may now name
    several people, because a dispatcher has several backups. Broker mail's two alerts live in
    `packages/shared/src/brokerMailAlerts.ts`, spread into the one catalogue (alertRouting.ts is at its
    line budget). `mandatory` means: the defaults are always in force, cannot be saved off, the text
    ignores the quiet window, and `broker_mail_waiting` cannot be muted. That is enforced where mutes are
    saved, not only hidden by a screen. Until now the preferences save accepted any category, so the
    driver app's "may not mute" rule was a screen rule only; the save now drops every non-mutable category.
  - **No fallback:** `sendAlerts` gains `noFallback`. An unanswered email whose dispatcher cannot open
    the page yet is dropped, never turned into every admin's bell.
  - **The tick** (`broker-mail/brokerMailTexts.ts`), once a minute:
    - the dispatcher's alert at the answer-by time, on a check under 3 minutes old; otherwise held up to
      10 minutes, then sent anyway with an alarm line in the log (Q-BMR7);
    - the backups' notice `backup_after` minutes later, only on a fresh check. At night it is held by the
      quiet window. The door then re-reads each line's email, drops answered ones, holds while the
      gateway is behind, and drops a notice held over 16 hours;
    - a dispatcher with no backups is stamped and never asked again;
    - nothing runs while texts are off or the gateway is switched off.
  - **Settings › Broker mail:**
    - a Texts card: the switch, both times, and a red list of dispatchers who replied STOP (Q-BM11's
      unrulable limit);
    - a Texts and a Backups column on the mailbox list, with a drawer to choose up to 5 backups (Q-BM10;
      office members only, nobody their own; audited).
  - **The page:** a dispatcher with texts on and no confirmed number is told to confirm it in My
    alerts, and sees their backups read-only.
  - **Not done, on purpose:** the Dispatch board's envelope badge waits for the drafts (P4), when a
    click has something to open. "Not for us" / "Handled by phone" closes are not built. Today a row
    closes only on proof from Outlook. A person's close would contradict the gateway's next read unless
    the gateway learns it, and that belongs with P4's command side.
- 2026-11-27 — **The measure week's report is built** (owner: "build everything on our side while Simo
  finishes"). Settings › Broker mail › Measure week, `GET /api/broker-mail/week?from=`, admin only.
  It answers every §8 line from the envelope rows and the gateway's run counts. Rules:
  `brokerMailWeekContract.ts`. Choices made at build:
  - **"Messages in" exists per day only.** `mail_gateway_cycles.counts` is company-wide per run, so the
    per-mailbox figures are about external mail, the rows themselves. Run counts are kept 14 days, so
    an older week shows rows and says its run counts are gone.
  - **Subject versus body.** The token rule moved from the gateway into shared (`brokerMailTokensIn`).
    The report applies it to the stored subject: a `one` row whose matched reference is not in its
    subject needed the body. One rule, two readers.
  - **"Would have texted"** replays P3's rule with today's settings. Night = the SMS quiet window. A
    night backup notice counts only if the email was still unanswered when the window ended (Q-BM12).
  - **The hand check** is a fixed 50-row pick per first day (rows on the page's two open queues,
    ordered by a hash of their id). The verdicts are a person's and are not stored.
  - **Is the load the owner's?** Through mcleod's index (`readFleetDispatchers`); new boundary edge
    `broker-mail -> mcleod`.
- 2026-11-27 — **P4 built: reply drafts** (owner: "build everything on our side while Simo finishes").
  Two merges, because a column and its first reader ship apart: P4-a is migration 0656 alone, P4-b is
  everything that uses it. Choices made at build:
  - **Four call shapes, not D-BMR4's four.** (5) find the email by the `internetMessageId` 360 stored;
    (6) list the Drafts folder's messages on that conversation, ids only; (7) `createReply` with our
    text as its `comment`; (8) DELETE under `mailFolders/drafts`. There is no PATCH: createReply's
    comment writes the text in the same call, above the broker's quoted message. Deleting under Drafts
    means a draft the dispatcher already sent (moved to Sent Items) answers 404 and survives. The
    writes live in `graphWrite.ts`, apart from the GET-only client. Each one re-checks its URL's shape,
    so a GET URL can never be POSTed.
  - **Reply, not reply-all.** The draft goes to the broker who wrote. The dispatcher adds anyone else
    in Outlook before pressing Send.
  - **Never step on a human:** any draft already in the email's conversation stands 360 back
    (`person_draft_found`). An answer that arrives first drops the draft in `mailgw_claim_drafts`.
    When the owner answers in their own words, 360's draft is deleted.
  - **The facts are the board's own rows** (`readLoadStatusFacts` in livemap, the pattern
    `readDriverDispatch` set; new edge `broker-mail -> livemap`). A broker is never told a different
    ETA from the one on the dispatcher's screen. A load the board shows on no truck gives only what
    the load row says.
  - **The fact check** (`draftFactCheck`, shared) refuses a model draft with any number, or any
    two-letter state code, the facts lack. Its stated limit: a city written out in words is not
    checked, because no list of cities exists. The facts give only the next stop's city, and the
    prompt forbids any other. An EDITED text is not checked: those are the dispatcher's words.
  - **Owner-only acts.** Compose, "Put draft in Outlook", "Handled by phone" and "Not for us" belong to
    the mailbox's owner alone. An admin who sees everyone's mail can read the panel but cannot write in
    a dispatcher's name. Queue and close are audited; compose is on the cost ledger.
  - **Model:** `BROKER_MAIL_DRAFT_MODEL`, default the catch-up's small model, as the plan ruled.
  - **The wake-up invoke is NOT built.** It needs `lambda:InvokeFunction` for the app server's role.
    D-BMR15 keeps that role away from the gateway, and the setup script's `--check` simulates exactly
    that. A draft therefore waits for the next one-minute run, and the panel says "within a minute".
    If the owner wants it instant, that is one IAM statement in `setup.sh` plus its `--check` case.
  - **Until Simo gives the scope `Mail.ReadWrite`,** every draft ends `refused` and the panel says
    Microsoft does not let 360 write drafts yet. Nothing is routed around it.
  - **Not done:** the Dispatch board's envelope badge, the "draft ready" link in the dispatcher's text,
    and P5's learning notes.

## Sources

- Microsoft, RBAC for Applications in Exchange Online — https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- Microsoft, Conditional Access for workload identities — https://learn.microsoft.com/en-us/entra/identity/conditional-access/workload-identity
- Microsoft, workload identity federation considerations — https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-considerations
- Microsoft, AWS workload identity with Entra Agent ID — https://learn.microsoft.com/en-us/entra/agent-id/integrate-aws-agent
- Microsoft Graph, message delta — https://learn.microsoft.com/en-us/graph/api/message-delta
- Microsoft Graph, mailFolder delta — https://learn.microsoft.com/en-us/graph/api/mailfolder-delta
- Microsoft Q&A, conversationId — https://learn.microsoft.com/en-au/answers/questions/5883983/microsoft-graph-webhook-conversationid-changes-whe
- Practical365, RBAC for Applications — https://practical365.com/rbac-for-applications/
- AWS, outbound identity federation — https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_outbound.html
- Supabase, Postgres roles — https://supabase.com/docs/guides/database/postgres/roles
