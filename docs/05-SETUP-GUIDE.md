# FleetGuard — Setup & Deployment Guide

> Supabase + Railway + environment configuration. Hand-in-hand with Phase 9 of the prompt pack.

---

## 1. Accounts & services you need

| Service | Plan | Used for |
|---------|------|----------|
| Supabase | Free tier | Postgres, Auth, Storage |
| Railway | Hobby | Hosting `web` + `api` |
| Resend (or SMTP) | Free | Anomaly emails (Phase 8) — optional until then |
| GitHub | — | Repo + CI; Railway deploys from it |

---

## 2. Supabase setup

1. **Create two projects** (or one for now, one for prod later): `fleetguard-dev`, `fleetguard-prod`.
2. **Auth → Providers:** keep Email enabled. Disable open sign-ups if available; we invite users.
   Enable "Confirm email." Set the Site URL and redirect URLs to your local + Railway web domains.
3. **Apply schema:** run the migrations from `/supabase/migrations` (via Supabase CLI
   `supabase db push`, or paste in the SQL editor in order). Then run `seed.sql` (dev only).
4. **Custom Access Token hook:** enable the hook (Auth → Hooks) using the SQL provided in Phase 2
   so every JWT carries `org_id` and `role`. This is what RLS reads.
5. **Storage:** create a private bucket `receipts`; add Storage policies mirroring the DB tenant
   rules (a user may read/write objects only under their `org_id/...` prefix).
6. **Grab keys:** Project URL, `anon` key (browser-safe), `service_role` key (server only — secret).

> Verify RLS *through the client SDK*, not the SQL editor — the editor bypasses RLS and will give
> you false confidence.

---

## 3. Environment variables

### apps/web (`.env`, all build-time, **non-secret only**)
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_API_URL=http://localhost:8080        # prod: the Railway api domain
```

### apps/api (`.env`, **secrets — server only**)
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # NEVER expose to the browser
ALLOWED_ORIGINS=http://localhost:5173          # prod: the Railway web domain
PORT=8080
NODE_ENV=development
# Phase 8:
RESEND_API_KEY=<key>            # or SMTP_HOST / SMTP_USER / SMTP_PASS
MAIL_FROM=alerts@silvicominc.com
```

> Golden rule: only `VITE_`-prefixed, non-secret values ever reach the frontend bundle. The
> service-role key lives exclusively in the `api` service.

---

## 4. Local development

```bash
pnpm install
# terminal 1
pnpm --filter api dev        # http://localhost:8080
# terminal 2
pnpm --filter web dev        # http://localhost:5173
```

Apply DB changes with the Supabase CLI against the dev project. Use a real `@silvicominc.com`
test inbox (or Supabase's invite flow) to exercise login.

---

## 5. Railway deployment

FleetGuard is a monorepo with **two services** off one repo.

1. **New Project → Deploy from GitHub repo.** Create two services from the same repo:

   **Service `api`**
   - Root directory: `apps/api`
   - Build: `pnpm install && pnpm --filter @fleetguard/api build`
   - Start: `node apps/api/dist/index.js` (adjust to your build output)
   - Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, mail vars,
     `NODE_ENV=production`, `PORT` (Railway provides one).

   **Service `web`**
   - Root directory: `apps/web`
   - Build: `pnpm install && pnpm --filter @fleetguard/web build`
   - Serve `dist/` as static (Caddy/`serve`). For an SPA, configure a catch-all rewrite to
     `index.html`.
   - Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.

2. **Cross-service URLs via reference variables:**
   - `web.VITE_API_URL` → reference `api.RAILWAY_PUBLIC_DOMAIN` (prefix `https://`).
   - `api.ALLOWED_ORIGINS` → reference `web.RAILWAY_PUBLIC_DOMAIN`.
   - Remember: **Vite variables are baked in at build time** — changing `VITE_API_URL` requires a
     `web` rebuild, not just a restart.

3. **Supabase prod:** point Auth Site URL + redirect URLs at the `web` Railway domain. Run
   migrations on `fleetguard-prod`. Seed only the org row.

4. **Smoke test:** run the Playwright e2e against the live `web` URL, then invite the first admin.

---

## 6. Go-live checklist

- [ ] Migrations applied to prod; RLS verified via client SDK as member vs. outsider.
- [ ] Custom Access Token hook enabled (JWT carries `org_id` + `role`).
- [ ] `receipts` bucket private with tenant-scoped Storage policies.
- [ ] No service-role key in the web bundle (grep the build output).
- [ ] Auth redirect URLs match the Railway web domain.
- [ ] `ALLOWED_ORIGINS` / CORS correct between services.
- [ ] Invite → set password → login works for an `@silvicominc.com` user; non-allowed domain rejected.
- [ ] Log a bad fill-up → anomaly appears → resolve it → audit log recorded → email sent.
- [ ] Dashboard KPIs and CSV/PDF export render with prod data.

---

## 7. Cost & scaling notes

- Free Supabase tier is fine for a single fleet's volume; watch the 500MB DB / storage limits as
  receipt photos accumulate (compress on upload, or set a retention policy).
- Railway Hobby covers two small services; the `api` can sleep when idle if you accept cold starts,
  or stay warm for snappier anomaly scoring.
- When a second tenant arrives, **no schema change is needed** — add an `organizations` row + its
  `allowed_domains`, invite its admin. The multitenant design pays off here.

---

## Sources
- [Supabase RLS multi-tenant best practices (Makerkit)](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Supabase — Row Level Security docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Railway — Deploying a monorepo](https://docs.railway.com/guides/deploying-a-monorepo)
- [Railway — Frontend environment variables](https://docs.railway.com/guides/frontend-environment-variables)
- [Railway — Deploy a Vue app](https://docs.railway.com/guides/vue)
