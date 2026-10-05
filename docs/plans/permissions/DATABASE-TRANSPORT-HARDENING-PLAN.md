# Database transport hardening — SSL enforcement and network restrictions

Database audit 2026-10-03 findings 6 and 7; PRODUCTION-READINESS plan Q5 and APR2.3. The owner
approved both changes on 2026-10-05. This plan records what was measured before acting, why neither
was applied that day, and the exact order that applies them without an outage.

## Current state (measured 2026-10-05, production `nsjszqnfppczbnligxll`)

| Setting              | Value                      | Source                              |
| -------------------- | -------------------------- | ----------------------------------- |
| SSL enforcement      | `database: false`          | `supabase ssl-enforcement get`      |
| Network restrictions | `0.0.0.0/0`, `::/0` (open) | `supabase network-restrictions get` |
| PITR                 | off; 8 daily backups       | `supabase backups list`             |

## Who connects to Postgres directly

Everything the product runs goes through PostgREST over HTTPS, which neither setting affects: the API,
the web app, the platform console and the job queue (`queue/pgDriver.ts` claims jobs through RPCs,
"supabase-js (PostgREST) cannot row-lock, so claiming MUST be the RPC"). `git grep` finds no
`DATABASE_URL`, `connectionString`, `pg`/`postgres` client or `sslmode` in application code.

The direct Postgres clients are:

| Client                                                                            | Where it runs                                                    | Egress address                                        |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| `supabase db push` in `migrate.yml` (production + staging jobs) and `release.yml` | GitHub-hosted runners (`vars.CI_RUNNER` unset → `ubuntu-latest`) | GitHub's shared ranges — thousands of CIDRs, changing |
| `supabase db query --linked`                                                      | the owner's Mac and Claude sessions on it                        | residential, dynamic                                  |
| `tools/mcleod-agent` (README uses `supabase db query`)                            | office machine                                                   | office IP                                             |
| Supabase's own services                                                           | inside the platform                                              | internal                                              |

Live sessions at 14:50 UTC (`pg_stat_activity` × `pg_stat_ssl`): PostgREST 11 (SSL), `mgmt-api` 1
(SSL), Supavisor `auth_query` 1 (no SSL), `postgres_exporter` 1 (no SSL, `::1`). The two non-SSL
sessions are Supabase's own and local. One snapshot cannot rule out an occasional client; the
inventory above is from source and workflows, not only from this snapshot.

## SSL enforcement

**Risk:** low for our clients. The Supabase CLI connects over TLS (the `mgmt-api` session above shows
`ssl = true`), and no product code connects directly. **Unknown, not assumed:** whether enabling it
restarts Postgres (the CLI help does not say) and how the platform treats its own non-SSL sessions.

**Order:**

1. Staging first (`dssmxlddtyimrwwuqwqq`): record `pg_postmaster_start_time()`; `supabase
ssl-enforcement update --project-ref dssmx… --enable-db-ssl-enforcement`; read the setting back;
   re-read the start time (a change = it restarts); run `migrate.yml`'s staging job
   (`supabase db push --dry-run`) and the uat smoke; confirm a `sslmode=disable` connection is refused
   before authentication.
2. Production in a quiet window if step 1 showed a restart (the release train's 01:07 CT slot is the
   existing one), otherwise any time: the same commands, then `pnpm verify:live` and
   `supabase db push --dry-run`.
3. Rollback: `--disable-db-ssl-enforcement`, one command.

**Why it was not applied on 2026-10-05:** step 1 needs a CLI link to staging. The session's
permission classifier refused linking a worktree to staging, and applying straight to production
would skip the only test of the restart question. Needs the owner to run step 1, or to allow
`supabase link` for the staging ref.

## Network restrictions

**Applying an allow-list today would break migrations.** `migrate.yml` and `release.yml` run
`supabase db push` from GitHub-hosted runners whose addresses are not ours and change; the first
release after the change would fail at the migration step, and production would stop receiving
schema changes. The owner's own CLI access would also break on any address change.

**What makes it possible**, in order of preference:

1. **Run the database jobs from a fixed address.** A self-hosted runner for `migrate.yml` and
   `release.yml`'s migration job only (the MacBook runner was tried for all of CI and reverted on
   2026-09-30 for speed, a different question), or GitHub's larger runners with static IPs. Then
   allow that address, the office, and nothing else.
2. **IPv6 off, IPv4 narrowed** is not a substitute: it narrows nothing that matters.

**Rollback:** `supabase network-restrictions update --db-allow-cidr 0.0.0.0/0 --db-allow-cidr ::/0`.

**Until then** the database is protected by its password (its rotation history was not checked), SSL
once enforced, and the grant/RLS hardening of 0411–0417.

## Decisions needed

- **Q-DT1:** run the staging SSL test (step 1), or allow the session to link the staging ref.
- **Q-DT2:** fixed-address runner for database jobs — self-hosted (free, one machine to keep up) or
  GitHub larger runner with static IP (paid). Recommendation: self-hosted runner used only by the
  two migration jobs, because those are minutes a day and the office already hosts the McLeod agent.
- **Q-DT3:** PITR. Off today with 8 daily backups, so up to 24 h of data loss on a restore. It is a
  paid add-on and needs a compute size it supports; it belongs to the Q3 RPO/RTO decision.

## Status re-measured — 2026-10-05 (after the Micro → Small upgrade)

| Setting          | Production now                                         | Source                                             |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------- |
| SSL enforcement  | **off** (`currentConfig.database: false`)              | `supabase ssl-enforcement get --experimental`      |
| Network          | **open**: `0.0.0.0/0`, `::/0`                          | `supabase network-restrictions get --experimental` |
| PITR             | **off** (`pitr_enabled: false`, `walg_enabled: true`)  | `supabase backups list`                            |
| Physical backups | 9 daily, latest 2026-10-05 16:39 UTC, region us-west-2 | same                                               |

**Q-DT1 is still blocked on access, not on a decision.** `supabase db query` reaches only the linked
project, so measuring staging's `pg_postmaster_start_time()` before and after needs the staging link the
session classifier refuses. The owner runs step 1 (commands above) or allows the link.

**Q-DT3 changed by the upgrade.** PITR needs a compute size that supports it; production is now Small,
which does. Recommendation: **enable 7-day PITR** — today a restore loses up to 24 h, and the finance
books, fuel evidence and audit ledger are all `RETENTION_FORBIDDEN` (never re-creatable from a vendor).
Cost is the dashboard's quoted price at enablement; this plan does not restate a number it cannot verify.

**Q-DT2 recommendation unchanged** (self-hosted runner for the two migration jobs only). Prerequisite
noted: the new platform-health monitor (#1312) deliberately stays on GitHub-hosted runners.
