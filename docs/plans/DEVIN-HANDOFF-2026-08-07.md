# Devin — land the loads, placard and equipment work

Repo: `~/Projects/FuelGuard`, branch `main`. Last commit `6dd5fc0`; everything below is uncommitted.

Roughly 45 files, six migrations (`0140`–`0145`) and two weeks' worth of correctness fixes. Three of
those migrations replace live database functions, so **step 4 matters more than the rest** — read it
before you push.

---

## Step 1 — Delete the quarantine folder (do this first)

The Cowork session cannot unlink files on your disk, only move them, so deletions are staged in
`_to_delete/`. It is gitignored, so nothing there is in the diff — but one file in it is a **plaintext
extract of the Supabase service-role key**, made to diagnose the migration drift and never committed.
Delete the whole folder before anything else:

```bash
cd ~/Projects/FuelGuard
rm -rf _to_delete
```

It contains: `tmp-supabase-creds.txt` (the key extract — delete, do not open and reuse), two stale
`.git/index.lock` files, and `ld2-dead-dispatch/` (five dead dispatch source files that git already
records as deleted).

---

## Step 2 — The full gate

The Cowork session ran typechecks, all seven lint gates and all four behavioural matrices — those are
green. It **could not run vitest**: `node_modules` is macOS-built and rolldown's native binary will not
load in the Linux VM. The unit suites are the one thing nobody has executed, and this change adds
three new test files, so run them properly.

```bash
git switch main && git pull --ff-only

pnpm install
pnpm --filter @fuelguard/shared build:rn      # the driver bundle reads dist/, not src/

pnpm lint
pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity
pnpm --filter @fuelguard/web lint:tokens
pnpm typecheck
pnpm test                                      # unit suites + all four RLS matrices
```

Expected matrix counts, unchanged: **rls 159 · hazmat_rls 16 · load-lifecycle 42 · duty-sessions 20.**
If any of those four numbers moved, that is a regression, not a new assertion — stop and report it.

New test files that have never run: `packages/hazmat-engine/src/placards/tableSelect.test.ts`,
`packages/hazmat-engine/src/placards/compute.aggregate.test.ts`,
`apps/api/src/services/dispatchLoads/detail.test.ts`.

---

## Step 3 — Commit and push

```bash
git add -A
git commit -m "Add load detail, exceptions feed, and correct the placard engine's Table 2 scope"
git push origin main
```

CI runs the same sequence. Do not proceed to step 4 until it is green.

---

## Step 4 — Watch the migrations land, carefully

**Read this before pushing.** `GET /api/version` last reported `schema.applied: null`, meaning the
remote ledger is somewhere around `0134` and the API cannot even read its own schema version. So this
push may apply **eleven migrations at once**, and three of them replace functions that are live:

| Migration | What it replaces | Why it is safe |
| --- | --- | --- |
| `0141` | The four `driver_*_load` RPCs — new signatures, old ones dropped | Nothing calls the old ones. They took the driver from `auth_driver_id()`, which is always null for the service role the API uses, so the driver write path could never have worked. |
| `0142` | `loads_status_guard()` | Same body plus three additions: separation of duties (off by default), `approved_by` now required on approval, `submitted_at`/`approved_at` stamped by the trigger. |
| `0143` | `start_duty_session` and `change_duty_equipment` | Same bodies with the SQLSTATEs realigned to the `DG001`–`DG005` the API already maps and tests, plus the org-scope check that was missing. |
| `0144` | — | Backfills `trailers.trailer_type = 'reefer'` where `is_reefer`. Guesses nothing else. |
| `0145` | — | Widens the `load_events` kind constraint and adds one index. |

Get the ground truth **before** applying:

```bash
supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase migration list --linked
```

Paste that table into your report. Then let the **Apply Supabase migrations** workflow run (preferred —
the ledger should be written by one path), and verify:

```bash
pnpm verify:live
```

`schema.state` must read `current` and `schema.applied` must be `0145`. Anything else, stop and report.

**If a migration errors, do not edit it to get past.** `0135` and `0136` close real driver-scope
security leaks and their content is deliberate.

---

## Step 5 — The manual work that is still blocking testing

None of this is code. All of it is why the app on the phone looks half-connected.

**5a. Deploy the platform console** (`railway.admin.json`) — new Railway service, **Root Directory
EMPTY**, config path `railway.admin.json`. Those are the same two settings that broke the driver-dist
service twice; check them before the first deploy, not after. Variables and health check are in
`docs/plans/ADMIN-PHASE0-RUNBOOK.md`.

**5b. Add Miki as a platform owner.** Supabase → Authentication → create a user for
`miki@silvicominc.com`, then in the SQL editor:

```sql
insert into platform_admins (email, role, status)
values ('miki@silvicominc.com', 'platform_owner', 'active')
on conflict (email) do update set role = 'platform_owner', status = 'active';
```

Leave `user_id` NULL — it links on first login. He must enrol TOTP; every `/admin` route requires
aal2. This is the one hand-written row we are entitled to.

**5c. Grant Silvicom its modules — through the console, not SQL.** Customers → Silvicom Inc →
Entitlements → grant **HazmatGuard, Messages, Notifications, Training**. The point is to prove the
mechanism and produce an audit row with a named actor; a SQL insert would fix the symptom and teach us
nothing.

**This is what unblocks the field reports.** `docs/plans/drivers-app/FIELD-REPORTS.md` records that
nothing hazmat is connected on the phone and that image capture stores nothing. The first is entirely
explained by the missing entitlement, and the second may be a symptom of it — with the module
ungranted, the capture screen has no server to post to. **Re-test capture only after 5c**, then report
what actually happens.

**5d. Only after 5c succeeds**, remove the superseded backfill:

```bash
git rm supabase/migrations/0139_backfill_modules_existing_orgs.sql
```

It grants every module to "orgs existing when it runs" — run after a real second customer is onboarded,
it silently gifts them HazmatGuard. Check `supabase migration list --linked` first and report whether
it is already recorded as applied; if so, deleting the file is local-only and the ledger keeps its row.

---

## Step 6 — Report back

1. `supabase migration list --linked`, before and after.
2. Whether `0135` and `0136` were among the missing — say so prominently if they were; those are
   security fixes that were not live.
3. `pnpm test` output, especially the four matrix counts and the three new test files.
4. Final `pnpm verify:live`.
5. The console URL, and a screenshot of Silvicom's entitlements after granting.
6. What image capture does on the phone *after* 5c.

---

## Two things to leave alone

- **Do not add anything to the `GRANDFATHERED` list in `scripts/check-file-size.mjs`.** Commit
  `234de58` added four API files to it silently, in a commit about deployment tooling, and that list's
  own comment says it may only shrink. It is on the board as debt; do not grow it. When
  `packages/hazmat-engine/src/placards/compute.ts` crossed the budget during this work it was split
  into `classify.ts` instead.
- **Do not edit `apps/driver/runtime-version.json`.** It is bumped only when native code changes, and
  CI tells you when that is.
