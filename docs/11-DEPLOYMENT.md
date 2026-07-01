# FleetGuard — Deployment Guide (Supabase + Railway, single service)

> This is the step-by-step for shipping FleetGuard to the internet. We deploy as **one Railway
> service** (Option A): the Node API also serves the built web UI, so everything lives at **one
> Railway domain** with no CORS to configure. Follow the stages in order — each ends with a check so
> you know it worked before moving on.

**The shape of what we're building**

```
            ┌─────────────────────────── Railway (one service, one domain) ───┐
  browser → │  Express API  ──serves──>  built Vue SPA (apps/web/dist)         │
            │       │                                                          │
            └───────┼──────────────────────────────────────────────────────────┘
                    │  service_role key (secret)
                    ▼
              Supabase  (Postgres + Auth + Storage)   ◄──── browser also talks here directly
```

---

## Stage 0 — Accounts you'll need (5 min)

| Service | Plan | What it's for |
|---------|------|----------------|
| **GitHub** | free | Holds the repo; Railway deploys from it. Push FleetGuard to a GitHub repo if it isn't already. |
| **Supabase** | Free tier | Postgres database, Auth (logins), Storage (receipt photos). |
| **Railway** | Trial/Hobby | Hosting. Sign in with GitHub so it can see your repo. |

> Push the repo to GitHub first (private is fine). Railway builds from a GitHub repo, so this is the
> prerequisite for Stage 3.

---

## Stage 1 — Supabase project & schema

### 1.1 Create the project
1. Supabase dashboard → **New project**. Name it `fleetguard-prod`.
2. Pick a strong **database password** and **save it** (you'll need it for the CLI). Choose the region
   closest to your drivers/office.
3. Wait ~2 minutes for it to provision.

### 1.2 Apply the database schema (13 migrations + nothing else for prod)
The migrations build every table, all Row-Level-Security policies, the `receipts` storage bucket, the
audit triggers, and the auth-hook **function**. Two ways to run them — pick one.

**Option 1 — Supabase CLI (recommended, one command):**
```bash
# install once:  npm i -g supabase   (or: brew install supabase/tap/supabase)
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>     # ref is in Project Settings → General
supabase db push                                    # applies everything in supabase/migrations in order
```

**Option 2 — SQL editor (no tools):** open **SQL Editor** in the dashboard and paste the contents of
each file in `supabase/migrations/` **in numerical order** `0001 → 0013`, running each one before the
next.

> ⚠️ **Do NOT run `supabase/seed.sql` in production** — it's demo data (fake trucks and ~140 fake
> fuel transactions) for local testing. Production starts empty; we add the real org in Stage 2.

**Check:** Table Editor shows `organizations`, `vehicles`, `fuel_transactions`, `anomalies`,
`efs_transactions`, `integration_credentials`, etc. Storage shows a private **`receipts`** bucket.

### 1.3 Enable the Custom Access Token hook  ← easy to forget, nothing works without it
This is what stamps each login with the user's `org_id` and role so the security rules know who they
are.

1. **Authentication → Hooks (Beta)** → **Custom Access Token**.
2. Enable it and select the function **`public.custom_access_token_hook`** (created by migration 0006).
3. Save.

**Check:** the hook shows as Enabled, pointing at `custom_access_token_hook`.

### 1.4 Auth settings
1. **Authentication → Providers → Email:** keep **Email** enabled. Turn **Confirm email** on.
2. **Authentication → Sign-ups:** the app is invite-only; you can leave public sign-ups on for now
   (RLS still denies any user with no membership) and tighten later.
3. **URL configuration:** we'll fill in the real Railway domain in Stage 4 — leave defaults for now.

### 1.5 Grab the three keys (Project Settings → API)
| Key | Where it's used | Secret? |
|-----|------------------|---------|
| **Project URL** (`https://xxxx.supabase.co`) | web build + API | no |
| **anon public** key | web build (browser) | no (safe in browser) |
| **service_role** key | API only | **YES — never put in the browser / web vars** |

Keep these handy for Stage 3.

---

## Stage 2 — Bootstrap the real organization & first admin

Because FleetGuard is invite-only, the very first admin can't invite themselves — we seed one org and
link the first account to it by hand. After that, everything is done in-app.

1. **Create your login:** Supabase dashboard → **Authentication → Users → Add user** → enter your
   email + a password → create. Copy the new user's **UID**.
2. **SQL Editor → run this** (edit the email/UID; the org id is a fixed value you can keep):

```sql
-- Create the Silvicom organization (production, no demo data) + default thresholds.
insert into organizations (id, name, allowed_domains, operating_hours)
values ('00000000-0000-0000-0000-0000000000a1', 'Silvicom Inc.',
        array['silvicominc.com'], '{"start":"05:00","end":"20:00","tz":"America/Chicago"}')
on conflict (id) do nothing;

insert into anomaly_thresholds (org_id)
values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;

-- Make your user the owner/admin of that org.
insert into memberships (org_id, user_id, role)
values ('00000000-0000-0000-0000-0000000000a1', '<YOUR-AUTH-USER-UID>', 'owner');
```

> If your `role` enum uses `admin` instead of `owner`, use `admin`. Check the allowed values in the
> Table Editor for `memberships.role`.

**Check:** `memberships` has one row linking your UID to the org. (You'll actually log in after the
app is deployed in Stage 3.)

---

## Stage 3 — Deploy to Railway

### 3.1 Create the service from your repo
1. Railway → **New Project → Deploy from GitHub repo** → pick the FleetGuard repo.
2. Railway reads **`railway.json`** in the repo, so the build and start commands are already set:
   - build: `pnpm install && pnpm --filter @fleetguard/web build`  (builds the SPA)
   - start: `pnpm --filter @fleetguard/api start`  (Node API that also serves the SPA)
   - health check: `/healthz`
3. The first build will likely **fail or come up unconfigured** — that's expected, we haven't added
   the environment variables yet. Continue to 3.2.

### 3.2 Add environment variables (Service → **Variables**)
Paste these in. **Do not set `PORT`** — Railway injects it automatically and the app reads it.

| Variable | Value | Required |
|----------|-------|----------|
| `VITE_SUPABASE_URL` | your Supabase Project URL | ✅ (web build) |
| `VITE_SUPABASE_ANON_KEY` | your Supabase **anon** key | ✅ (web build) |
| `SUPABASE_URL` | same Supabase Project URL | ✅ (API) |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase **service_role** key (secret) | ✅ (API) |
| `WEB_APP_URL` | your Railway domain (set in 3.3) | ✅ (invite links) |
| `ALLOWED_ORIGINS` | your Railway domain (set in 3.3) | ✅ |
| `NODE_ENV` | `production` | recommended |
| `ANTHROPIC_API_KEY` | Anthropic key | optional (AI verification; engine runs without it) |
| `MAIL_PROVIDER` | `resend` or `brevo` or `none` | optional (default `none`) |
| `RESEND_API_KEY` / `BREVO_API_KEY` | provider key | only if `MAIL_PROVIDER` set |
| `MAIL_FROM` | `alerts@silvicominc.com` | optional |
| `SAMSARA_API_TOKEN` | Samsara API token | optional (telematics; add when ready) |

> `VITE_*` variables are baked into the web bundle **at build time** — Railway makes service variables
> available to the build, so setting them here is enough. You do **not** need `VITE_API_URL`: the UI
> talks to the API on the same domain by default.

### 3.3 Generate the free domain
1. Service → **Settings → Networking → Public Networking → Generate Domain**.
2. Railway gives you something like `fleetguard-production-xxxx.up.railway.app`.
3. Go back to **Variables** and set both `WEB_APP_URL` and `ALLOWED_ORIGINS` to
   `https://fleetguard-production-xxxx.up.railway.app` (no trailing slash).
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the build picks up the domain and the final vars.

**Check:** open `https://<your-domain>/healthz` → you should see `{"status":"ok",...}`. Then open
`https://<your-domain>/` → the FleetGuard login screen.

---

## Stage 4 — Point Supabase at the live domain & first login

1. Supabase → **Authentication → URL Configuration:**
   - **Site URL:** `https://<your-domain>`
   - **Redirect URLs:** add `https://<your-domain>/**` (covers `/accept-invite`, etc.)
2. Visit `https://<your-domain>`, **log in** with the email/password you created in Stage 2.
   - The auth hook stamps your `org_id` + role on login, so you land in the app (not the "pending"
     screen). If you see "pending", the membership row (Stage 2) or the hook (Stage 1.3) is missing.
3. In-app: **Settings → Users → invite** your teammates (they get an email to finish sign-up).
4. Add your real vehicles/drivers, and start uploading EFS reports from **Import**.

---

## Environment variable reference (quick recap)

**Browser-safe (baked into the web build):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
**Server-only secrets (never in the browser):** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`/`BREVO_API_KEY`, `SAMSARA_API_TOKEN`.
**Server config:** `SUPABASE_URL`, `WEB_APP_URL`, `ALLOWED_ORIGINS`, `NODE_ENV`, `MAIL_PROVIDER`,
`MAIL_FROM`. `PORT` is provided by Railway — don't set it.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Build fails on `pnpm`/`tsx` | Railway uses Node from `.nvmrc` (22) + `packageManager` (pnpm). Ensure both files are committed. The build installs dev deps (`--prod=false`) so `vite`/`tsx` are present. |
| App loads but every API call is 401/403 | Auth hook not enabled (Stage 1.3) or you logged in **before** enabling it — log out and back in. |
| Logged in but stuck on "account pending" | No `memberships` row for your user (Stage 2), or wrong `org_id`/role. |
| Login page loads but data calls fail in console (CSP/blocked) | `VITE_SUPABASE_URL` wrong or missing at build time → rebuild after setting it. |
| Invite emails not arriving | Supabase auth email (free tier) is rate-limited; for app anomaly emails set `MAIL_PROVIDER` + key. |
| `/healthz` works but `/` is blank/404 | The web build didn't run or `apps/web/dist` is empty — check the build logs; `railway.json` build command must succeed. |

---

## Going further (optional, after it's live)
- **Custom domain:** Railway → Settings → Networking → Custom Domain (add a CNAME at your DNS).
- **Separate staging:** repeat with a second Supabase project + Railway service (`fleetguard-staging`).
- **Samsara:** add `SAMSARA_API_TOKEN` and map each vehicle's `samsara_vehicle_id` (docs/10).
- **CI:** Railway auto-deploys on push to your chosen branch — set it under Settings → Deploys.
