# T2 — transport and the write pipeline (McLeod API Kit v2, Track T)

**Status:** PLAN, 2026-11-27, against `origin/main` `6c13bf033` (migrations end at `0653`). Index:
`../MCLEOD-API-KIT-PLAN-V2.md`. Decisions are the register's (`../DECISION-REGISTER-2026-11-20-API-KIT.md`); every
D-MK id below is its. Every file:line was re-read on that commit. Migration numbers are the next free one at merge
(D-MK18); the order is fixed here.

**Interfaces chat 2 and chat 3 build on** (stable names; T1 and T3 must not restate them):
- shared: `packages/shared/src/mcleodApi.ts` (agent report contracts), `mcleodWriteOperations.ts` (the operation
  registry, D-MK7), `mcleodWriteTunables.ts` (D-MK10, D-MK24), `mcleodWriteContract.ts` (office/driver read shapes);
- SQL: `mcleod_write_requests`, `mcleod_write_events`, `mcleod_write_switches`, `mcleod_test_companies`,
  view `mcleod_write_state`, `is_mcleod_test_company(org, company)`, `mcleod_write_enqueue(...)` (the one insert door
  every origin uses), and the enqueue sub-block inside `driver_complete_stop` (§T-4.6);
- API: `modules/mcleod/index.ts` exports `readStopWriteStates(admin, orgId, stopIds)` and `readWriteExceptions(admin,
  orgId, sinceIso)` — `loads` code never names the view (council 1-pipeline "The one reader").

**Why the transport is shaped this way** (D-MKT1/D-MKT2 of spec C, kept): the VM pulls work over HTTPS and calls `/ws`
on the LAN; nothing connects inbound (`mail.md:36-42`). Delivery is at-least-once; the effect is at-most-once per send
by the `begin_send` fence and exactly-once in practice by read-before-write. `mcleodApi.mjs` is the only door to `/ws`
as `connection.mjs` is to SQL.

---

## T-1 MK0 tables and the agent's report routes

**What changes for a user.** Nothing visible; the McLeod settings page can later show whether the connector reached
McLeod's API.

**Files.**
- New `supabase/migrations/<next>_mcleod_api_mk0.sql` (module `mcleod`).
- New `packages/shared/src/mcleodApi.ts` (+ `.test.ts`); one export line in `packages/shared/src/index.ts`. Not
  `tms.ts`: it is 499 lines (`wc -l`, 2026-11-27).
- New `apps/api/src/modules/mcleod/mcleodApi/{discovery,health,parity}.ts` (+ tests).
- New `apps/api/src/modules/mcleod/routes/tmsMcleodApi.ts`, registered by one line
  `registerTmsMcleodApiRoutes(router)` after `registerTmsLumperRoutes(router)` (`routes/tmsIngest.ts:126`). It
  inherits the ingest-token middleware (`:100-117`), so no new mount and no route-ledger entry (`/api/tms` is
  `testing/routeLedger.ts:48`).
- `scripts/table-modules.json`, `scripts/table-writers.json`, `scripts/table-lifecycle.json` (4 entries each),
  `apps/api/src/modules/org/dataRetentionPolicy.ts` (parity rule), `supabase/schema.generated.sql` (regenerated),
  `supabase/tests/rls.test.mjs` (hand seeds).

**Migration DDL.**
```sql
-- What /ws can do on THIS install, learned by MK0, newest row per (org, company, key) wins. Append-only: "what did
-- discovery say when we switched writes on" must stay answerable (D-MK11 stores the K13 precision here).
create table public.mcleod_api_capabilities (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity unique,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  company_id    text not null check (length(company_id) between 1 and 10),
  key           text not null check (key ~ '^[a-z][a-z0-9_.]{2,63}$'),  -- e.g. 'date_mode', 'time_precision_s',
                                                                         -- 'stop_fields', 'op.stop_clear'
  value         jsonb not null check (octet_length(value::text) <= 8192),
  discovery_id  uuid references public.mcleod_api_discoveries(id) on delete restrict,
  recorded_by   uuid,            -- no FK (D-MK6 rule): a person when set by hand, null when set from a discovery
  recorded_at   timestamptz not null default now()
);
create index mcleod_api_capabilities_current on public.mcleod_api_capabilities (org_id, company_id, key, seq desc);

-- One row per org and connector instance; the only mutable table here (infra layer).
create table public.mcleod_api_agent_status (
  org_id              uuid not null references public.organizations(id) on delete cascade,
  instance_id         text not null check (length(instance_id) between 1 and 64),
  agent_version       text check (length(agent_version) <= 40),
  last_report_at      timestamptz not null,
  last_claim_at       timestamptz,
  ws_last_ok_at       timestamptz,
  ws_error_class      text check (ws_error_class in ('transient','auth_failed','tls_pin','refused','date_mode_unset')),
  breaker_open_until  timestamptz,
  writes_on_vm        boolean not null default false,
  parity_on_vm        boolean not null default false,
  primary key (org_id, instance_id)
);

create table public.mcleod_api_discoveries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  ran_at        timestamptz not null,
  agent_version text not null check (length(agent_version) <= 40),
  phase         text not null check (phase in ('A','prove')),
  report        jsonb not null check (octet_length(report::text) <= 1048576),
  docs_gz       bytea check (docs_gz is null or octet_length(docs_gz) <= 8388608),  -- McLeod's pages: DB only, never git
  created_at    timestamptz not null default now()
);

create table public.mcleod_api_parity_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id text not null check (length(company_id) between 1 and 10),
  feed text not null check (feed in ('movements')),
  ran_at timestamptz not null,
  sql_count integer not null check (sql_count >= 0), api_count integer not null check (api_count >= 0),
  matched integer not null check (matched >= 0), mismatched integer not null check (mismatched >= 0),
  in_flight integer not null check (in_flight >= 0), only_sql integer not null check (only_sql >= 0),
  only_api integer not null check (only_api >= 0),
  field_mismatch jsonb not null default '{}' check (jsonb_typeof(field_mismatch) = 'object'),
  sample_ids text[] not null default '{}' check (cardinality(sample_ids) <= 50),
  page_cap_hit boolean not null,
  change_read text not null check (change_read in ('ok','beyond_audit','skipped')),
  change_rows integer not null check (change_rows >= 0),
  created_at timestamptz not null default now()
);
create index mcleod_api_parity_runs_org_time on public.mcleod_api_parity_runs (org_id, feed, ran_at desc);

alter table public.mcleod_api_capabilities enable row level security;
alter table public.mcleod_api_agent_status enable row level security;
alter table public.mcleod_api_discoveries  enable row level security;
alter table public.mcleod_api_parity_runs  enable row level security;
-- No client policies: deny-all; the API reads with the service role and org-filters itself.
-- Append-only trigger (MK011, the 0532 shape) on capabilities and discoveries; parity rows are deleted only by retention.
```
(`mcleod_api_discoveries` is created before `mcleod_api_capabilities` in the file because of the FK.)

**Routes** (agent side, all behind the ingest token; each validates with a shared Zod schema and answers 400
`invalid_payload` with the first issue):

| Route | Body → answer | Writes |
|---|---|---|
| `POST /api/tms/mcleod-api/discovery` | `mcleodApiDiscoveryReportSchema` (12 MB body limit on this route only) → `{ id }` | insert discovery; insert one capability row per measured key |
| `POST /api/tms/mcleod-api/health` | `mcleodApiHealthReportSchema` → `{ ok: true }` | UPDATE `mcleod_api_agent_status`, then INSERT the full row when 0 rows (no `.upsert`, `lint:upserts`) |
| `POST /api/tms/mcleod-api/parity` | `mcleodApiParityRunSchema` → `{ id }` | insert run |

The 12 MB limit: the router mounts `json({ limit: "8mb" })` at `routes/tmsIngest.ts:120` before any route; the
discovery route is therefore registered with its own `json({ limit: "12mb" })` **before** that line, inside the same
token middleware (the middleware is `:100-117`, so placement between `:117` and `:120` keeps the token check first).

**Shared contracts** (`mcleodApi.ts`): `mcleodApiDiscoveryReportSchema` (spec C §3.5's contract: `ws_origin_host_hash`
is the sha256 of the host, never the host), `mcleodApiHealthReportSchema`, `mcleodApiParityRunSchema`,
`MCLEOD_API_CAPABILITY_KEYS` (the closed list of `key` values with a Zod schema per key), `McleodApiHealth` (office read).

**Tests (quoted titles).**
- `tmsMcleodApi.test.ts`: "every McLeod API report route answers 401 without the ingest token, before the body is
  read"; "a discovery report larger than 8 MB and under 12 MB is accepted on the discovery route only"; "a health
  report updates the status row and inserts it only when none exists"; "every McLeod API report write is scoped to
  the token's org" (`expectOrgScoped`).
- `mcleodApi.test.ts`: "the discovery report schema has no field that can carry a host, a user name or a token";
  "every capability key has a value schema".
- `rls.test.mjs` seeds for the four tables (the 0526 `print_jobs` form).

**Gates.** `lint:migrations`, `lint:rls` (four `enable row level security`), `lint:table-modules`/`-writers`/
`-producers`/`-lifecycle` (capabilities `time` 50/day retention null; status `fleet`; discoveries `time` 5/day
retention null; parity `time` 400/day retention 120 → `RETENTION_RULES`), `lint:schema-snapshot`, `lint:upserts`,
`lint:filesize`.

**Staging check.** `GET /api/version` on staging names the migration; `select count(*) from mcleod_api_agent_status`
answers 0. Nothing posts on staging (no VM feeds it, index §3).

**Rollback.** Revert the code; the tables stay, unread (new tables, additive).

**Release dependency.** Must be in **production** before T-2's code can report anything: the VM posts only to production.

---

## T-2 The `/ws` client, the VM scripts, and `lint:mcleod-secrets`

**What changes for a user.** Nothing until the connector update (CU-1) installs it; then nothing until McLeod's API
settings are typed in on the VM.

**Files.**
- New `tools/mcleod-agent/mcleodApi.mjs` (+ `.test.mjs`), `apiDiscover.mjs` (+ test), `wsSurface.mjs`,
  `fakeMcleod.mjs` (test-only `node:https` server; its certificate is generated at test time by `node:crypto`, so no
  PEM is committed).
- `tools/mcleod-agent/agent.mjs`: the `CFG.mcleod` block (`:180-197`) is replaced by a read of `mcleod-ws.env`
  (below); `fetchFromMcleod` (`:333-470`, which sets `AnywhereCompanyID` at `:347`) moves into `mcleodApi.mjs`, so
  the new gate rule does not fire on `agent.mjs`; new flags `--api-discover`, `--schema-check` (T-8 adds the body).
- `tools/mcleod-agent/service.mjs`: `serviceConfigProblems` (`:236-243`) gains the API-line checks of spec C §5.9;
  new `validateWsUrl` beside `validateIngestUrl` (`:38`).
- `tools/mcleod-agent/schedule.mjs`: `serviceJobs` (`:91`) gains `apiFeed` and `writes`, both default off (the
  `lumperFeed` form, `:87-91`).
- **Settings file (D-MK38, V4-14).** Every API Kit setting lives in `C:\Silvicom\connector\mcleod-ws.env`, read by
  the agent itself with `node:util` `parseEnv` (absent file = every API line off), so the scheduled task's
  `--env-file=connector.env` action is not edited.
- New `tools/mcleod-agent/windows/set-mcleod-api.ps1` (+ `.test.ps1`): modes `-Configure`, `-Parity on|off`,
  `-Writes on|off -WriteCompanies <ours>`, `-Repin`, `-Rotate`; secrets at a hidden prompt; ACL `SYSTEM:R`,
  `Administrators:F`, inheritance removed (the `set-connector-line.ps1` shape).
- New `tools/mcleod-agent/windows/register-connector-task.ps1 -Check` (reads the task's restart-on-failure setting
  and prints it; OPS-4).
- `tools/mcleod-agent/windows/update-connector.ps1`: the success check's pattern (`:232`) gains the `/ws` failure
  lines `ws auth_failed|ws tls_pin|ws date_mode_unset`; the manifest is regenerated by `windows/manifest.mjs`.
- `scripts/check-agent-syntax.mjs`: `AGENT_RULES` (`:71`) gains two rules; `except` becomes `string | string[]`
  (the loop at `:123-124` compares one string today).
- New `scripts/check-mcleod-secrets.mjs` and root `package.json` `lint:mcleod-secrets` + its `"//lint:mcleod-secrets"`
  comment; `.github/workflows/ci.yml` `gates` job runs it by name (CLAUDE.md: a gate in neither list is not a gate).
- **Agent-tree scrub, same PR.** The SQL server address, server name and SQL login names in
  `tools/mcleod-agent/{config.example.env,connector.example.env,connection.mjs,connection.test.mjs,launchd/install-roster-sweep.sh,review.test.mjs,windows/set-lumper-feed.test.ps1}`
  and `review/{CONNECTOR-ON-THE-VM.md,LETTER-TO-ALEX.md,README.md,SILVICOM-GRANTS.sql,SILVICOM-READ-ROUTINE.sql,build-routine.mjs,REQUEST-TO-ALEX-2026-11-13-*.md}`
  become placeholders (`REPLACE_ME` in example env files; RFC 5737 `192.0.2.1` in tests; `<read-only SQL login>` in
  prose). Exception, stated in the PR: `SILVICOM-GRANTS.sql` is the file Alex runs; its `GRANT … TO <login>` lines
  keep a `:login` sqlcmd variable (`-v login=…` on his side), and `review.test.mjs:61,78` match the variable. This is a
  connector commit (the review files are in the VM manifest), so it rides CU-1, never alone.

**`mcleodApi.mjs` rules** are spec C §3.2 rules 1–9 with these register changes:
- rule 3 (auth) per D-MK37: re-login cap = `min(15 min, measured lifetime ÷ 2)` from K3; when the lifetime is under
  15 min the client re-logs in when the token is within 2 min of expiry; `POST /users/logout` after every write batch
  in `login` mode (OPS-10);
- rule 9 (logging) per D-MK14: McLeod's refusal text is redacted on the VM before it leaves (digit runs of 6+ →
  `#`, e-mail shapes → `<email>`), capped 500 chars, and only then put in the settle body; `observed` is built from
  `OBSERVED_ALLOWLIST` (`stop_status`, `actual_arrival`, `actual_departure`, `movement_status`, `company_id`,
  `audit_user_is_ours`), every other key dropped;
- the SSN strip is in `write()` on the final body: any key matching `/social|ssn/i` is removed and its presence
  logged as `ws write stripped 1 key` (OPS-15).

**Gate rules.**
```js
// check-agent-syntax.mjs AGENT_RULES
{ re: /\bAnywhereCompanyID\b|\/users\/login|\/dispatch\/clearStop/,
  why: "a /ws call outside mcleodApi.mjs — one door to McLeod's API (D-MKT1)", except: ["mcleodApi.mjs", "fakeMcleod.mjs"] },
{ re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
  why: "TLS verification switched off — pin the certificate instead (D-MKT1)" },
```
`lint:mcleod-secrets` (V4-12's text, verbatim rules): refuse `MCLEOD_WS_URL=https?://` other than `REPLACE_ME`; any
64-hex value after `CERT_SHA256=`; `-----BEGIN` in `tools/mcleod-agent/**` and `docs/plans/mcleod/**` (the mTLS test fixtures under `apps/api/src/lib/__fixtures__/mtls/` are EFS's and out of scope); any committed `*.env*` whose `MCLEOD_WS_USER`,
`MCLEOD_WS_USERNAME`, `MCLEOD_WS_TOKEN`, `MCLEOD_WS_PASSWORD` or `MCLEOD_TEST_COMPANY` value is not `REPLACE_ME`; any
file under `tools/mcleod-agent/fixtures/` larger than 64 KB (crawled McLeod pages never enter git, D-MK39); and any
valid dotted-quad IPv4 literal (each octet 0–255, so a version string like `15.0.2120.1` does not match) in `tools/mcleod-agent/**` or `docs/plans/mcleod/**` outside `192.0.2.0/24`, `127.0.0.1`, `0.0.0.0`
(this is why the scrub ships in the same PR).

**Tests (quoted titles)** — `mcleodApi.test.mjs`: "every call carries Accept json, the mapped AnywhereCompanyID and
the auth header"; "a login token is refreshed once on 401 and the call repeated once"; "a second 401 refuses every
call for 15 minutes"; "a static token's 401 fails at once"; "a pinned fingerprint mismatch is refused even with a
valid CA"; "an IP host without a server name is refused"; "an http URL is refused at start"; "a read is retried
after 1, 2 and 4 seconds"; "a write is never retried by the client"; "a 4xx becomes WsRefused with McLeod's text";
"at most one call is in flight and calls start at least 500 ms apart"; "three transient failures open the breaker
for 15 minutes"; "a path outside the allowlist is refused before a byte is sent"; "the log line carries no query,
body, token, user or host"; "refusal text leaves the VM redacted and capped at 500 characters"; "a key named like a
social security number is stripped from the final write body"; "observed keeps allowlisted keys only".
`apiDiscover.test.mjs`: "the Phase A report hashes the host and never includes it"; "docs are gzipped under 8 MB".
`service.test.mjs`: "writes on without write companies refuses to start"; "a write company missing from the
company map refuses to start"; "writes on without a certificate pin refuses to start"; "an absent mcleod-ws.env
turns every API line off". `schedule.test.mjs`: "api_parity and writes are not scheduled unless their lines say on".
`set-mcleod-api.test.ps1`: "-Configure writes only the named keys, without BOM, with the locked ACL"; "-Writes on
refuses until a discovery report shows TLS, auth and search ok". `check-mcleod-secrets` self-test: "the secrets gate
refuses a committed certificate block, a /ws URL, a pinned fingerprint, a real token value and a LAN IP".

**Gates.** `lint:agent-syntax` (+ scratch proof of each new rule, the file's practice at `:67`), `lint:mcleod-secrets`
(new, in `ci.yml` `gates`), `lint:cli-streams`, gitleaks.

**Staging check.** None possible (agent code). CI runs the agent tests.

**Rollback.** `update-connector.ps1 -Commit <previous>` on the VM (its own backup/restore).

**Release dependency.** Merged after T-1 is in production; reaches the VM only in CU-1 (D-MK38).

---

## T-3 The write token, the egress IP record, the write limiter

**What changes for a user.** Nothing.

**Files.** New migration `<next>_mcleod_write_tokens.sql` (mcleod); `apps/api/src/lib/ingestToken.ts` reused
(`hashIngestToken` `:10`, `generateIngestToken` `:15`); `apps/api/src/scripts/issueMcleodToken.ts` gains
`--scope=writes` (same clipboard-only behaviour, same audit family: action `integration.mcleod.write_token_issued`);
new `apps/api/src/modules/mcleod/mcleodApi/writeToken.ts` (+ test) with `requireMcleodWriteToken` middleware;
`apps/api/src/app.ts` (`ingestLimiter` `:361-367` gains `skip: (req) => req.path.startsWith("/mcleod-api/writes")`);
manifests as T-1.

**Migration DDL.**
```sql
create table public.mcleod_write_tokens (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix    text not null check (length(token_prefix) between 4 and 16),
  issued_by       uuid,                                   -- no FK (D-MK6)
  issued_at       timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid,
  last_used_at    timestamptz,
  last_egress_ip  inet,
  pinned_egress_ip inet,                                  -- null until Alex confirms a static address (D-MK13)
  check (revoked_by is null or revoked_at is not null)
);
create unique index mcleod_write_tokens_one_live on public.mcleod_write_tokens (org_id) where revoked_at is null;
alter table public.mcleod_write_tokens enable row level security;
-- Issuing a token stamps revoked_at on the org's live one in the same transaction (function
-- mcleod_write_token_issue(org, hash, prefix, actor), service role only).
```

**Middleware.** Header `X-Mcleod-Write-Token`; hash lookup must return a live row **of the same org as the ingest
token** (`req.tms.orgId`), else 401 `write_token_invalid`. On every call: `last_used_at = now()`; when
`req.ip` (`trust proxy 1`, Caddy is one hop) differs from `last_egress_ip`, the row is updated and a
`mcleod_write` info finding is raised once per org per day (dedupe key `mcleod_egress_ip:<org>:<day>`, 3-outcomes F8).
When `pinned_egress_ip` is set and differs → 403 `egress_ip_refused` and a critical finding. The pin is set only by
the platform console (T-5) with Alex's written confirmation quoted in the platform audit row.

**Limiter.** `mcleodWriteLimiter`: 900 requests per 15 min keyed by `sha256(write token)`; the ingest limiter skips
the write paths, because a claim/begin_send/settle triple per request on the shared 300-per-15-min IP budget
(`app.ts:361-367`) would stall the mirror during a backlog (V4-13).

**Tests.** `writeToken.test.ts`: "a write route refuses a missing or revoked write token with 401"; "a write token of
another org is refused even with a valid ingest token"; "a changed egress IP is recorded and raises one finding per
day"; "a pinned egress IP refuses another address with 403"; "issuing a write token revokes the org's previous one".
`app.test.ts`: "the ingest limiter does not count McLeod write calls".

**Gates.** As T-1; `lint:upserts`. **Staging check.** Issue a staging write token for the staging org with the script;
a claim with it answers `writes:"off"` once T-5 is there. **Rollback.** Revert code; table inert.
**Release dependency.** Production before T-5's claim route can be called by the VM.

---

## T-4 The pipeline migration and the matrix

**What changes for a user.** Nothing: every switch is `off` (no row = off).

**Files.**
- New `supabase/migrations/<next>_mcleod_write_pipeline.sql` (mcleod). Header: the house register (gap / why this
  shape / rejected: attempts split, D-MK6; status column / error codes / deploy window / rollback). It contains one
  `-- cross-module-waiver: driver_complete_stop (loads) is re-created from M-A's body to add the enqueue sub-block
  (D-MK19)` line.
- New `packages/shared/src/mcleodWriteOperations.ts` (+ test), `mcleodWriteTunables.ts` (+ test).
- New `supabase/tests/mcleod-writes.test.mjs` (§T-4.8).
- `supabase/tests/rls.test.mjs` (seeds), `supabase/tests/definer-rpc-grants.test.mjs` (the new functions),
  `apps/api/src/modules/org/dataRetentionForbidden.ts` (`RETENTION_FORBIDDEN` `:12` gains the four tables),
  manifests, `schema.generated.sql`.

**Needs:** N-8 (M-A) applied — its `driver_complete_stop` body is the base (D-MK19); N-6 applied (`mcleod_stop_id`,
`mcleod_removed_at` on `load_stops`); T-1 applied.

### T-4.1 Operations registry (D-MK7)
```ts
// packages/shared/src/mcleodWriteOperations.ts — the only list of operations; SQL checks the subject KIND's shape,
// the API refuses an operation not listed here, and the agent claims only operations it has an adapter for.
export const MCLEOD_WRITE_SUBJECT_KINDS = ["stop", "image", "driver", "unit"] as const;
export const MCLEOD_WRITE_OPERATIONS = {
  stop_clear: { subject: "stop", resend: "read_decides", phase: "MK3" },
  // MK4/MK5 operations are added by T3's PRs that build their adapters (resend: "office_decides" for images and
  // driver_create — never re-sent automatically after an unknown outcome, D-MK10).
} as const;
```
`stop_clear` is the one stop operation: `clearStop` carries both dates, and it is enqueued when the driver completes
the stop (arrival = the stop's `arrived_at`, departure = the completion time). Arrival-only writes are not built: the
register names only `stop_clear` (D-MK12), and the arrival still reaches McLeod with the departure.

### T-4.2 Tunables (D-MK10, D-MK24)
```ts
export const MCLEOD_WRITE_TUNABLES = {
  claimSize: 1, leaseS: 300, beginSendTimeoutS: 10, writeDeadlineS: 30, quietAfterSendS: 300,
  settleAttempts: 4, settleTimeoutS: 60, maxSendsUnknownOutcome: 3,
  notVisibleRereadS: 60, notVisibleReads: 3, staleIntentH: 72, openHorizonD: 8,
  futureToleranceS: 300,
} as const;
// quiet ≥ begin_send timeout + write deadline + 30 s margin: 300 ≥ 10 + 30 + 30
```
The claim response carries the tunables, so the agent never holds its own copy. **One labelled copy exists:** the SQL
enqueue's future bound is a literal `interval '300 seconds'` in `driver_complete_stop` (SQL cannot import TS, and
D-MK19 fixes M-A's signature, so it cannot be passed in). It is a workaround for that, pinned by the shared test
"the SQL future-time bound equals futureToleranceS" (which reads the newest migration defining the function), and it
is removed when the function takes the bound as an argument at the next signature change.

### T-4.3 DDL
```sql
-- Test companies (D-MK12). Inserted only by the platform console (T-5); append-only.
create table public.mcleod_test_companies (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  company_id        text not null check (length(company_id) between 1 and 10),
  metadata_name     text not null check (length(btrim(metadata_name)) between 1 and 120), -- /metadata's company name, read by MK0
  platform_admin_id uuid not null references public.platform_admins(id) on delete restrict,
  reason            text not null check (length(btrim(reason)) between 5 and 500),
  added_at          timestamptz not null default now(),
  unique (org_id, company_id)
);

create function public.is_mcleod_test_company(p_org uuid, p_company text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mcleod_test_companies t where t.org_id = p_org and t.company_id = p_company) $$;

-- Intent. Immutable. id = the client action id (driver_app) or a server uuid (every other origin).
create table public.mcleod_write_requests (
  id             uuid primary key,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  operation      text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),
  subject_kind   text not null check (subject_kind in ('stop','image','driver','unit')),
  company_id     text not null check (length(company_id) between 1 and 10),
  origin         text not null check (origin in ('driver_app','office','office_retry','sweep','job','prove')),
  load_id        uuid references public.loads(id) on delete restrict,
  stop_id        uuid references public.load_stops(id) on delete restrict,
  movement_id    text check (movement_id is null or length(movement_id) between 1 and 20),
  mcleod_stop_id text check (mcleod_stop_id is null or length(mcleod_stop_id) between 1 and 20),
  stop_type      text check (stop_type in ('pickup','dropoff')),       -- load_stops.kind's vocabulary
  customer_id    text check (customer_id is null or length(customer_id) between 1 and 20),
  image_send_id  uuid,          -- FK added by T3's MK4 migration, which creates mcleod_image_sends
  driver_id      uuid,          -- no FK (merge_driver; lint:driver-references)
  vehicle_id     uuid,
  trailer_id     uuid,
  payload        jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  expected       jsonb not null check (jsonb_typeof(expected) = 'object'),
  supersedes     uuid unique references public.mcleod_write_requests(id) on delete restrict,
  requested_by   uuid,          -- no FK (D-MK6)
  requested_at   timestamptz not null default now(),
  subject_id     text generated always as (coalesce(stop_id::text, image_send_id::text, driver_id::text,
                   vehicle_id::text, trailer_id::text, org_id::text || ':' || company_id || ':' || mcleod_stop_id)) stored,
  subject_ref    text generated always as (case subject_kind
                   when 'stop'   then coalesce(stop_id::text, org_id::text || ':' || company_id || ':' || mcleod_stop_id)
                   when 'image'  then image_send_id::text
                   else coalesce(driver_id, vehicle_id, trailer_id)::text || ':' || md5(payload::text) end) stored,
  constraint mcleod_write_requests_retry   check ((origin = 'office_retry') = (supersedes is not null)),
  constraint mcleod_write_requests_ref     check (subject_ref is not null),
  constraint mcleod_write_requests_stop    check (subject_kind <> 'stop' or (mcleod_stop_id is not null and stop_type is not null
                                                  and (origin = 'prove' or (load_id is not null and stop_id is not null and movement_id is not null)))),
  constraint mcleod_write_requests_image   check (subject_kind <> 'image' or image_send_id is not null),
  constraint mcleod_write_requests_driver  check (subject_kind <> 'driver' or driver_id is not null),
  constraint mcleod_write_requests_unit    check (subject_kind <> 'unit' or num_nonnulls(vehicle_id, trailer_id) = 1),
  constraint mcleod_write_requests_prove   check (origin <> 'prove' or stop_id is null)
);
create unique index mcleod_write_requests_one_intent on public.mcleod_write_requests (operation, subject_ref)
  where origin <> 'office_retry';                                              -- D-MK8
create index mcleod_write_requests_org_time on public.mcleod_write_requests (org_id, requested_at);
create index mcleod_write_requests_subject  on public.mcleod_write_requests (org_id, operation, subject_id, requested_at);
create index mcleod_write_requests_stop     on public.mcleod_write_requests (stop_id) where stop_id is not null;

-- Switches (D-MK12). Append-only; newest seq per (org, operation, company) wins; no row = off.
create table public.mcleod_write_switches (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity unique,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  operation         text not null check (operation ~ '^[a-z][a-z_]{2,39}$'),
  company_id        text not null check (length(company_id) between 1 and 10),
  mode              text not null check (mode in ('off','test','canary','live')),
  canary_scope      jsonb,
  live_stop_types   text[],
  approval_ref      text check (approval_ref is null or length(btrim(approval_ref)) between 10 and 1000),
  allowed_hours     jsonb,        -- D-MK36: null = any hour; {"days":[1..7],"from":"HH:MM","to":"HH:MM"} carrier time
  platform_admin_id uuid references public.platform_admins(id) on delete restrict,
  changed_by        uuid not null,                         -- no FK
  reason            text not null check (length(btrim(reason)) between 5 and 4000),  -- D-MK34 briefing
  briefing_read_by  text check (briefing_read_by is null or length(btrim(briefing_read_by)) between 2 and 120),
  changed_at        timestamptz not null default now(),
  constraint mcleod_write_switches_console  check (mode = 'off' or platform_admin_id is not null),
  constraint mcleod_write_switches_canary   check ((mode = 'canary') = (canary_scope is not null)),
  constraint mcleod_write_switches_live     check (live_stop_types is null or mode = 'live'),
  constraint mcleod_write_switches_briefing check (mode not in ('canary','live') or briefing_read_by is not null)
);
create index mcleod_write_switches_current on public.mcleod_write_switches (org_id, operation, company_id, seq desc);

-- Facts (D-MK6). Append-only; ordered by seq, never by time. Lease expiry = at + lease_s, derived.
create table public.mcleod_write_events (
  id            uuid primary key,          -- agent-supplied on settle (idempotent retries); server-made otherwise
  seq           bigint generated always as identity unique,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  request_id    uuid not null references public.mcleod_write_requests(id) on delete restrict,
  kind          text not null check (kind in ('leased','send_started','transient','applied_unverified',
                                              'confirmed','refused','conflict','already_in_mcleod')),
  lease_id      uuid,
  lease_s       integer check (lease_s between 30 and 3600),
  switch_id     uuid references public.mcleod_write_switches(id) on delete restrict,
  backoff_s     integer check (backoff_s between 0 and 3600),
  reason_code   text check (reason_code ~ '^[a-z][a-z_]{2,39}$'),
  mcleod_status integer check (mcleod_status between 100 and 599),
  mcleod_text   text check (length(mcleod_text) <= 500),
  observed      jsonb check (observed is null or (jsonb_typeof(observed) = 'object' and octet_length(observed::text) <= 4096)),
  instance_id   text not null check (length(instance_id) between 1 and 64),
  agent_version text check (length(agent_version) <= 40),
  at            timestamptz not null default clock_timestamp(),
  constraint mcleod_write_events_leased     check ((kind = 'leased') = (lease_s is not null and switch_id is not null)),
  constraint mcleod_write_events_lease_self check (kind <> 'leased' or lease_id = id),
  constraint mcleod_write_events_lease_ref  check (kind not in ('send_started','transient','refused') or lease_id is not null),
  constraint mcleod_write_events_reason     check (kind not in ('refused','conflict','already_in_mcleod') or reason_code is not null),
  constraint mcleod_write_events_backoff    check (backoff_s is null or kind in ('transient','applied_unverified'))
);
create unique index mcleod_write_events_one_end on public.mcleod_write_events (request_id)
  where kind in ('confirmed','refused','conflict','already_in_mcleod');
create index mcleod_write_events_request_seq on public.mcleod_write_events (request_id, seq desc);

alter table public.mcleod_test_companies  enable row level security;
alter table public.mcleod_write_requests  enable row level security;
alter table public.mcleod_write_switches  enable row level security;
alter table public.mcleod_write_events    enable row level security;
```

### T-4.4 Triggers and error codes
| Code | Trigger | Rule |
|---|---|---|
| MK010 | before insert on requests, events | the load/stop/request belongs to the row's org; the stop is on that load |
| MK011 | before update or delete on all four tables | append-only (DELETE only by the org cascade; all four in `RETENTION_FORBIDDEN`) |
| MK012 | before insert on events | nothing after an end event of the request |
| MK013 | before insert on switches and test companies | a non-`off` switch row, and every test-company row, names an **active** `platform_admins` row with role `platform_owner` or `platform_admin` (`0070_platform_admins.sql`) |
| MK014 | before insert on switches | `test` only on a company in `mcleod_test_companies` |
| MK015 | before insert on switches | `canary`: scope valid — stop operations `{"stop_types": non-empty ⊆ ["pickup","dropoff"], "customer_ids": non-empty array of strings}`, other operations `{"subject_ids": non-empty}`; **and** a `confirmed` `prove` request of the org + operation whose lease's switch was `test`, **or** operation `stop_clear`, no test company for the org, and `approval_ref` set (R4-3) |
| MK016 | before insert on switches | `live`: `approval_ref` set; stop operations: `live_stop_types` non-empty, and for each type a `confirmed` `driver_app` request of org + operation + company with that `stop_type` whose lease's switch was `canary`; **`dropoff` in `live_stop_types` is refused** until the EDI build of D-MK33 lands (T-12, outcome table); other operations: a `confirmed` request of the operation leased under `canary` |
| MK017 | before insert on test companies | refused when the org has a `loads` row with `source = 'tms'`, `split_part(external_id, ':', 1) = company_id` (`mcleodLoadProjection.ts:294` builds `company:movement`) and status `in_transit` or `delivered` — a company whose freight drivers carry is not a test company (V4-4; production 2026-11-27 has 99 `in_transit` tms loads on the live company) |
`forbid_org_change` on all four tables. The rule "a tenant admin inserts only `off`" is the `_console` CHECK: the tenant
route (T-5) has no platform admin to name.

### T-4.5 Functions (all `volatile`, `security definer`, `set search_path = ''`, `revoke all … from public, anon,
authenticated`, `grant execute … to service_role`)

| Function | Lock | Contract |
|---|---|---|
| `mcleod_write_enqueue(p_org, p_id, p_operation, p_subject_kind, p_company, p_origin, p_subject jsonb, p_payload, p_expected, p_supersedes, p_actor) returns uuid` | none | `insert … on conflict do nothing` (no target: D-MK9/V4-5); returns the id inserted or the existing request's id for `(operation, subject_ref)`; refuses `office_retry` unless the superseded request is the head of its chain and ended `refused`/`conflict`/`already_in_mcleod` |
| `mcleod_write_claim(p_org, p_instance, p_version, p_operations text[], p_companies text[], p_max int)` → setof jsonb | `pg_advisory_xact_lock(hashtext('mcleod_write:' || p_org))` | (1) ends open, unleased requests older than `staleIntentH` and younger than `openHorizonD` as `conflict stale_intent`; (2) leases ≤ `p_max` open requests younger than `openHorizonD`, oldest first, where: no live lease; `max(at + backoff_s) ≤ now()`; newest `send_started` older than `quietAfterSendS`; no older open request with the same `subject_id`; the newest switch row admits it (`test` → `origin='prove'` on a test company; `canary` → stop: `stop_type` and `customer_id` in scope, others: `subject_id` in scope; `live` → stop: `stop_type ∈ live_stop_types`; `allowed_hours` holds in carrier time); inserts `leased` with `lease_s = leaseS` and that `switch_id`; (3) stamps `mcleod_api_agent_status.last_claim_at`. Returns `{request, lease_id, lease_s, sends, applied_reports, payload, expected, tunables}` |
| `mcleod_write_begin_send(p_org, p_request, p_lease, p_instance)` → text | org lock | `go` (inserts `send_started`) only if: not ended; `p_lease` is the newest lease and `at + lease_s - now() ≥ 90 s`; no `applied_unverified`; sends `< maxSendsUnknownOutcome` (`< 1` for `office_decides` operations); the newest switch still admits it. Else `ended`, `lease_lost`, `lease_too_short`, `already_applied`, `send_cap`, `switched_off`. The fleet kill (L1) is checked by the route before the call |
| `mcleod_write_settle(p_org, p_request, p_lease, p_event_id, p_kind, p_reason, p_backoff_s, p_status, p_text, p_observed, p_instance, p_version)` → jsonb | org lock | `p_event_id` already present → return state (idempotent across HTTP retries and deploys, P-10). Ended → return the end. `applied_unverified`/`confirmed`/`already_in_mcleod` accepted from any lease (P-3); `transient`/`refused`/`conflict` only from the newest lease (else return state, insert nothing). `applied_unverified` gets `backoff_s = notVisibleRereadS`; the `notVisibleReads`-th `transient not_visible_yet` after an `applied_unverified` → `conflict accepted_not_visible`; a `transient` with sends = cap → `conflict mcleod_keeps_failing`; an `office_decides` operation's `transient` after a `send_started` → `conflict outcome_unknown` |
| `mcleod_write_prove(p_org, p_actor, p_operation, p_company, p_mcleod_stop_id, p_stop_type, p_payload, p_expected)` → uuid | none | only when the newest switch for (org, operation, company) is `test`; `origin='prove'`, no load/stop |
| `mcleod_write_switch_insert(p_org, p_operation, p_company, p_mode, p_scope, p_live_stop_types, p_approval_ref, p_allowed_hours, p_platform_admin, p_actor, p_reason, p_briefing_read_by)` → uuid | org lock | the one insert door; the triggers judge it |
| `mcleod_test_company_insert(p_org, p_company, p_metadata_name, p_platform_admin, p_reason)` → uuid | org lock | the one insert door |

**Lease and fence arithmetic** (D-MK10): lease 300 s; `begin_send` refuses with < 90 s left; the McLeod call's
absolute deadline is 30 s; so a send can never outlive its lease. The quiet period (300 s) ≥ 10 + 30 + 30.

### T-4.6 `driver_complete_stop`, re-created from M-A's body (D-MK19)
The signature is M-A's, unchanged. One block is added **after** the stop row and photos are written and **before**
the `stop_completed` event insert (0141's insert is `:378-389`; M-A keeps that order), so the event payload can carry
the outcome:
```sql
v_mcleod := 'off';
if p_status = 'completed' and p_mcleod_write and v_load_source = 'tms' then
  begin
    v_mcleod := public.mcleod_stop_clear_outcome(p_org, p_driver, p_load, p_stop, v_now);
      -- returns 'requested' | 'switch_off' | 'no_mcleod_stop_id' | 'removed_in_mcleod' | 'already_departed'
      --         | 'implausible_time' | 'not_dispatched_to_driver', inserting the request only for 'requested'
  exception
    when serialization_failure or deadlock_detected then raise;      -- the outbox retries the whole call
    when others then v_mcleod := 'enqueue_failed:' || sqlstate;     -- evidence commits; W6 critical (D-MK31)
  end;
end if;
-- …the stop_completed event's payload gains 'mcleod_write', v_mcleod
```
`mcleod_stop_clear_outcome` (same migration): switch admits the request for this stop (newest row is `canary` with the
stop in scope, or `live` with its type); `load_stops.mcleod_stop_id` set and `mcleod_removed_at` null; the mirror's
`mcleod_dispatch_stops.status` for that stop is not `D` (D-MK11); `v_now ≤ now() + interval '300 seconds'` and
`v_now ≥` the dispatch's `created_at` (the labelled copy, §T-4.2); the driver is on the current dispatch (D-MK20's
"ever dispatched" evidence returns `late_evidence` earlier in M-A and never reaches this block). Then
`mcleod_write_enqueue(p_org, <action id>, 'stop_clear', 'stop', company, 'driver_app', {load, stop, movement,
mcleod_stop_id, stop_type = load_stops.kind, customer_id = mcleod_dispatch_movements.customer_id}, {arrival_at =
load_stops.arrived_at, departure_at = v_now}, {mirror stop status, actual_arrival, actual_departure, last_seen_at},
null, p_actor_user)`. The company and movement come from `loads.external_id` (`company:movement`). The
`load_events_kind_check` is not touched here (T1 owns it; 0645 last set it).

### T-4.7 The one reader
`mcleod_write_state` (security invoker) is council 1-pipeline's view (`api-kit-council/1-pipeline.md:410-435`) with
two changes: `lease_expires_at` is `l.at + make_interval(secs => l.lease_s)`; `not_before` is
`max(e.at + make_interval(secs => e.backoff_s))`; and the end set includes `already_in_mcleod`.

### T-4.8 The matrix `supabase/tests/mcleod-writes.test.mjs`
Runs every migration in `readdirSync().sort()` order on PGlite (the `mcleod-dispatch-raw.test.mjs` harness), seeds two
orgs, a platform admin, loads and stops through the real tables, prints `RESULT: n passed, m failed` after
`await db.close()`. It replaces the scratch checks in `api-kit-council/pg/` and `api-kit-round4/pg/` (identity,
subtx, switch; `tail.mjs` belongs to T1's S0a matrix; `attempts.mjs` tested the rejected split). Rows, by title:

*Identity (pg/identity.mjs, adopted index):* "a replayed completion with the same action id inserts no second
request"; "a replay with a new action id on the same stop inserts nothing and raises nothing"; "send again chains on
the head and a second send again on the original is refused"; "a sweep enqueuing the same image twice gets one
request"; "two medical-card updates with different values are two requests, the same value twice is one".

*Enqueue inside the driver call (pg/subtx.mjs):* "a check violation in the enqueue leaves the stop completed and
the event says enqueue_failed:23514"; "a unique violation in the enqueue leaves the evidence committed"; "a raised
MK010 in the enqueue leaves the evidence committed"; "a deadlock in the enqueue rolls back the whole call"; "a stop
already departed in McLeod gets no request"; "a time more than five minutes in the future gets no request and says
implausible_time"; "a removed stop gets no request"; "with the fleet kill off the event says off and no request
exists".

*Claim, fence, settle (council pg/t1–t3):* "no switch row leases nothing"; "test mode does not lease a driver_app
request"; "a second claim gets nothing while the lease is live"; "begin_send says go once and the state is sent";
"begin_send refuses a second send on the same lease"; "begin_send refuses with less than 90 seconds of lease left";
"the quiet period after a send blocks an immediate re-lease"; "after the quiet period it is re-leased with
applied_reports=1"; "begin_send refuses a re-send after a 2xx"; "a late 2xx from an expired lease is accepted";
"a transient from an expired lease inserts nothing"; "the same settle event id twice inserts one event"; "the third
not-visible read after a 2xx ends conflict accepted_not_visible"; "a transient at the send cap ends conflict
mcleod_keeps_failing"; "an office_decides operation is never sent twice"; "an older open request on the same stop
holds the newer one"; "an open request older than 72 hours ends conflict stale_intent"; "nothing after an end";
"every pipeline table refuses UPDATE and DELETE"; "org deletion removes the whole pipeline"; "claim at a year's volume
finishes under 100 ms" (≈ 260k events, council t1's measurement).

*Switches and proof chain (pg/switch.mjs, rewritten for D-MK12):* "a tenant row other than off is refused";
"a suspended platform admin cannot switch writes on"; "test on a company not in the test list is refused"; "listing
a company with in-transit loads as a test company is refused"; "an empty canary scope is refused"; "a canary without
a confirmed prove request is refused when the org has a test company"; "a stop_clear canary without a test company
needs an approval reference"; "a driver_create canary without a test company is refused"; "a delivery is not leased
while the canary scope allows pickups only"; "a customer outside the canary scope is not leased"; "live is refused
until every allowed stop type was confirmed under canary"; "live for deliveries is refused until the EDI list
exists"; "live without an approval reference is refused"; "a canary or live row without a briefing reader is
refused"; "an off row stops the next claim"; "a lease outside allowed hours is not granted".

*Access:* "anon and authenticated cannot execute any pipeline function or read any pipeline table";
"is_mcleod_test_company answers for the listed company only".

**Gates.** `lint:migrations`, `lint:migration-ordering` (functions here, their TS callers in T-5: a function reader
ships a merge after its migration), `lint:rls`, `lint:table-*` (requests `time` 1500/day, events `time` 6000/day,
switches `time` 20/day, test companies `time` 1/day; all retention null and in `RETENTION_FORBIDDEN`),
`lint:driver-references` (`driver_id` without FK, stated), definer-grants matrix, the matrix's own `RESULT` line,
`lint:comment-claims` (comments quote the titles above).

**Staging check.** `select count(*) from mcleod_write_switches` = 0; one driver stop completion on staging (a manual
load, `source <> 'tms'`) skips the block, so its event payload has no `mcleod_write` key — checked with `select payload ? 'mcleod_write' from load_events
order by recorded_at desc limit 1` = false.

**Rollback.** Code revert is safe (nothing calls the new functions until T-5). The schema stays (`release.yml:15`:
a rollback never reverses a migration); `driver_complete_stop`'s new block is inert while `p_mcleod_write` is false.

**Release dependency.** Staging before T-5.

---

## T-4b The `mcleod_write` alert category

**Files.** New migration `<next>_mcleod_write_alert_category.sql` (messaging): re-sets
`notification_events_category_check` (last set by `0651_broker_mail_texts.sql`) with `mcleod_write` added;
`packages/shared/src/notificationsContract.ts` `NOTIFICATION_CATEGORIES` (`:17`) gains `mcleod_write` in the same
merge, ahead of the first writer (the 0645 pattern). The catalogue entries go in a new
`packages/shared/src/mcleodWriteAlerts.ts` spread into `ALERT_CATALOGUE` (`alertRouting.ts:144-222`, the
`BROKER_MAIL_ALERTS` pattern at `:6,222`): `alertRouting.ts` is 473 lines, over the 450 warning.
**Tests.** `mcleodWriteAlerts.test.ts`: "every McLeod write alert names its section and none uses the McLeod
connection surface" (D-MK31, R4-6). **Rollback.** None needed (additive). **Release.** Staging before T-5.

---

## T-5 Write API, the platform console, the watch, the office UI

**What changes for a user.** Settings › McLeod fleets shows "McLeod API reached 2 min ago" and the write switches
(read-only for the carrier, with one "Stop" button per operation). The platform console gets a McLeod writes page.
Nothing is written to McLeod.

**Files.**
- `apps/api/src/envMcleodApi.ts` (new collector spread into `env.ts` like `envAds.ts`):
  `MCLEOD_API_WRITES: z.enum(["true","false"]).default("false")` — the fleet kill (L1). AWS SSM
  `/silvicom/{staging,production}/api/MCLEOD_API_WRITES` (`infra/server/fetch-settings.sh:32-33` path convention),
  applied by the `api` service restart; absent = false. It enables nothing by itself (D-MK12).
- `apps/api/src/modules/mcleod/mcleodApi/{writeQueue,writeSwitches,writeWatch,writeReads}.ts` (+ tests);
  `routes/tmsMcleodApi.ts` gains the write routes behind `requireMcleodWriteToken` + `mcleodWriteLimiter`.
- Office routes in new `apps/api/src/modules/mcleod/routes/mcleodApiControl.ts`, registered from
  `routes/integrations.ts` beside the McLeod integration routes (`/api/integrations/mcleod/...`, RT-16: inline gates).
- `apps/api/src/modules/loads/driverLoads.ts`: passes `p_mcleod_write = env.MCLEOD_API_WRITES`; reads the stop write
  states through `mcleod`'s `readStopWriteStates` (chunked with `fetchAllPagedIn`, `packages/shared/src/paging.ts:110`).
- `apps/api/src/modules/loads/dispatchLoads/exceptions.ts`: both `load_events` reads (`:82-95`) page through
  `fetchAllPagedIn` (D-MK32); write exceptions come from `readWriteExceptions`.
- `apps/api/src/schedulers.ts`: `{ name: "mcleod-write-watch", lane: "general", start: startMcleodWriteWatch }` after
  `financial-freshness` (`:98`); `docs/WORKER-DEPLOYMENT.md` gains its row.
- Platform console: `apps/admin-api/src/routes/mcleodWrites.ts` (+ test), mounted `app.use("/admin/mcleod-writes", …)`
  beside `/admin/release` (`apps/admin-api/src/app.ts:60-64`), with `requirePlatformAuth, requireAAL2,
  requirePlatformAdmin` (`releaseApproval.ts:41`) and `requireStepUp` (`middleware/platformAuth.ts:129`) on writes,
  `writePlatformAudit` (`lib/audit.ts:20`); `apps/admin/src/pages/McleodWritesPage.vue` (+ test).
- Web: `components/McleodApiHealthLine.vue`, `McleodWriteSwitches.vue`, `StopMcleodWriteBadge.vue` (+ tests);
  `pages/McleodFleetsSettingsPage.vue`; the load detail's stop row.
- Shared `mcleodWriteContract.ts`: `McleodWriteClaimRequest/Response`, `McleodWriteSettleRequest`,
  `McleodStopWriteState`, `McleodWriteSwitchView`, `MCLEOD_WRITE_REASONS` (code → office sentence, spec C §5.4 list +
  `already_in_mcleod`, `outcome_unknown`, `accepted_not_visible`, `mcleod_keeps_failing`, `stale_intent`,
  `arrival_unknown`, `ambiguous_local_time`).

**Routes.**

| Route | Gate | Does |
|---|---|---|
| `POST /api/tms/mcleod-api/writes/claim` | ingest token + write token + limiter | L1 false → 200 `{writes:"off", why:"env_off"}`, no RPC; else `rpc("mcleod_write_claim")` with `req.tms.orgId` |
| `POST /api/tms/mcleod-api/writes/:id/begin-send` | same | L1 false → `switched_off`; else `rpc("mcleod_write_begin_send")` |
| `POST /api/tms/mcleod-api/writes/:id/settle` | same | `rpc("mcleod_write_settle")`; then `writeWatch.onSettled` |
| `GET /api/integrations/mcleod/api-health` | `requireAnySection(["dispatch","view"],["admin","view"])` | health line |
| `GET /api/integrations/mcleod/writes?stop_id=&state=` | `requireSection("dispatch","view")` | states; McLeod text only with `dispatch` manage |
| `POST /api/integrations/mcleod/writes/:id/retry` | `requireSection("dispatch","manage")` | `mcleod_write_enqueue` with `origin='office_retry'` |
| `GET /api/integrations/mcleod/writes/switches` | `requireAdminOnly("mcleod.connection")` | current mode per operation + history |
| `POST /api/integrations/mcleod/writes/switches/off` | `requireAdminOnly` + step-up | inserts an `off` row (the tenant kill); `writeAudit("integration.mcleod.write_switch_off")` |
| `GET/POST /admin/mcleod-writes/orgs/:org/switches` | platform chain + step-up on POST | every mode; the request body names `briefing_read_by` (the Q-9 contact) and quotes `approval_ref` |
| `POST /admin/mcleod-writes/orgs/:org/test-companies` | platform chain + step-up | `mcleod_test_company_insert`; body carries `/metadata`'s company name from the latest discovery |
| `POST /admin/mcleod-writes/orgs/:org/egress-pin` | platform chain + step-up | sets `pinned_egress_ip`; the audit row quotes Alex's written confirmation |

**The watch** (`writeWatch.ts`): five-minute tick, `inFlight` guard, each org in its own try — the
`startFinancialFreshnessScheduler` shape (`financial/financialFreshness.ts:242-273`); pure `planWriteFindings(now,
snapshot)`; findings through `notify()` with category `mcleod_write`, day-scoped dedupe keys. Recipients by the
operation's section (D-MK31: stops → `dispatch`); critical findings also to `organizations.notification_emails`
(read as `financialFreshness.ts:220-227`). Findings: W1 waiting while claiming (warning); W2 no claim for 10 min with
work queued (critical); W3 `auth_failed`/`tls_pin`/`date_mode_unset` (critical); W4 a request with ≥ 3 leases or ≥ 6
transients (warning); W5 `confirmed` > 20 min and the mirror's `actual_*` still differ (warning); W6 a
`stop_completed` event whose `mcleod_write` starts `enqueue_failed` (critical); W7 each new `refused`/`conflict`/
`already_in_mcleod` (warning, immediate); W8 two instance ids claimed for one org within 10 min (critical); W9 egress IP
changed (info, T-3). No after-hours paging: v2 says so plainly; a stopped pipeline loses nothing (D-MK31).

**Tests (quoted titles).** `tmsMcleodApi.writes.test.ts`: "claim answers writes off without calling the database when
the fleet kill is off"; "claim, begin-send and settle pass the token's org to every call"; "a settle retried after a
deploy returns the same state". `writeSwitches.test.ts`: "a carrier admin can only switch an operation off";
"switching off writes an audit row". `mcleodWrites.test.ts` (admin-api): "the McLeod writes routes answer 401
unauthenticated and 403 to a non-platform user"; "a switch above off needs a fresh step-up"; "a test company insert
carries the company name discovery read". `writeWatch.test.ts`: "planWriteFindings raises W1 to W9 from their
snapshots"; "a finding is sent once per day per key"; "critical findings also go to the notification emails";
"stop findings go to dispatch section holders, never to McLeod connection holders". `exceptions.test.ts`: "the
exceptions feed reads more than 1,000 load events" (D-MK32). Web: `McleodApiHealthLine.test.ts` "turns caution after
10 minutes and names the error class in words"; `StopMcleodWriteBadge.test.ts` "shows McLeod's time beside the
driver's when McLeod kept its own"; `McleodWriteSwitches.test.ts` "a carrier admin sees Stop and no way to turn
writes on".

**Gates.** route-gate ledger test (inline gates derive), `lint:boundaries` (`loads → mcleod` through the index only),
`lint:table-access`, `lint:filesize`/`funcsize`, `lint:migration-ordering` (this merge reads T-4's functions: T-4 on
staging first), WORKER-DEPLOYMENT row, `expectOrgScoped` everywhere.

**Staging check.** On staging with a staging write token: `POST …/writes/claim` → `{writes:"off", why:"env_off"}`;
the platform console's McLeod writes page lists the staging org with every operation `off`; a carrier admin's `Stop`
inserts an `off` row and an audit row.

**Rollback.** Insert `off` rows (≤ one claim cycle) or leave L1 false; revert code.

**Release dependency.** Production before T-8 can claim; L1 stays `false` in production until T-11.

---

## T-6 VM: configure and discovery Phase A (an operation, not a PR)

Runs after CU-1 is on the VM (agent code with every API line off). Steps (spec C §6 step 2, with D-MK38's file):
1. Alex (or Miki) runs `set-mcleod-api.ps1 -Configure`: URL, auth mode, company map typed at prompts; the secret at a
   hidden prompt; the PEM copied; the leaf fingerprint shown for a person to compare with McLeod's; written to
   `mcleod-ws.env` only.
2. The script runs `agent.mjs --api-discover` with the service stopped and refuses to keep the lines unless TLS,
   auth and `/movements/search` are ok.
3. The report lands in `mcleod_api_discoveries`; capability rows are written for K1–K12, K23, K24, K25.

**Per-outcome builds** are the K table (`api-kit-council/3-ops.md:309-334`) with round 4's additions
(`api-kit-round4/3-outcomes.md` A.2) and the register:

| Probe | Outcome | Build |
|---|---|---|
| K1 | `/ws` absent on 22.1 | MK1+ wait; everything above merged stays dark; Track N and finance continue (register §6) |
| K1 | "works on 22.1, not supported" | reads proceed; no switch above `off` until McLeod's written support statement or the upgrade (3-outcomes F1) |
| K1 | `clearStop` absent | `stop_clear` stays `off`; no TableRowService fallback without McLeod's written "runs dispatch logic" |
| K2 | CA + DNS / self-signed + name / no usable name / http only / rotates | spec C U2's five rows |
| K3 | token / login; lifetime < 15 min | D-MK37 re-login near expiry; capability `token_lifetime_s` |
| K3+ | disabling the McLeod user does not revoke an issued token (read-only probe, safe on production) | D-MK37: "instant stop" removed from the Alex message; login mode with short lifetime + logout |
| K4 | identity / translated / one header sees all | map; precheck compares `company_id` (OPS-12) |
| K5 | money reachable by the integration user | Q-7 applies before any write line |
| K6 | offset / zone-less Central / zone-less other zone | `date_mode` = `offset` / `server_central` / `server_local:<IANA>` (written by `set-mcleod-api.ps1` from one cleared stop compared with the SQL mirror); writes refused while unset (`date_mode_unset`) |
| K7 | audit reach ≥ 7 d / < 7 d | spec C U5 |
| K8 | offset paging honoured / not | parity walks SQL's id list |
| K9 | a key an adapter uses is missing | that operation's capability `op.<name>` = `absent`; the API refuses to switch it above `off` |
| K23 | a login holds a seat and token mode is unavailable | logout after every batch, one session; owner rules on a seat (Q-10 cost rule); else parity does not run |
| K25 | `reason_for_leaving` table readable / not | T3 (D-MK40) |
Write probes (K13–K22) are never run here; they are T-11.

---

## T-7 Phase B: the docs parser, API side (D-MK39)

**Files.** New `apps/api/src/modules/mcleod/mcleodApi/docsParser.ts` (+ test) and `wsSurface.ts` (the operations
this repo depends on, spec C §3.5's `REQUIRED_SURFACE`, moved API-side); `discovery.ts` runs the parser on the
uploaded `docs_gz` after insert and writes `op.<operation>` capability rows (`present | absent |
present_role_missing`). Tests use **hand-written stub pages** under
`apps/api/src/modules/mcleod/mcleodApi/__fixtures__/ws-docs-stub/` (our own minimal HTML in McLeod's page shape,
≤ 64 KB in total, `lint:mcleod-secrets`), never crawled pages. **Tests:** "the parser reads method, path, roles
and parameters from a service page"; "an operation absent from the pages is reported absent"; "a page the parser
cannot read fails the discovery's surface verdict instead of passing it". **Staging check:** none (no VM on staging);
the parser runs in CI. **Rollback:** revert. **Release:** production; then the next discovery run (no VM visit needed:
the parse is API-side).

---

## T-8 The agent's write loop, `--api-prove`, `--schema-check`

**Files.** `tools/mcleod-agent/writeLoop.mjs`, `writeAdapters.mjs` (+ tests), `schemaCheck.mjs` (+ test, built on
`inspect.mjs`'s `information_schema.columns` read), `schedule.mjs` (`{ name: "writes", everyMs: 15_000 }` after
`loads`, `:19`), `agent.mjs` flags.

**Loop** (spec C §5.6 as amended by council P-1..P-26 and the register): claim (size 1; claim again at once while a
claim returns a request, V4-7) → company not in `MCLEOD_WS_WRITE_COMPANIES` → settle `refused company_not_allowed` →
precheck read `GET /stops/{id}` → per §5.7 below → `begin_send` (one POST, 10 s timeout, no retry; a lost answer is
"did not go") → `go` only → `POST /dispatch/clearStop/{id}` with `arrivalDate`, `departureDate`, `isReportable=false`,
no delay code (O-4), formatted per `date_mode` → read-back → settle (may retry 4 × 60 s). The agent asserts at
start: `quietAfterSendS ≥ beginSendTimeoutS + writeDeadlineS + 30`.

**Precheck verdicts** (replaces spec C §5.7; D-MK11): not cleared → send; cleared with our times equal at the
`time_precision_s` capability (K13; seconds until measured) → settle `confirmed already_applied`; cleared otherwise →
settle `already_in_mcleod`; the stop 404 while its movement reads 200 → `refused stop_gone`; the movement 404/403 →
`transient`; McLeod's driver on the movement differs from the request's → `conflict dispatch_changed`; arrival null in
the payload: K14 `departure-only accepted` → send departure only; K14 refused → `refused arrival_unknown`; a local
time in the repeated DST hour under a zone-less `date_mode` → `conflict ambiguous_local_time`.

**`--api-prove --company=<test> --stop=<id>`**: inserts a `prove` request through
`POST /api/tms/mcleod-api/writes/prove` (added here, same token chain, calls `mcleod_write_prove`), then runs the loop
once. P1–P6 of spec C §7; P3's crash hook `MCLEOD_PROVE_CRASH_AFTER=apply`.

**`--schema-check`** (D-MK35): compares every (table, column) the statements in `queries.mjs` name against
`information_schema.columns`; prints pass/fail per statement; exit 1 on any failure.

**Tests (quoted titles).** `writeLoop.test.mjs`: "a crash between the McLeod call and settle leads to
confirmed already_applied and exactly one clearStop"; "a lost begin_send answer sends nothing"; "the agent refuses
to start when the quiet period is shorter than a send can last"; "stop 2's clear waits for stop 1's"; "a 2xx not yet
visible is re-read after 60 seconds and ends accepted_not_visible after three reads"; "a write company outside the
allowed list is refused without a call"; "writes off is logged once per change"; "a token within two minutes of
expiry is renewed before the call". `writeAdapters.test.mjs`: "times are formatted per date mode across the
2026-11-01 fall-back"; "a repeated local hour under a zone-less date mode is never sent"; "equality uses the
measured precision"; "departure-only is sent only when the capability says McLeod accepts it".
`schemaCheck.test.mjs`: "every column queries.mjs names is checked"; "a missing column fails its statement only".

**Gates.** agent tests, `lint:agent-syntax`, manifest regenerated. **Staging check:** none (agent). **Rollback:** VM
previous commit. **Release:** merged after T-5 is in production; reaches the VM in CU-1.

---

## CU-1 The one connector update (D-MK38)

One connector commit carrying: B4's reference-number statements (T1's N-10 agent half), the test-company movement
read (below), T-2 and T-8's agent code, the regenerated `review/SILVICOM-READ-ROUTINE.sql`, and the
`update-connector.ps1` `/ws` failure lines. Every API line off. **One** SQL review by Alex (B4 + test-company
statements, plus T3 D-10a's finance statements and the grants-file edit, so the review stays one — added by chat 3)
and **one** VM visit. T3's `/ws` adapters merged before this commit is cut ride it too (T3 §0). Load-rates R4 (PR #2602) is not in it.

**Test-company read.** The agent's company-scoped statements run a second time for `MCLEOD_TEST_COMPANY` (in
`mcleod-ws.env`, absent = not run) — **movements and stops only**; drivers, tractors and trailers of the test company
are never read (V4-4: the roster sweep matches by licence and name and would link real people to test ids). The raw
rows land in `mcleod_dispatch_movements`/`_stops`; `dispatchProjection.ts` skips every movement for which
`is_mcleod_test_company(org, company)` is true, so test freight never becomes a `loads` row and no report, census,
seat count, board or Ask AI reader can count it. The only readers of the raw tables are
`modules/mcleod/dispatchMovementIngest.ts` and `dispatchProjection.ts` (grep 2026-11-27; `lint:table-access` keeps it
so). Consequence, ruled here: **`test` mode is prove-only** (council P-5) — no driver completes a test-company stop.
Per outcome (3-outcomes F2): test company on the same server → as above; separate server → no SQL read (one program,
one connection); P1–P6 rely on `/ws` read-back only and W5 is skipped for that company and says so; none → `MCLEOD_TEST_COMPANY` stays absent.

**Tests.** `review.test.mjs`: "the read routine contains the test-company statements only for movements and stops";
`dispatchProjection.test.ts`: "a test company's movement is never projected into loads".

---

## T-9 Parity on, and its verdict

Spec C §4 unchanged (job `api_parity` every 15 min when `MCLEOD_API_FEED=on`; D-MKT4 retirement rule), plus
`GET /api/integrations/mcleod/api-parity/verdict?feed=movements` (`requireAdminOnly("mcleod.connection")`).
**Needs** K1 present. **Tests:** "paging by id ascending stops at a short page"; "a mismatch that agrees on re-read
is in flight"; "a watermark older than the audit reach is reported beyond_audit"; "the verdict needs seven
consecutive Central days with 90 % of runs". **Rollback:** `set-mcleod-api.ps1 -Parity off`.

---

## T-10 A test company is registered

Operation in the platform console after McLeod or Alex names a write-capable test company and K4 has read its
`/metadata` name. **Per outcome:** exists on our server → `mcleod_test_companies` row (MK017 guards it), then `test`
switch rows; separate server → second `/ws` profile in `mcleod-ws.env` (`MCLEOD_WS_TEST_URL`, `_CA_FILE`,
`_CERT_SHA256`); none ever → no row; only the `stop_clear` canary with `approval_ref` (MK015) remains, and every other
operation stays `off` (R4-3).

---

## T-11 Proving run P1–P6

Needs: T-8 on the VM, a `test` row, K6 and K13 resolved (date mode written; precision recorded), Lockwood's written OK
filed (with any conditions mapped per D-MK36: scope limit → those operations never above `off`; hours →
`allowed_hours`; a condition that maps to nothing → `off` and recorded in the plan's open questions; withdrawal →
every switch `off` the same day in the console + `set-mcleod-api.ps1 -Writes off`), and Alex's `clearStop` effects
list + undo rehearsal. L1 is set `true` in production for the run. P-report posted as a discovery row (`phase =
'prove'`). K13 records `time_precision_s` and whether the audit user is ours; if McLeod's audit shows a generic user,
the help text and the Alex message say the 360 badge is the only marker and Alex is asked before deliveries go live
(3-outcomes K13).

---

## T-12 `stop_clear` canary → live

**Needs:** a confirmed `prove` (or, with no test company, `approval_ref` naming the owner's written OK with its date);
drivers on a store build with `action_id` (T1 N-17); **the office dispatching McLeod loads through Dispatch → Send**
(D-LMR5, re-confirmed 2026-11-27; production has 0 `load_dispatches` rows ever, so no `driver_app` request can exist
before that); the Q-9 contact named (D-MK34); Q-2 answered.

**Order** (C-19, R4-4, D-MK33): canary pickups on Alex-named non-EDI customers → live pickups (`live_stop_types =
{pickup}`) → deliveries. Per outcome:

| Outcome | Build |
|---|---|
| Alex says a pickup clear sends no EDI 214 | canary scope `{"stop_types":["pickup"], "customer_ids":[Alex-named]}` |
| a pickup clear also sends a 214 | canary scope = non-EDI customers for both stop types; if Alex cannot list them, MK3 stays `off` |
| Alex lists EDI customers | a later migration adds append-only `mcleod_edi_customers` (console-written) and replaces MK016's `dropoff` refusal with: `live` for deliveries needs a confirmed canary `dropoff` on a listed EDI customer when the list is non-empty |
| a grant of an EDI column on `customer` is preferred instead | the column is read by the agent's customer statement in the next connector update and fills the same table |
| no list, ever | no `live` row for deliveries (MK016 stays) |
| clearStop sets ready-to-bill or feeds settlement | billing and payroll are told in the deliveries briefing; deliveries go live only after one settlement period of pickups with zero `conflict` (3-outcomes F4) |

Every switch row's `reason` is the briefing (D-MK34), e.g. "Dispatchers no longer clear pickups for customers A and B
by hand; the driver's Complete clears them. Clear by hand only when the stop shows 'McLeod refused'."

---

## Owner and outside answers this track waits on

Each is named once, with its build above: `/ws` presence and certificate (T-6), test company (T-10), Lockwood's OK
(T-11), `clearStop` effects (T-11/T-12), date mode and precision (T-6/T-11), token revocation (T-6), static IP
(T-3), EDI list (T-12), Q-2 (T-12), Q-7 (T-6 K5), Q-9 (T-5 switch rows), Q-10 (T-6 K23). Q-1..Q-10 were unanswered on
2026-11-27; none is assumed.
