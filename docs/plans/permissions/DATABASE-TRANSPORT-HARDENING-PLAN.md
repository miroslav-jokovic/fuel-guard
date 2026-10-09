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

## Q-DT1 step 1 — staging SSL test, RUN 2026-10-05 (owner approved), PASSED

Staging `dssmxlddtyimrwwuqwqq`, linked from an isolated temporary workdir (the repository stays linked
to production).

| Check                                                 | Before                                                                 | After `--enable-db-ssl-enforcement` (20:12 UTC)                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Setting read back                                     | `database: false`                                                      | `database: true`                                                              |
| `pg_postmaster_start_time()`                          | 2026-10-03 00:44:19                                                    | **2026-10-05 20:12:20 — it restarts Postgres** (~40 s)                        |
| Non-SSL client sessions                               | 2: `Supavisor (auth_query)`, `postgres_exporter` (both Supabase's own) | Supavisor reconnected **with** SSL; PostgREST ×4, `mgmt-api` on SSL           |
| `sslmode=disable` (pooler, wrong password on purpose) | —                                                                      | **`FATAL: (ESSLREQUIRED) SSL connection is required`**, before authentication |
| `sslmode=require`, same probe                         | —                                                                      | reaches the password check (`password authentication failed`)                 |
| `supabase db push --dry-run` (migrate.yml's path)     | —                                                                      | connects; lists the one pending migration                                     |
| Staging API `/api/version`                            | —                                                                      | reads schema and maintenance from the database (`maintenance: ok`)            |

Production, same probe, same day: `sslmode=disable` **reaches the password check** — it accepts an
unencrypted connection today. Its non-SSL sessions are the same two Supabase services; none of ours.

**Step 2 (production) — not yet run, by decision:** the test proves it restarts Postgres, so it belongs
in a quiet window, not the working day. Rollback stays one command (`--disable-db-ssl-enforcement`),
also a restart.

## Q-DT2 — the database jobs now follow `DB_RUNNER` (owner approved 2026-10-05)

`migrate.yml` (both jobs) and `release.yml`'s `ship` job — the only three that open a Postgres
connection — run on `vars.DB_RUNNER || vars.CI_RUNNER || ubuntu-latest`. Unset, nothing changes. The
Management-API users (`schema-drift`, the release summary, `platform-health`) are not affected by a
network restriction and stay GitHub-hosted on purpose.

**To finish (needs the office machine — not doable from a session):**

1. On the always-on office machine with a fixed public IP (the McLeod agent's host): GitHub → repo →
   Settings → Actions → Runners → _New self-hosted runner_; install it as a service with the extra label
   `db`. Note the machine's public IPv4 (`curl -4 ifconfig.me`).
2. Repository variable `DB_RUNNER` = `db`. Trigger `migrate.yml` by hand with no pending migration and
   confirm the staging job runs on that machine.
3. Only then: `supabase network-restrictions update --experimental --db-allow-cidr <office-ip>/32`
   (staging first, then production). Every other Postgres client — including a developer's own
   `supabase db push` — must then come from that address. Rollback:
   `--db-allow-cidr 0.0.0.0/0 --db-allow-cidr ::/0`.
