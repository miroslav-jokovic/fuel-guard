# Incident 2026-11-15 — 30 minutes with no data in production, and why it started that day

Status: **written after the fix** (2026-11-15). Two questions for the owner at the end (Q-REL9, Q-REL10,
continuing `RELEASE-TRAIN-PLAN.md`'s series).

## 1. What happened (UTC)

| Time | Event |
|---|---|
| 17:34 | Release v2026.11.15 approved at `629a6bb` (34 PRs, migrations 0604–0611); `release.yml` run 43741878376 dispatched |
| ~17:40 | `ship` applies 0604–0611. **0610** runs `alter role service_role set work_mem = '16MB'` |
| 17:40 → | Every API request through PostgREST fails: `invalid value for parameter "work_mem": "16mb"` (CloudWatch `/silvicom/production`: 285+ in 25 min across odometer, FMCSA, Med-Stop, TMS ingest). Both scheduler leases stop renewing — no intake, no calculations |
| 17:50 | New code deployed. It is not the cause: the leases had stopped at the migration, before the deploy |
| 17:51–18:09 | `verify` keeps waiting — it checks that the hosts serve the new commit, not that reads succeed |
| 18:09 | Owner runs `alter role service_role reset work_mem` + PostgREST reloads. Errors → 0 within seconds, leases renew, `verify` passes, no rollback |
| 18:4x | 0613 (#2414) records the reset in the migrations |
| 21:14–21:26 | Next release (v2026.11.15.1, 0612–0615) watched live: 0 errors, leases fresh throughout |

**Mechanism.** PostgREST applies the impersonated role's settings at the start of every transaction.
Production's PostgREST (14.5) passed 0610's value to `set_config` lowercased; Postgres memory units
are case-sensitive and `mb` is not one, so every service-role transaction aborted
(`pg_stat_activity`: every PostgREST connection's last statement `ABORT`).

## 2. Why it started today — measured, not assumed

1. **0610 was the first migration ever to set a role setting.** `git grep "alter role .* set"` over
   all 600+ migrations finds 0610 and 0613 (its reset) and nothing else. The class of change was new
   on 2026-11-15: a database-performance audit that day (0610, 0611, 0612) tuned the database's
   roles for the first time.
2. **Staging could not have shown it.** Staging carried 0610 from its merge with zero `work_mem`
   errors (CloudWatch `/silvicom/staging`, two hours). The two Supabase projects run different
   PostgREST builds; staging's passes the value through. The migration's own comment records that it
   was tested on production "inside a rolled-back transaction" — as `postgres`, by ALTER ROLE, which
   succeeds; what fails is PostgREST *applying* it per request, which no rolled-back test exercises.
3. **Nothing in the release checks that data flows.** `deploy-verify` compares commits and schema
   version; smoke loads pages. Neither reads `platform_scheduler_leases` or the error rate, so the
   release would have waited out its 25-minute verify window and then rolled back the CODE — which
   cannot undo a migration (D-REL9) and would not have helped.

**Not new today, only noticed today** (all since the AWS move, 2026-10-28 —
`docs/plans/architecture/RAILWAY-REMOVAL-PLAN.md` R1–R3): the missing release name in the account
menu, the console's release approval refusing, and the update banner's build id being a timestamp.
The banner itself works as designed: it shows only in a tab still running the old build, found by a
5-minute poll or on refocus; a tab whose next page section 404s after the deploy reloads itself once
instead (`useAppUpdate.ts`, `vite:preloadError`), and a reloaded tab has nothing to announce.

**Not the cause:** merge volume (42 merges on 11/14 and 11/15; 49 on 11/10 shipped clean), the AWS
deploy (both releases deployed in ~4 minutes), or the new code.

## 3. Open questions

- **Q-REL9 — the release checks that data flows before it ships code.** After `ship` applies the
  migrations and before the code deploys, the release reads production for 2 minutes: both
  `platform_scheduler_leases` renewed within 60 s, and CloudWatch `unhandled error` count below a
  threshold. Fail → stop before the code deploy and alert by SMS (release-notify already sends).
  Candidates: (a) that check in `release.yml` (recommended — it would have caught 0610 in ~2 minutes,
  not 30); (b) a standalone watchdog workflow every 5 minutes, release or not; (c) both. Cost of (a):
  one job, the CloudWatch read needs the OIDC role `aws-production.yml` already assumes.
- **Q-REL10 — role settings are proven on production's PostgREST.** A migration with `alter role … set`
  for `anon`, `authenticated` or `service_role` gets a matrix-independent probe: apply on production
  inside a release window, then one PostgREST read as that role, else reset. Simpler alternative:
  forbid unit-bearing values in role settings (`'16384'`, not `'16MB'`) with a `lint:migrations` rule.
  Recommendation: the lint rule now (cheap, would have prevented this one), the probe only if role
  tuning becomes routine. Restoring 0610's sort memory waits on this answer.
