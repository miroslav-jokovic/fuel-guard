# Devin — handoff #2: get `main` onto the servers

Repo: `https://github.com/miroslav-jokovic/fuel-guard`, branch `main`, head `95929f7`.
Supersedes `docs/plans/DEVIN-HANDOFF-2026-08-07.md`, whose steps 1–3 are already done: the quarantine
folder is deleted, all the loads/placard/equipment work is committed, and `origin/main` is at `95929f7`.

**Do not work in Miki's checkout at `~/Projects/FuelGuard`.** It holds ~35 files of in-flight
design-system work he is editing by hand right now (`apps/driver/src/theme/*`, `AppText.tsx`,
`check-driver-theme.mjs`, the roster `DriverAccess*` components). None of it is yours to commit, stash
or revert. Clone your own copy — everything below works from already-pushed commits.

---

## The two numbers that matter

Measured against the live API at the time of writing:

```bash
curl -s https://fleetguardweb-production.up.railway.app/api/version
```

```json
{"service":"FuelGuard API","env":"production","commitShort":"234de58",
 "startedAt":"2026-08-07T14:52:31.577Z",
 "schema":{"expected":"0140","applied":null,"state":"unknown","drift":true},"ok":false}
```

Two independent failures, and they are the whole reason this handoff exists.

**1. The API is 15 commits behind.** `234de58` was committed at 09:49 CDT and deployed at 09:52. Since
then four commits touching `apps/api`, `apps/web`, `packages` or `supabase` were pushed — `4499906`
(12:24), `e055494` (12:28), `841a9de` (15:21), `95929f7` (15:37). None of them are running. Those are
not doc commits that `railway.json`'s `watchPatterns` legitimately skips; they are the load lifecycle,
the duty-session error contract, the load detail API and the placard Table 2 correction.

**2. `applied: null` means no migration has been applied in weeks.** That field is the return of
`public.applied_schema_version()`, created by migration `0140`. `null` with `state: "unknown"` means the
function does not exist in the database, so `0140` never ran — and therefore neither did `0135` or
`0136`, which close real driver-scope security holes, nor `0141`–`0145`.

Nothing written today is running anywhere. Every other step below is downstream of these two.

---

## Step 0 — your own clone

```bash
git clone https://github.com/miroslav-jokovic/fuel-guard.git ~/devin/fuel-guard
cd ~/devin/fuel-guard
git rev-parse --short HEAD          # expect 95929f7 (or later, if Miki has pushed since)
git log --oneline -5
```

Everything from here runs in `~/devin/fuel-guard`.

---

## Step 1 — prove `main` is actually green

The Cowork session that wrote this code could not run vitest: `node_modules` in Miki's checkout is
macOS-built and rolldown's native binary will not load in the Linux VM. Typechecks, all seven lint
gates and all four behavioural matrices were run and are green; **the unit suites are the one thing
nobody has executed**, and the last commit added three new test files. Run the full gate before you
touch any infrastructure, so that if a deploy is being blocked by a red build you find out here.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn     # the driver bundle imports dist/, not src/

pnpm lint
pnpm lint:filesize
pnpm lint:funcsize
pnpm lint:migrations
pnpm lint:boundaries
pnpm lint:tokens-parity
pnpm --filter @fuelguard/web lint:tokens
pnpm typecheck
pnpm test                                     # unit suites + all four RLS matrices
pnpm build
```

That is the same sequence, in the same order, as `.github/workflows/ci.yml`.

Expected matrix counts:
**rls 179 · hazmat_rls 16 · load-lifecycle 42 · duty-sessions 20.**
`rls` moved 159 → 179 on 2026-08-08. DQ0 added sixteen assertions covering the new `documents` table
and, for the first time in this matrix, `certifications` — the rows holding drivers' medical cards and
drug-test results. DQ1 added four more proving that terminating a driver ends their app access through
`auth_driver_id()` while the record itself is retained. The other three matrices are unchanged.
If any of those four numbers moved, that is a regression, not a new assertion — stop and report it
rather than adjusting anything.

Three test files that have never executed anywhere:

```
packages/hazmat-engine/src/placards/tableSelect.test.ts
packages/hazmat-engine/src/placards/compute.aggregate.test.ts
apps/api/src/services/dispatchLoads/detail.test.ts
```

If `pnpm install --frozen-lockfile` fails on a lockfile mismatch, say so and stop — a stale lockfile
would also explain a silently failing CI, and it is not something to paper over with `pnpm install`.

---

## Step 2 — find out why the API service stopped deploying

This is the blocker. Work through the three candidates in order; each has a distinct signature.

**2a. Is CI red on `main`?** GitHub → Actions → `CI`. If Railway's service has "Wait for CI" enabled,
a red check since `4499906` (12:24 CDT) explains the whole gap exactly. Step 1 tells you locally
whether the code is at fault; the Actions log tells you whether GitHub agrees.

**2b. Did Railway try and fail?** Railway → the FuelGuard API service → **Deployments**. You are
looking for builds after 14:52 UTC on 2026-08-07. Either there are failed builds (read the log; the
last two driver-dist failures were both build-context problems, so check the same two settings first —
**Root Directory must be EMPTY** and **Config-as-code path** must be `railway.json`), or there are no
builds at all, which means 2c.

**2c. Did Railway stop watching?** Service → Settings → check the GitHub connection is still live, the
watched branch is `main`, and auto-deploy is on. Also confirm the config path resolves to `railway.json`
— if it is unset *and* Root Directory is set, Railway resolves the config relative to the root directory
and quietly falls back, which is exactly what broke driver-dist twice.

CLI equivalents, if you prefer them to the dashboard:

```bash
npm i -g @railway/cli
railway login
railway link                 # pick the FuelGuard project + the API service
railway status
railway logs --build         # most recent build log
railway logs                 # runtime log
```

Once the cause is fixed, force one deploy of current `main` and watch it:

```bash
railway up --detach          # or: dashboard → Deployments → Redeploy
```

Then confirm — this is the acceptance test, not a formality:

```bash
curl -s https://fleetguardweb-production.up.railway.app/api/version | jq .
```

`commitShort` must equal `git rev-parse --short HEAD`. If it does not, do not continue to step 3;
report what the build log said.

---

## Step 3 — get the migrations applied

Ground truth **first**, before applying anything. Paste both tables into your report.

```bash
npm i -g supabase        # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <SUPABASE_PROJECT_REF>    # Project Settings → General → Reference ID
supabase migration list --linked
```

Expect the remote column to stop somewhere around `0134`. Note specifically whether `0135` and `0136`
appear — they are the driver-scope security fixes, and if they are missing that fact belongs at the top
of your report, not buried in it.

Apply them through the workflow rather than by hand, so the ledger keeps a single writer:

GitHub → Actions → **Apply Supabase migrations** → Run workflow → branch `main`.

It asserts `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` up front and fails
loudly if any is missing. A missing secret is the leading suspect for why nothing has been applied since
`0134` — the workflow used to fail silently, which is the exact failure mode that produced this whole
investigation. If it errors on a missing secret, add the secret and re-run; do not apply by hand instead.

If, and only if, the workflow is unavailable to you:

```bash
supabase db push
supabase migration list --linked
```

**Eleven migrations may apply at once, and three replace live functions.** Read this table before you
run it:

| Migration | What it replaces | Why it is safe |
| --- | --- | --- |
| `0141` | The four `driver_*_load` RPCs — new signatures, old ones dropped | Nothing calls the old ones. They read the driver from `auth_driver_id()`, which is always null for the service role the API uses, so that write path could never have worked. |
| `0142` | `loads_status_guard()` | Same body plus three additions: separation of duties (off by default), `approved_by` now required on approval, `submitted_at`/`approved_at` stamped by the trigger. |
| `0143` | `start_duty_session`, `change_duty_equipment` | Same bodies, SQLSTATEs realigned to the `DG001`–`DG005` the API already maps and tests, plus the org-scope check that was missing. |
| `0144` | — | Backfills `trailers.trailer_type = 'reefer'` where `is_reefer`. Guesses nothing else. |
| `0145` | — | Widens the `load_events` kind constraint, adds one index. |

**If a migration errors, do not edit it to get past.** `0135` and `0136` close real security holes and
their content is deliberate. Stop, paste the error, and wait.

---

## Step 4 — verify, from the outside

```bash
cd ~/devin/fuel-guard
API_URL=https://fleetguardweb-production.up.railway.app pnpm verify:live
```

Pass condition, all of it:

- `commit` equals `git rev-parse HEAD`
- `schema.applied` is `0145`
- `schema.state` is `current`
- `schema.drift` is `false`
- `ok` is `true`

Anything short of that, stop and report. This command exists precisely so that "are my changes live?"
has a one-line answer instead of an afternoon.

---

## Step 5 — deploy the platform console

New Railway service, same project, same repo.

- **Config-as-code path:** `railway.admin.json`
- **Root Directory:** **EMPTY** — leave it blank

Those two settings are the ones that broke the driver-dist service twice. Set them before the first
deploy, not after it fails.

Service variables (full table and health check in `docs/plans/ADMIN-PHASE0-RUNBOOK.md`):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | same project URL as the customer API |
| `SUPABASE_SERVICE_ROLE_KEY` | same key — lives ONLY in this service and the customer API |
| `ALLOWED_ORIGINS` | the console's own public URL |
| `VITE_SUPABASE_URL` | same project URL (build-time; Vite inlines it) |
| `VITE_SUPABASE_ANON_KEY` | project anon key (build-time) |
| `VITE_ADMIN_API_URL` | the console's own public URL (the admin API is same-origin as the SPA) |

Confirm TOTP is enabled: Supabase → Authentication → MFA. Every `/admin` route requires `aal2` and will
reject anything below it.

---

## Step 6 — platform owner, then Silvicom's entitlements

**6a.** Supabase → Authentication → Users → create a user for `miki@silvicominc.com` with a password.
Then in the SQL editor:

```sql
insert into platform_admins (email, role, status)
values ('miki@silvicominc.com', 'platform_owner', 'active')
on conflict (email) do update set role = 'platform_owner', status = 'active';
```

Leave `user_id` NULL — `admin-api` links it by email on first authenticated request. Miki enrols TOTP on
first login. This is the one hand-written row we are entitled to.

**6b. Grant Silvicom its modules through the console UI, not SQL.** Customers → Silvicom Inc →
Entitlements → grant **HazmatGuard, Messages, Notifications, Training**. The point is to exercise the
mechanism and produce an audit row with a named actor. A SQL insert would fix the symptom and prove
nothing about whether the control plane works.

**6c.** Only after 6b succeeds:

```bash
git rm supabase/migrations/0139_backfill_modules_existing_orgs.sql
```

Check `supabase migration list --linked` first and report whether `0139` is already recorded as applied.
If it is, deleting the file is local-only and the ledger keeps its row. Its problem is that it grants
every module to "orgs existing when it runs" — run after a real second customer is onboarded, it
silently gifts them HazmatGuard.

---

## Step 7 — re-test the phone, after step 6b and not before

`docs/plans/drivers-app/FIELD-REPORTS.md` records two open field reports from the installed Android
build: nothing hazmat is connected, and captured images are stored nowhere. The first is fully explained
by the missing entitlement. The second may be a symptom of the same thing — with the module ungranted
there is no server for the capture screen to post to. So do not debug either until 6b is done.

Then, on the test device: log in, open a load, open hazmat, capture an image, and report literally what
happens — including "still nothing," which is a useful answer.

If a new APK is needed, use GitHub → Actions → **Driver app — Android build**. Do not build from a
laptop; the install page's fingerprint is what the OTA workflow compares against.

---

## Step 8 — one small commit you should make

`apps/driver/modules/capture-native/android/.gradle/` is untracked and not ignored, so it shows up in
every `git status` and will eventually be committed by accident. In your clone:

```bash
printf '\n# Gradle build state inside the local native module\napps/driver/modules/capture-native/android/.gradle/\n' >> .gitignore
git add .gitignore
git commit -m "Ignore Gradle build state in the local capture module"
git push origin main
```

That is the only commit this handoff asks for. Everything else is infrastructure.

---

## Step 9 — report back

1. `curl .../api/version` before and after step 2, verbatim.
2. Which of 2a / 2b / 2c it turned out to be, and the build log line that proved it.
3. `supabase migration list --linked`, before and after step 3.
4. **Whether `0135` and `0136` were among the missing** — say this prominently if they were.
5. `pnpm test` output, especially the four matrix counts and the three never-run test files.
6. Final `pnpm verify:live`.
7. The console URL, and a screenshot of Silvicom's entitlements after granting.
8. What the phone does after 6b.

---

## Leave these alone

- **Miki's working tree** at `~/Projects/FuelGuard` — do not commit, stash, revert or `git clean` it.
- **`scripts/check-file-size.mjs`'s `GRANDFATHERED` list.** Commit `234de58` added four API files to it
  silently, inside a commit about deployment tooling, and the list's own comment says it may only
  shrink. It is on the board as debt. When `packages/hazmat-engine/src/placards/compute.ts` crossed the
  budget during this work it was split into `classify.ts` instead of being added to the list — that is
  the precedent.
- **`apps/driver/runtime-version.json`.** Bumped only when native code changes, and CI tells you when
  that is.
- **The Android keystore, `UPLOAD_TOKEN`, `EOO_TOKEN`, `DB_KEYS_MASTER_KEY_B64`.** Never in the
  repository. The only credential that belongs in git is `apps/driver/certs/certificate.pem`, which is
  public by design.
