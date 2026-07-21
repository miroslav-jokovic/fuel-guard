# Phase 0 — bring-up runbook (platform admin plane)

Everything in Phase 0 is committed. This is the ordered checklist to wire it up on real infra. Steps
marked **[you]** need a full-toolchain machine (your Mac) or dashboard/DNS access the sandbox can't reach.

## 1. Install + lockfile **[you]**
Two new workspace packages were added (`@fuelguard/admin-api`, `@fuelguard/admin`, `@fuelguard/ui`), so
the lockfile needs updating once:

```
pnpm install
git add pnpm-lock.yaml && git commit -m "chore: lockfile for admin plane packages"
```

CI runs `pnpm install --frozen-lockfile`, so the updated lockfile must be committed or CI fails. After
this, `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`, and `pnpm lint` all cover the new packages.

## 2. Build check **[you]**
The sandbox can't run `vite build` (native binary), so confirm the two builds locally once:

```
pnpm --filter @fuelguard/admin build        # vue-tsc + vite build → apps/admin/dist
pnpm --filter @fuelguard/admin-api build     # tsc typecheck
pnpm --filter @fuelguard/admin dev           # eyeball login → MFA → shell at http://localhost:5174
```

If Tailwind purges classes used only inside `@fuelguard/ui`, confirm the `@source` line in
`apps/admin/src/style.css` points at `packages/ui/src` (it does by default).

## 3. Database migrations
`0070_platform_admins.sql` + `0071_platform_audit_log.sql` auto-apply via `.github/workflows/migrate.yml`
on merge to `main` (needs the three `SUPABASE_*` repo secrets). To apply now instead: `supabase db push`.
They seed the owner row (`developmentteam@uncdevelopment.com`, `platform_owner`).

## 4. Owner auth user **[you]**
The seed row has no linked `auth.users` yet. In the Supabase dashboard → Authentication → Users, create
(or invite) a user with **developmentteam@uncdevelopment.com** and set a password. `admin-api` links the
row to this user by email on first authenticated request — no code change, no manual `user_id`.

## 5. Confirm MFA (TOTP) is enabled **[you]**
Supabase dashboard → Authentication → Providers/MFA → ensure **TOTP** is enabled (it's the default,
no paid plan needed). The admin app enrolls TOTP on first login; the gate rejects anything below `aal2`.

## 6. Second Railway service **[you]**
Create a NEW Railway service in the same project, from the same repo, and point its config-as-code path at
**`railway.admin.json`** (Service → Settings → Config-as-code). It builds `apps/admin` and starts
`apps/admin-api` (which serves the built SPA) — mirroring the customer service's single-service shape.

Service variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | same project URL as the customer API |
| `SUPABASE_SERVICE_ROLE_KEY` | same key — lives ONLY in this service + the customer API |
| `ALLOWED_ORIGINS` | `https://admin.<domain>` |
| `VITE_SUPABASE_URL` | same project URL (build-time; Vite inlines it) |
| `VITE_SUPABASE_ANON_KEY` | project anon key (build-time) |
| `VITE_ADMIN_API_URL` | `https://admin.<domain>` (the admin API is same-origin as the SPA) |

`PORT` is provided by Railway; `ADMIN_DIST` defaults correctly. `STRIPE_*` come in Phase 2.

## 7. Subdomain + TLS **[you]**
Add the custom domain `admin.<domain>` to the new service and create the DNS CNAME Railway shows. The
strict CSP + forced HSTS assume HTTPS on this subdomain.

## 8. Smoke test
Visit `https://admin.<domain>` → sign in as the owner → enroll TOTP → land on Overview. The Overview card
calls `GET /admin/me`; **"connected · platform_owner"** confirms the full chain (JWT verify → aal2 →
allowlist lookup → link-on-first-login) works end-to-end. Any other operator is rejected with 403 until
added to `platform_admins`.

## What Phase 0 intentionally does NOT do yet
No customer data is reachable, no destructive actions exist, no billing. Those arrive in Phases 1–4 on top
of this spine. `apps/web` is untouched; its consolidation onto `@fuelguard/ui` is a separate, low-risk task
for when a full build + visual check is available (a token-parity CI check prevents drift until then).
