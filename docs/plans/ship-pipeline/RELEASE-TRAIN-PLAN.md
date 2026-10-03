# Release train — merge all day, release once a night

**Status:** R0 (this plan) and R2 (scheduler clocks) in review 2026-10-02. Owner approved the
direction 2026-10-02 ("proceed as proposed"). Everything from R3 on is unbuilt.

**Supersedes** the "merge = deploy" model from SHIP-PIPELINE-PLAN.md D0–D4 for the two Railway app
services, Supabase migrations and the driver OTA lane. Store builds (`driver-store.yml`, tag-driven)
are already a release lane and are unchanged.

---

## 1. Why — the measurements (production, 2026-10-02)

The owner's complaint was "we interrupt jobs and users and it makes noise." Each part of it has a
number.

| Measurement | Value | Source |
|---|---|---|
| `@fleetguard/api` deploys since 2026-08-24 | **810** in 40 days | `railway deployment list --limit 1000` |
| Median life of an api process | **23 minutes**; ONE process ever lived ≥ 24 h | gaps between those deploys |
| Merges to `main` per day, last 14 days | 5–44, median ~20 | `git log --merges` |
| Deploys by Central hour, last 14 days | 251 of 293 between 08:00 and 20:59 | same |
| Job runs ended "reclaimed / interrupted" | **1,192** in 30 days | `jobs.error` |
| — `sync_idle` | 211 of 398 runs (**53 %**) | same |
| — `efs_process_import` | 693 | same |
| — `sync_hos` / `efs_soap_posted` | 79 / 110 | same |
| Office actions by Central hour (`audit_logs` × `memberships`, 30 d) | 07:00–19:00; **zero 00:00–06:59** | |
| Fuel purchases at night | 2–4 per hour (00–05 CT) | `fuel_events.happened_at` |
| Driver app duty sessions, 30 d | 0 — not yet in daily use | `driver_duty_sessions` |

Two schedulers had effectively never run, because their first tick was one interval after boot and
the process almost never lived that long: the evidence-storage reconcile (24 h) and the DQ binder
sweeper (1 h). R2 fixes both; no binder had been exported yet, so nothing leaked.

## 2. Decisions

- **D-REL1 — Merge continuously; release nightly.** PRs keep merging to `main` all day behind the
  required `build` check. A merge stops being a production event. Batching *merges* to night was
  rejected: 20–40 PRs landing at once maximises conflicts and the migration-number race
 , and a broken night then has 30 suspects instead of one.
- **D-REL2 — Production follows a `production` branch, not `main`.** Railway's production services
  (`@fleetguard/api`, `@fleetguard/web`, `platform-console`, `driver-dist`) change their source
  branch to `production`. Only `release.yml` pushes it (branch protection: no direct pushes, no
  force-push except by the rollback job). `main` keeps feeding staging.
- **D-REL3 — Staging is a real environment with its own database.** Railway `uat` becomes `staging`
  and gets its own Supabase project. Every merge to `main` applies migrations and code there in
  minutes, so the same day's work is checkable the same day. Today `uat` points at the PRODUCTION
  Supabase (measured 2026-10-02), so it is not a staging environment: any write there is a
  production write and its emails reach real people. EFS card control is already `false` on uat and
  PSP points at PSP's own UAT sandbox — those were checked and need no change.
- **D-REL4 — Staging cannot reach real people or real money.** EFS stays off (it is
  WEX-whitelisted to production anyway); PSP stays on its sandbox; Samsara is allowed (the token is
  read-only — every write 401s); McLeod is not connected. New capability (R4): an
  `OUTBOUND_ALLOWLIST` env that, when set, makes every email/SMS/push sender drop any recipient not
  on it and log the drop. Unset in production. This must exist before staging holds any real
  phone number.
- **D-REL5 — The owner approves each night's release.** At 18:00 CT a workflow opens (or refreshes)
  a release PR `main → production` whose body lists every merged PR since the last release, grouped
  by area label, with migrations and driver-native changes called out. Approving it is the go
  signal; an unapproved PR at 01:00 means no release, and the day's work rides the next train.
- **D-REL6 — The release runs at 01:00 Central (cron `7 6 * * *` UTC).** 01:07 CDT, 00:07 CST.
  It finishes, with verification, by ~01:30, leaving 85 minutes of rollback room before the 02:55
  EFS clientId reset (`efsSoapSession.ts` CT_RESET_HOUR) and the 03:00 nightly reconcile (up to 154
  min). Office use is zero at that hour. Order, each step gating the next:
  1. Require the release commit's CI green (`require-ci-green`, unchanged).
  2. `supabase db push` — migrations BEFORE code, always (see D-REL9).
  3. Fast-forward `production` to the release commit → Railway deploys.
  4. `deploy-verify` both hosts at that commit and migration; then `smoke`.
  5. Driver OTA publish (or APK dispatch when the fingerprint moved).
  6. Tag `v2026.10.03`, GitHub release with the notes from step D-REL5.
  7. ONE summary message (recipients: Q-REL4).
- **D-REL7 — Release nights are Sunday–Thursday.** No Friday/Saturday release: a bad release must
  land on a weekday morning when somebody is looking. Hotfixes (D-REL8) are exempt.
- **D-REL8 — Hotfix lane, any hour.** Branch `hotfix/<topic>` from the current `production` tag, fix
  only that, PR into `production` with a required `reason`, CI + staging check, ship through the
  same `release.yml` (workflow_dispatch) immediately; the workflow then opens a PR merging the fix
  back into `main`. Unapproved work on `main` cannot ride a hotfix.
- **D-REL9 — Migrations stay forward-only and additive.** Rollback (`release.yml` rollback input)
  moves `production` back to the previous tag; it never reverses a migration. D-REL6's order means a
  nightly release serves NEW schema to OLD code for the deploy minutes, never the reverse.
  `lint:migration-ordering` stays for now: the hotfix lane can still ship code before its schema.
  Revisit once the train has run a month.
- **D-REL10 — Releases are versioned packages.** CalVer `vYYYY.MM.DD` (`.N` for a hotfix the same
  day). The version, not the commit, is what `/api/version`, the web footer, the driver app's
  build-info row and `pnpm verify:live` report. Release notes are generated from PR titles + area
  labels; a PR template asks: what changes for a user, migration/risk, how to check it on staging.
- **D-REL11 — Unfinished work merges dark.** A feature that should not be seen yet merges behind
  the existing per-org module switches (`org_module_enabled`) or a feature flag, so "merged" and
  "turned on" stay separate decisions.
- **D-REL12 — Freeze switch.** Repository variable `RELEASE_FREEZE=true` makes the nightly job exit
  green with "frozen". For audits, holidays, a known-bad week.
- **D-REL13 — Background work runs on wall clocks, not boot-relative timers.** A scheduler whose
  first tick is "one interval after boot" runs at the mercy of the deploy rhythm. Daily work fires
  at a fixed Central hour (the `nightlyReconcile.ts` pattern); short-interval sweeps also run a few
  minutes after boot. R2 applies this to the two schedulers that had never run.

## 3. Phases

| Phase | What | Owner action needed |
|---|---|---|
| **R0** | This plan | — |
| **R2** | D-REL13: storage reconcile at 06:00 CT; DQ binder sweep also 4 min after boot | — |
| **R3** | Staging Supabase project; uat → staging pointed at it; `migrate.yml` targets staging on push to `main` | Create the Supabase project (billing) — Q-REL1 |
| **R4** | `OUTBOUND_ALLOWLIST` in every sender (Brevo, Telnyx, Expo push) + tests | — |
| **R5** | `release-candidate.yml` (18:00 PR), `release.yml` (01:00 + dispatch: hotfix, rollback), freeze switch; `migrate.yml` / `deploy-verify.yml` / `driver-ota.yml` / `driver-android.yml` stop triggering on push to `main` for production and become callable steps | Branch protection on `production`; switch Railway prod source branch |
| **R6** | CalVer in `/api/version`, web, driver; PR template; area labels; notes generator; `verify:live` compares against `production` | — |
| **R7** | CLAUDE.md, DEPLOYMENT.md, MIGRATION-DISCIPLINE.md, memory: "a merged migration IS a deployed migration" becomes "a released migration…" | — |

R3 before R5: switching production off `main` while staging still shares its database would leave
nowhere safe to check a migration.

Railway deprecates `railway.json` (Config as Code) on 2026-12-01; R5 touches the same settings and is
the moment to move to `.railway/railway.ts`.

## 4. Open questions

- **Q-REL1 — Staging data.** (a) empty + seeded fixtures + live read-only Samsara;
  (b) a nightly copy of production with personal data scrubbed. **Recommend (a)** now: no PII
  pipeline to build and audit, and live Samsara gives real trucks on the map. (b) later if fixtures
  prove too thin to check finance/fuel screens.
- **Q-REL2 — Approval required every night?** Taken as **yes** (D-REL5) from "proceed as proposed".
  Alternative: auto-release when all checks are green, owner can veto by closing the PR.
- **Q-REL3 — Release nights.** Taken as **Sun–Thu** (D-REL7).
- **Q-REL4 — Who approves; who gets the summary, and how.** Recommend: owner approves; summary by
  email to the owner, SMS only on a failed/rolled-back release.
- **Q-REL5 — PSP UAT orders on the shared database.** uat has `PSP_ORDERS_ENABLED=true` against
  PSP's sandbox, but writes its order rows into the PRODUCTION database. Resolved by R3; until then,
  do not place PSP orders from uat.

## 5. Progress log

- 2026-10-02 — Measurements taken; owner approved the direction. R0 + R2 on `claude/release-train-r0`.
