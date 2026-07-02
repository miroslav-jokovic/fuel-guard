# FuelGuard — Deployment Guide (Supabase + Railway, single service)

> This is the step-by-step for shipping FuelGuard to the internet. We deploy as **one Railway
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
| **GitHub** | free | Holds the repo; Railway deploys from it. Push FuelGuard to a GitHub repo if it isn't already. |
| **Supabase** | Free tier | Postgres database, Auth (logins), Storage (receipt photos). |
| **Railway** | Trial/Hobby | Hosting. Sign in with GitHub so it can see your repo. |

> Push the repo to GitHub first (private is fine). Railway builds from a GitHub repo, so this is the
> prerequisite for Stage 3.

---

## Stage 1 — Supabase project & schema

### 1.1 Create the project
1. Supabase dashboard → **New project**. Name it `fuelguard-prod`.
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

Because FuelGuard is invite-only, the very first admin can't invite themselves — we seed one org and
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
1. Railway → **New Project → Deploy from GitHub repo** → pick the FuelGuard repo.
2. Railway reads **`railway.json`** in the repo, so the build and start commands are already set:
   - build: `pnpm install && pnpm --filter @fuelguard/web build`  (builds the SPA)
   - start: `pnpm --filter @fuelguard/api start`  (Node API that also serves the SPA)
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
| `WEB_APP_URL` | `https://fleetguardweb-production.up.railway.app` | ✅ (invite links) |
| `ALLOWED_ORIGINS` | `https://fleetguardweb-production.up.railway.app` | ✅ |
| `NODE_ENV` | `production` | recommended |
| `ANTHROPIC_API_KEY` | Anthropic key | optional (AI verification; engine runs without it) |
| `RESEND_API_KEY` | `re_...` from resend.com | ✅ (invite emails) |
| `MAIL_FROM` | `FuelGuard <miki@silvicominc.com>` | ✅ (invite emails) |
| `SAMSARA_API_TOKEN` | Samsara API token | optional (telematics; add when ready) |

> ⚠️ **Two completely different domains** — do not confuse them:
> - **`WEB_APP_URL`** = `fleetguardweb-production.up.railway.app` — the Railway app URL that goes **inside** invite emails as the link destination. No verification needed anywhere.
> - **`MAIL_FROM` sender domain** = `silvicominc.com` — the domain Resend sends **from**. This is your company email domain and must be verified in Resend (Stage 5). Railway's domain is never used here.

> `VITE_*` variables are baked into the web bundle **at build time** — Railway makes service variables
> available to the build, so setting them here is enough. You do **not** need `VITE_API_URL`: the UI
> talks to the API on the same domain by default.

### 3.3 Domain (already generated)
Your Railway domain is **`https://fleetguardweb-production.up.railway.app`**. Both
`WEB_APP_URL` and `ALLOWED_ORIGINS` should be set to this value (no trailing slash) as shown in
the table above. **Redeploy** after setting variables so the build picks them up.

**Check:** open `https://fleetguardweb-production.up.railway.app/healthz` → you should see `{"status":"ok",...}`. Then open
`https://fleetguardweb-production.up.railway.app/` → the FuelGuard login screen.

---

## Stage 4 — Point Supabase at the live domain & first login

1. Supabase → **Authentication → URL Configuration:**
   - **Site URL:** `https://fleetguardweb-production.up.railway.app`
   - **Redirect URLs:** add `https://fleetguardweb-production.up.railway.app/**` (covers `/accept-invite`, etc.)
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
| Invite emails not arriving | Set `RESEND_API_KEY` + `MAIL_FROM` in Railway and verify `silvicominc.com` in Resend (see Stage 5). Check Railway Logs for `[mailer]` error lines — 403 = domain not verified, 401 = bad key. |
| `/healthz` works but `/` is blank/404 | The web build didn't run or `apps/web/dist` is empty — check the build logs; `railway.json` build command must succeed. |

---

## Stage 5 — Email delivery (Resend)

Invitation emails go through **Resend** (https://resend.com). Without this stage invites still work
— the admin copies a link — but recipients won't receive an email automatically.

### 5.1 Create a Resend account & API key
1. Sign up at **https://resend.com** (free tier: 3,000 emails/month, 100/day).
2. **API Keys → Create API Key** — name it `fuelguard-prod`, permission: **Sending access**.
3. Copy the key (`re_...`). You'll set it as `RESEND_API_KEY` in Railway.

### 5.2 Verify your sending domain
Resend requires the **`from` email domain** to have DNS records verified before it delivers to
any recipient. This is **your company domain (`silvicominc.com`)** — completely separate from
the Railway app domain (`fleetguardweb-production.up.railway.app`), which is just a URL in the
email body and needs no verification anywhere.

1. Resend dashboard → **Domains → Add Domain** → enter `silvicominc.com`.
2. Resend shows **3 DNS records** to add (SPF TXT, DKIM CNAME × 2, optionally DMARC TXT).
3. Add these in your DNS provider (Cloudflare, GoDaddy, Route 53, etc.) for `silvicominc.com`.
4. Click **Verify** in Resend — all records turn green within a few minutes (up to 48 h in rare cases).

> **Cannot verify the domain yet?** Use Resend's shared test sender while DNS propagates:
> set `MAIL_FROM=FuelGuard <onboarding@resend.dev>` — this only delivers to your **own**
> Resend-account email, not to arbitrary recipients. Switch back once `silvicominc.com` is verified.

### 5.3 Set Railway environment variables
In Railway → your service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `RESEND_API_KEY` | `re_...` (from step 5.1) |
| `MAIL_FROM` | `FuelGuard <miki@silvicominc.com>` |
| `MAIL_PROVIDER` | `resend` *(optional — auto-detected from the key)* |

Then **Redeploy**. The startup log will print:
```
[env] MAIL_PROVIDER auto-set to 'resend' (RESEND_API_KEY is present)
```

### 5.4 Verify it works
1. Settings → Users → invite any address.
2. Check Railway **Logs** — a successful send shows no `[mailer]` error lines.
3. If you see `[mailer] resend 403 validation_error: The silvicominc.com domain is not verified` →
   DNS records haven't propagated yet, or the domain wasn't added in Resend. Re-check step 5.2.
4. If you see `[mailer] resend 401` → `RESEND_API_KEY` is wrong or missing.

> The invite UI always shows a **copy link** button regardless of email status, so admins can share
> the link manually even if email delivery is temporarily broken.

---

## Going further (optional, after it's live)
- **Custom domain:** Railway → Settings → Networking → Custom Domain (add a CNAME at your DNS).
- **Separate staging:** repeat with a second Supabase project + Railway service (`fuelguard-staging`).
- **Samsara:** add `SAMSARA_API_TOKEN` and map each vehicle's `samsara_vehicle_id` (docs/10).
- **CI:** Railway auto-deploys on push to your chosen branch — set it under Settings → Deploys.
