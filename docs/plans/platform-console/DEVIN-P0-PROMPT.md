# Devin — P0: get migrations flowing, stand up the platform console, entitle Silvicom

Repo: `~/Projects/FuelGuard`, branch `main`. Background is in
`docs/plans/platform-console/PLATFORM-AUDIT-2026-08-07.md`. Read it before starting.

**The problem in one paragraph.** Silvicom Inc owns FuelGuard, but its organization is modelled as an
ordinary customer, so the driver-app settings page shows HazmatGuard, Messages and Notifications as
"Not in your plan" with no way to enable them. The console that grants entitlements already exists
(`apps/admin-api`, fully built and tested) — it has simply never been deployed, and the only platform
admin on the allowlist is `developmentteam@uncdevelopment.com`, not Miki. Separately, migrations have
stopped reaching Supabase entirely, which blocks everything else.

Work the steps in order. Step 1 gates all the others.

---

## Step 1 — Find out why migrations stopped reaching Supabase

`GET https://fleetguardweb-production.up.railway.app/api/version` currently reports
`"schema": { "expected": "0140", "applied": null, "state": "unknown" }`. `applied: null` means the API
called `applied_schema_version()` and got nothing — migration `0140` is not there. Combined with the
`org_modules` evidence, the Supabase ledger has stalled somewhere in `0134`–`0138`.

This matters beyond the entitlements: **`0135` and `0136` closed two real driver-scope security leaks**
(a driver could write fuel records against trucks that were not theirs, and read other drivers' time-off
and TMS movements). If the ledger stalled before them, neither is live.

1. Open GitHub → Actions → **Apply Supabase migrations**. Look at the runs for commits `822d988`,
   `8595db5`, `234de58` and anything newer. Report what you find — did it run at all, and what failed.
2. Confirm the three repository secrets exist: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
   `SUPABASE_DB_PASSWORD`. The workflow now asserts them and fails loudly, so a manual re-run will say
   so plainly if any is missing. The old version failed silently, which is how this hid.
3. Establish the truth directly:

   ```bash
   brew install supabase/tap/supabase   # if not present
   supabase login
   cd ~/Projects/FuelGuard
   supabase link --project-ref <SUPABASE_PROJECT_REF>
   supabase migration list --linked     # local vs remote, side by side
   ```

   Paste that table into your report before applying anything — it is the first real picture we have
   had of the remote ledger.
4. Apply what is missing: re-run the workflow (preferred, so the ledger is written by the same path
   every time) or `supabase db push` if the workflow is blocked.
5. Verify:

   ```bash
   pnpm verify:live
   ```

   `schema.state` must read `current`. **Do not proceed past this step until it does.**

If a migration errors, stop and report the exact SQL error rather than editing migrations to get past
it. Several of these files close security gaps and their content is deliberate.

---

## Step 2 — Fix the driver install-page service (it is failing to build)

The failing build shows two stacked misconfigurations, both in the Railway service settings rather
than in the code:

- **Root Directory was set to `apps/driver-dist`.** Railway then read that folder's `package.json`,
  found no `engines` field, chose Node 18, and Node 18's bundled corepack could not verify npm's
  current registry signing keys — `Error: Cannot find matching keyid`.
- **Config-as-code path was not set**, so it fell back to `railway.json` and ran the *web app's*
  build command (`pnpm --filter @fuelguard/web build`) with the *API's* start command.

The service now builds from a Dockerfile instead of nixpacks — pinned `node:22-alpine`, two files
copied, no package manager, no workspace install. It has zero dependencies by design, so there is
nothing for a builder to resolve. In the service settings:

- **Root Directory: EMPTY.** The build context must be the repository root.
- **Config path: `railway.driver-dist.json`.**
- **Volume mounted at `/data`.**
- Variables: `TESTER_PASSWORD` (the tester passphrase) and `UPLOAD_TOKEN` (`openssl rand -hex 32`).

Redeploy and confirm `https://<dist-host>/healthz` returns `"status":"ok"`. It reports
`misconfigured` until both variables are set, and refuses every request in that state.

Full detail: `docs/plans/ship-pipeline/SETUP.md` §4.

---

## Step 3 — Add Miki as a platform owner

`platform_admins` is service-role only (RLS on, zero policies), there is no API to add a row, and
`0070` seeds exactly one owner — a different address. This is the one hand-written row we are entitled
to; P3 of the plan replaces this with a console screen so it is the last.

1. Supabase dashboard → Authentication → Users → create a user for `miki@silvicominc.com` with a
   strong password. Send Miki the credentials over a secure channel.
2. SQL editor:

   ```sql
   insert into platform_admins (email, role, status)
   values ('miki@silvicominc.com', 'platform_owner', 'active')
   on conflict (email) do update set role = 'platform_owner', status = 'active';
   ```

   Leave `user_id` NULL — `lookupPlatformAdmin` matches by lower-cased email on first login and stamps
   `user_id` itself.
3. Miki must enrol TOTP. Every `/admin` route requires `aal2`; the console will force him to `/mfa`
   before anything else loads. Have an authenticator app ready before he first signs in.

Do **not** add anyone else. Adding operators is a P3 feature, not a habit.

---

## Step 4 — Deploy the platform console

Follow `docs/plans/ADMIN-PHASE0-RUNBOOK.md`. It has never been executed — every URL in the repo is
still the placeholder `https://admin.<domain>`. New Railway service in the same project:

- **Root Directory: EMPTY**, **Config path: `railway.admin.json`** — same two settings that broke the
  driver-dist service. Check them before the first deploy, not after.
- Variables: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the **same** project as the customer app
  — this is deliberate and documented in `apps/admin-api/src/env.ts:17`), `ALLOWED_ORIGINS` set to the
  admin service's own origin, and the build-time `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_ADMIN_API_URL` (leave the last empty for same-origin).
- Health check is `/healthz` and is public.

Note the service holds a service-role key with cross-tenant reach. Give it its own Railway service,
never a shared one, and do not add its URL to any public documentation.

Confirm: `https://<admin-host>/healthz` returns 200, Miki can sign in, is forced through MFA, and
`/customers` lists Silvicom.

---

## Step 5 — Entitle Silvicom through the console

In the console: **Customers → Silvicom Inc → Entitlements**. Grant **HazmatGuard**, **Messages**,
**Notifications** and **Training**. `Dispatch` and `Navigation` are already granted.

Use the console, not SQL. The point of this step is to prove the mechanism works end to end and to
produce an audit row with a named actor — `entitlement.grant` in `platform_audit_log`, with
`enabled_by` set on each `org_modules` row. A SQL insert would fix the symptom and teach us nothing.

Then have Miki reload the tenant dashboard → Settings → Driver App. The three "Not in your plan" pills
should be gone and the toggles should be **On** without any further action: `hazmat.capture`,
`messages` and `notifications` all carry `defaultEnabled: true`, and the resolver treats an absent org
row as the catalog default. (`training` stays off — it is `released: false`.)

---

## Step 6 — Remove migration 0139

```bash
git rm supabase/migrations/0139_backfill_modules_existing_orgs.sql
```

It grants every module to "orgs that exist when it runs" — temporal, not identity-based. If it ever
runs after a real second customer is onboarded, that customer silently receives HazmatGuard, Messages
and Notifications for free, which is exactly the outcome its own header says it exists to prevent.
Step 5 has already done its job properly.

**Only delete it after Step 5 has succeeded**, and confirm with `supabase migration list --linked`
whether `0139` is recorded as applied — if it is, deleting the file is a local-only change and the
remote ledger keeps its row. Report which case applies.

Then run the full gate and push:

```bash
pnpm install
pnpm --filter @fuelguard/shared build:rn
pnpm lint && pnpm lint:migrations && pnpm lint:boundaries && pnpm typecheck && pnpm test
git add -A
git commit -m "Fix driver-dist Railway build and retire the temporal module backfill"
git push origin main
pnpm verify:live
```

---

## Report back

1. The `supabase migration list --linked` table from Step 1, before and after.
2. Whether `0135` and `0136` were among the missing migrations — if so, say so prominently; those are
   security fixes that were not live.
3. `https://<dist-host>/healthz` and `https://<admin-host>/healthz` responses.
4. A screenshot of the console's Silvicom entitlements page after granting.
5. A screenshot of the tenant dashboard's Driver App settings page with the pills gone.
6. Final `pnpm verify:live` output.

If any step fails, stop and report the exact error. Do not work around a failing migration, and do not
grant entitlements by SQL if the console is not working — the console not working is itself the finding.
