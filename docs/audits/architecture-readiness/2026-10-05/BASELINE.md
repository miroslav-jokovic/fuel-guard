# APR0.2 baseline — 2026-10-05

Measured 2026-10-05 between 13:50 and 14:40 UTC for
`docs/plans/architecture/PRODUCTION-READINESS-AND-DATA-SEPARATION-PLAN.md` Phase 0. Production reads
were `supabase db query --linked`, aggregate-only, and changed nothing. No credentials, card numbers or
customer payloads are recorded here.

## Versions

| What                                          | Value                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `main`                                        | `c9048c9` (#1281)                                                                                          |
| `production` branch, served by `/api/version` | `ebc8c8e` (#1270); schema expected 0423, applied 0423, `drift: false`, maintenance `ok`                    |
| Waiting for release                           | 20 commits, migrations 0424–0425 (FleetPal), release candidate #1275                                       |
| Production database                           | Postgres 17.6, 420 migrations recorded, last 0423, 4,247 MB, `shared_buffers` 256 MB, `max_connections` 60 |

## Gate counts against the 2026-10-03 baseline (commit `2a7160c`)

All fifteen gates in the plan's command list exit 0 on `c9048c9`.

| Count                                         | 10-03 | 10-05                 | Source                  |
| --------------------------------------------- | ----- | --------------------- | ----------------------- |
| Tables declared                               | 197   | 199                   | `lint:table-modules`    |
| Raw tables sealed to collectors               | 47    | 49                    | `lint:table-access`     |
| Grandfathered raw-access sites                | 29    | 29                    | `lint:table-access`     |
| Grandfathered writer sites                    | 58    | 58                    | `lint:table-modules`    |
| Pinned dynamic `.from()`                      | 10    | 10                    | `lint:table-access`     |
| Modules owning tables                         | —     | 22                    | `lint:table-modules`    |
| Lifecycle: fleet / static / time / unmeasured | —     | 17 / 1 / 85 / 96      | `lint:table-lifecycle`  |
| Retention windows mirrored                    | —     | 18                    | `lint:table-lifecycle`  |
| Section matrix                                | —     | 9 roles × 12 sections | `lint:section-policies` |

The debt counts did not move in two days; the two new tables are FleetPal (0424).

## Storage and growth

| Table               | Size     | Estimated rows                    |
| ------------------- | -------- | --------------------------------- |
| `audit_logs`        | 1,232 MB | 4.73 M                            |
| `scoring_attempts`  | 1,052 MB | 2.41 M                            |
| `hos_duty_segments` | 979 MB   | 1.59 M (1,087,012 with no driver) |
| `jobs`              | 170 MB   | 229 k                             |
| `idle_events`       | 164 MB   | 205 k                             |
| `weather_cache`     | 103 MB   | 831 k                             |
| `fuel_transactions` | 65 MB    | 18.2 k                            |

7-day daily averages: 1,672 scoring attempts, 60 new fuel transactions, 225 audit rows. Jobs in the last
24 h: 3,891 done, 87 failed, 2 running. `pg_cron` holds one job, `partman-maintenance`, active.

Compute and swap (the 09-22 "Micro, swapping" finding) were **not remeasured**: the metrics endpoint
needs the service-role key, and this session may not read `.env`. Still unverified.

## Finding: retention has not run for the real fleet since 2026-09-23

`data_retention` fails on every run for organisation `86d6b3ea…` with
`scoring_attempts delete: Bad Request`. It succeeds for the test organisation `07fe4058…`.

- The first failure appears on 2026-09-23, the day the oldest `scoring_attempts` row (2026-08-09)
  first passed the 45-day window L3 set. Before that, every run was a no-op and succeeded.
- 129,832 `scoring_attempts` rows are now past 45 days.
- `runRetention` continues past a failing rule and rethrows the first error at the end, so the later
  rules still run, but the job is recorded `failed` with empty `stats`: what they deleted is not
  recorded anywhere but the API log. `jobs` holds 142 rows just past 90 days (oldest 2026-07-06),
  too close to the boundary to say whether that rule is keeping up.
- Hypothesis, **unconfirmed**: `pruneById` deletes with `.in("id", ids)` for 1,000 UUIDs, a ~37 KB
  URL. A plain `Bad Request` with no PostgREST error body fits a request rejected by the HTTP layer.
  An unauthenticated probe could not decide it: the gateway answers 401 at every length up to
  37 KB before reading further. Confirming needs either the API's logs or an authenticated request.

## Database audit findings rechecked

| Finding                                                   | 10-05 state                            | Evidence                                                                               |
| --------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| 1 — `fuel_transactions` readable without the fuel section | **Fixed in production**                | restrictive `ftxn_section_read` present (0417)                                         |
| 1 — `drivers` readable without the roster section         | Still open                             | `drivers_select` permissive; only `drivers_driver_scope` restrictive                   |
| 3 — stale JWTs                                            | Unverified                             | no role simulation run today                                                           |
| 4 — cross-tenant links                                    | No mismatch in the checked pairs       | `fuel_transactions` → `vehicles` 0, → `drivers` 0; no write probe                      |
| 6 — SSL not enforced                                      | **Still open**                         | `ssl-enforcement get`: `database: false`                                               |
| 6 — network open                                          | **Still open**                         | `dbAllowedCidrs` `0.0.0.0/0`, `::/0`                                                   |
| 7 — leaked-password protection                            | Unverified                             | not readable from the CLI used                                                         |
| `soap_password` plaintext | **No plaintext stored** (corrected the same day) | both rows `length(soap_password)` 0 with a sealed copy; the first reading counted `is not null` on a NOT NULL column. Column retired by 0426 |
| PITR                                                      | Off                                    | `backups list`: `pitr_enabled: false`, 8 daily backups, latest 2026-10-05 08:37 UTC    |

## Allowed existing APIs (plan §Phase 0 table)

| Cited                                                                 | Result                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `dispatchJob(admin, env, kind, opts)` in `queue/dispatch.ts`          | Matches (`opts: DispatchOpts`)                                                                   |
| `startJob`, `startJobHeartbeat`, `finishJob` in `modules/org/jobs.ts` | Match; `finishJob` patch is `{ status: "done" \| "failed"; error?; stats? }`                     |
| `eachPage`, `fetchAllPaged` in `apps/api/src/lib/paging.ts`           | **Moved**: defined in `packages/shared/src/paging.ts`; the api file re-exports them              |
| `idle_engine_write` in 0404, replaced by 0407                         | Matches                                                                                          |
| `getFleetReport` → `computeFleetReport`                               | Matches                                                                                          |
| `financial/projection.ts`                                             | Exists                                                                                           |
| `expectOrgScoped` at `supabaseRecorder.ts:314`                        | Matches                                                                                          |
| `requireAuth`, `requireOrg`, `requireSection`, `requireAnySection`    | Match; ⚠ `requireSection`'s level **defaults to `"manage"`**, so always pass it explicitly       |
| `complete_job` / `fail_job` take no attempt identity                  | Still true: only 0095 defines them                                                               |
| Partner API blueprint                                                 | Exists only on open PR #1100 (`docs/plans/partner-api/OUTBOUND-DATA-API-PLAN.md`), not on `main` |
| TELEMETRY TS1 (`vehicle_live_telemetry`)                              | Not built; no migration exists                                                                   |

## Not done in this pass

- APR0.1, the machine-readable data-path inventory. Next task.
- Fixtures for the fuel pilot (APR0.2's second half).
- Compute/swap, leaked-password setting, stale-token simulation.
