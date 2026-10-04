# Release train — merge all day, release once a night

**Status:** R0 + R2 merged 2026-10-02 (#1219); R3 staging infrastructure built 2026-10-02. Owner approved the
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

### R5 cutover — the switch from "merge = deploy" to the train

R5 merges DORMANT: `release.yml` and `release-candidate.yml` rehearse every night (plan, notes,
`supabase db push --dry-run`) and push, migrate, tag and deploy nothing, and the push-triggered
production jobs keep running, until the repository variable `RELEASE_TRAIN` is `on`. Merging R5
changes nothing users see. The cutover is one sitting, after 19:00 CT, in this order:

1. Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" (the
   release PR must be opened by github-actions, so the owner can approve it).
2. A fine-grained token of a repository admin, `contents: write` on this repository, saved as the
   secret `RELEASE_TOKEN` (the ruleset below lets only admins move `production`).
3. Repository variables `STAGING_API_URL` / `STAGING_WEB_URL` (the uat hosts), so a push to main
   verifies staging once the train is on.
4. Run Release with `mode=init`: creates `production` at the commit production serves, read from
   `/api/version`.
5. A ruleset on `production`: restrict updates, deletions and force pushes; bypass: repository admin.
6. Railway: `@fleetguard/api`, `@fleetguard/web`, `platform-console`, `driver-dist` in the
   production environment → source branch `production`.
7. `RELEASE_TRAIN=on`. From this moment a merge deploys staging only.
8. Check: merge anything small → `uat` serves it, production does not; at 18:00 the release PR
   opens; approve it; at 01:07 it ships and `v<date>` exists.

Undo, at any step: delete `RELEASE_TRAIN` and point Railway back at `main` — the push-triggered
jobs resume exactly as before R5.

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
- **Q-REL6 — Production does not match its own migrations.** Building staging from the 407
  migrations (2026-10-02) and fingerprinting both databases (columns, indexes, triggers, function
  bodies, policies, grants, RLS flags) found drift in BOTH directions, all from the 0084–0094 era
  (early migrations edited after they were applied — `create table if not exists` then skipped the
  edit on production):
  - **Production has, no migration creates:** 9 policies — six RESTRICTIVE driver denials
    (`anomalies_driver_deny`, `thresholds_driver_deny`, `memberships_driver_deny`,
    `tms_movements_driver_deny`, `ftxn_driver_select`, `ftxn_driver_insert`) and three
    `storage.objects` policies for `load-photos`; 5 columns (`driver_duty_sessions.start_lat/lon`,
    `duty_equipment_segments.driver_id` NOT NULL, `load_events.actor_driver_id`,
    `load_stop_photos.created_at`); ~20 indexes on the duty/loads tables; stale overloads of
    `resolve_driver_type(uuid)` and the 10-argument `start_duty_session`.
  - **Migrations create, production lacks:** `revoke_push_tokens(uuid)` and `notify_dedupe_key(...)`
    (0089 — production's own record shows it ran them, so they were dropped out of band) and
    `idx_hazmat_runs_org_created` (0094). `revoke_push_tokens` IS called
    (`apps/api/src/modules/messaging/notify.ts`, sign-out/offboarding); no failure logged in 30 days
    and only 2 push tokens exist, so no harm yet.
  - **Why it matters beyond staging:** a database rebuilt from migrations — staging, the PGlite
    matrices, a disaster-recovery restore — lacks the six driver denials, so a driver there could
    read anomalies, memberships and other drivers' fills.
  - **Recommendation:** one reconciling migration, every statement idempotent: create the nine
    policies verbatim from production `pg_policies`; `add column if not exists` the five columns
    after confirming each is wanted; `create index if not exists` the indexes; recreate the two 0089
    functions and the 0094 index; leave the stale overloads for a second, separate migration after
    checking nothing calls them. Then a CI gate that diffs a migrations-built schema against
    production's fingerprint so drift is caught the day it happens.
- **Q-REL5 — PSP UAT orders on the shared database.** uat has `PSP_ORDERS_ENABLED=true` against
  PSP's sandbox, but writes its order rows into the PRODUCTION database. Resolved by R3; until then,
  do not place PSP orders from uat.

## 5. Progress log

- 2026-10-02 — Measurements taken; owner approved the direction. R0 + R2 on `claude/release-train-r0`.
- 2026-10-02 — R0 + R2 merged (#1219), served on both hosts.
- 2026-10-02 — R3 infrastructure: Supabase project `Silvicom 360 Staging` (ref `dssmxlddtyimrwwuqwqq`,
  us-west-2) created; all 407 migrations applied (0409); `seed.sql` loaded (Silvicom Inc. demo org,
  6 drivers, 8 vehicles, 147 fills — Q-REL1 answered (a)); auth: `custom_access_token_hook` on,
  site URL + redirects = uat web and console hosts, self-signup off, TOTP on; two platform owners
  mirrored from production with logins and admin memberships in the demo org. Railway `uat`
  (`@fleetguard/api`, `@fleetguard/web`, `platform-console`) repointed: SUPABASE_URL,
  VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY — no production reference left.
  GitHub secrets STAGING_SUPABASE_PROJECT_REF / STAGING_SUPABASE_DB_PASSWORD; `migrate.yml` gains a
  `migrate-staging` job. Q-REL6 found while comparing the two schemas. Q-REL5 is closed by this:
  uat's PSP sandbox orders now land in the staging database.
- 2026-10-02 — R4: `OUTBOUND_ALLOWLIST` (`apps/api/src/lib/outboundAllowlist.ts`) filters every
  recipient in `sendEmail` and `sendSms`, the only two exits for email and SMS; unset in production.
  Push left unfiltered on purpose (a token exists only for a phone signed in to that environment).
  Set on Railway `uat` to the two platform owners. Q-REL6's reconciling migration (0411) was written
  but refused by the session's permission classifier as a shared-schema change — waits on the owner.
- 2026-10-04 — Q-REL6: 0413 (grants) and 0414 (`revoke_push_tokens`) had closed part of it; re-measured at
  0421, 1 item only on staging and 37 only on production. 0422 reconciles all 38, with two
  corrections to the recommendation above: production's three `load-photos` storage policies are
  PERMISSIVE and broader than 0085's, so they are dropped rather than copied in (stricter side
  wins), and `uq_duty_seg_current` is kept and added rather than dropped. Matrix
  `schema-drift-reconciled.test.mjs`. Still owed: the nightly gate comparing staging's schema with
  production's, which can only go green after 0422 is applied to both.
- 2026-10-04 — Q-REL6 closed in two more steps. 0422's first production push failed (2BP01:
  `uq_load_stops_seq` is a constraint there) and rolled back; the fix (#1263) edited 0422 with the
  owner's ruling, and production applied it. Comparing constraints then found 28 more differences;
  0423 (#1265) settles them, stricter side winning (trailer FK RESTRICT, invite FK SET NULL, timeout
  4–48, paired shift end). The nightly drift check (#1266, `scripts/schema-drift.mjs`) compares
  columns, constraints, indexes, functions, policies, grants and triggers at 06:37 CT.
- 2026-10-04 — R5 built, dormant: `release.yml` (nightly / hotfix / rollback / init),
  `release-candidate.yml`, `scripts/release-train.mjs` + `lint:release-train`; `deploy-verify.yml`
  and `smoke.yml` callable; `migrate.yml`'s production job and both driver lanes skip pushes once
  `RELEASE_TRAIN=on`. Cutover checklist in §3. Q-REL4 (summary recipients) still open: until it is
  answered, the summary is the run page, and GitHub emails the owner on a failed run.
