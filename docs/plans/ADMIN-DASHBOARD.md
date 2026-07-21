# FuelGuard Platform Admin Dashboard — Design & Plan

> Status: design (pre-build). Scope: the internal control plane FuelGuard operators use to run the
> multi-tenant SaaS — manage customer organizations, oversee billing, run backups, watch errors, and
> perform safe repairs. Built to enterprise-grade standards from day one.

## 1. Purpose

Today FuelGuard is a single-tenant-per-user product: every signed-in user belongs to exactly one org,
and every table is walled off by RLS (`auth_org_id()` / `auth_role()`). There is no way — by design —
for one customer to see another. The admin dashboard is the deliberate, tightly-controlled exception:
a **separate control plane** where a small number of trusted FuelGuard operators get cross-org reach to
run the business. Because it crosses the tenant boundary, it is held to a higher security bar than the
customer app: least privilege, mandatory MFA, step-up for anything destructive, and an immutable audit
trail of everything.

## 2. Decisions (locked with product owner)

| Question | Decision |
|---|---|
| Isolation topology | **Separate frontend app + subdomain** (`apps/admin` → `admin.fuelguard.app`) and a **separate admin API service** (`apps/admin-api` → `admin-api.fuelguard.app`). Strongest blast-radius isolation; platform god-mode never shares a process with customer traffic. |
| Payments | **Stripe, charged on the marketing website** (checkout/subscription lives there, billing is automatic). The admin dashboard is the **oversight + control layer**: it mirrors Stripe state via webhooks and exposes manual override levers (comp, plan change, pause, retry) — it never takes card payments itself. |
| Admin sign-in | **`platform_admins` allowlist** (separate from tenant memberships) + **mandatory MFA (AAL2)** + **step-up re-auth ("sudo")** for destructive/sensitive actions. Seeded with a single owner: `developmentteam@uncdevelopment.com`. |
| Design system | Reuse the customer app's tokens, components, and rules verbatim (`apps/web/src/style.css` semantic roles + Tailwind v4 `@theme`). The admin app looks like FuelGuard, with a distinct accent + persistent "PLATFORM" chrome so operators always know which plane they're in. |

## 3. Architecture overview

```
                 customer plane (unchanged)                 platform plane (new)
   ┌───────────────────────────────┐        ┌────────────────────────────────────┐
   │  app.fuelguard.app (apps/web) │        │  admin.fuelguard.app  (apps/admin)  │
   │  Vue 3 · customer login       │        │  Vue 3 · platform login + MFA       │
   └───────────────┬───────────────┘        └────────────────┬───────────────────┘
                   │ Bearer (tenant JWT)                      │ Bearer (admin JWT, AAL2)
   ┌───────────────▼───────────────┐        ┌────────────────▼───────────────────┐
   │  api.fuelguard.app (apps/api) │        │  admin-api.fuelguard.app            │
   │  RLS-scoped, per-tenant       │        │  (apps/admin-api)                   │
   │  requireAuth/requireOrg/role  │        │  requirePlatformAdmin + AAL2 + RBAC │
   └───────────────┬───────────────┘        │  + step-up + audit-everything DAL   │
                   │ RLS enforces org_id     └────────────────┬───────────────────┘
                   │                                          │ service-role (bypasses RLS),
                   ▼                                          ▼ but ONLY via the audited DAL
   ┌───────────────────────────────────────────────────────────────────────────────┐
   │                              Supabase / Postgres                                │
   │  tenant tables (RLS unchanged)   ·   platform_* tables (service-role only,      │
   │                                       deny-by-default RLS, no client grants)    │
   └───────────────────────────────────────────────────────────────────────────────┘
```

Two shared foundations are reused, not forked: `packages/shared` (types, zod schemas, design rules) and
the existing security primitives already proven in the McLeod work — hashed tokens, service-role-only
tables, per-org module toggles (`org_integrations`), and the `audit_logs` pattern.

## 4. Identity, authentication & authorization

The guiding rule: **identity comes from a verified JWT; cross-tenant authority comes from a fresh
database allowlist lookup — never from a claim.** A stolen or stale token can therefore never grant
god-mode, and revocation is instant (delete the row) rather than waiting for a token to expire.

**Identity.** Platform admins authenticate through Supabase Auth (email + password or magic link). A
platform admin typically has *no* tenant membership, so `auth_org_id()` is null for them — which is
correct: the admin plane never uses tenant RLS. The customer access-token hook (`0006`) is untouched.

**MFA (AAL2) is mandatory.** On first login an admin must enroll TOTP MFA before the admin plane grants
anything. Every `admin-api` request requires the JWT's `aal` claim to equal `aal2`; an `aal1` token is
rejected with `mfa_required`. There is no non-MFA path into the platform plane.

**Authorization = allowlist lookup.** On every request `admin-api` verifies the JWT, checks `aal2`, then
looks up the caller in `platform_admins` (by `user_id`, must be `active`). No row → 403. This DB lookup
(one indexed hit) is the single source of truth for platform access; it is never cached in a claim.

**RBAC inside the platform plane** (least privilege among operators):

| Platform role | Can do |
|---|---|
| `platform_owner` | Everything, including managing other platform admins, restores, and break-glass. Only `developmentteam@uncdevelopment.com` at launch. |
| `platform_admin` | Full customer/billing/ops management; cannot add/remove platform admins or run cluster restores. |
| `platform_support` | Read + limited safe actions (resend invite, re-run scoring, view billing) — no deletes, no billing changes. |
| `platform_readonly` | Read-only across the dashboard; for auditors/analysts. |

**Step-up ("sudo mode").** Destructive or sensitive actions — delete/suspend an org, restore a backup,
impersonate, force a password reset, comp/credit/cancel billing, rotate secrets — require a re-auth
within the last N minutes (short window, e.g. 5). The action records `reauth_at` and fails closed if the
window lapsed. This is the classic GitHub/AWS "sudo" pattern.

**Session hardening.** Short admin session TTL + absolute timeout, device/session list with one-click
revoke, optional IP allowlist (configurable per admin), strict CSP + HSTS on the subdomain, and no CORS
allowance to any customer origin.

## 5. RLS & tenant-isolation strategy

This is the most important safety property, so it is deliberately conservative:

1. **Tenant tables are never modified.** We do not add "or is-platform-admin" clauses to any existing
   RLS policy. The audited single-tenant guarantee (`org_id = auth_org_id()`) stays exactly as it is.
   Weakening every tenant policy to admit a super-user is how cross-tenant leaks happen; we refuse to.
2. **Cross-org access is exclusively service-role, and only through `admin-api`.** The admin service
   uses the service-role client (which bypasses RLS) — but every cross-tenant read/write flows through
   one thin **data-access layer** that (a) enforces platform RBAC, (b) takes an explicit `org_id`
   argument (no implicit "all orgs" queries), and (c) writes a `platform_audit_log` row. No raw
   service-role queries are scattered through route handlers.
3. **New platform tables are deny-by-default.** Every `platform_*` table has RLS enabled with *no*
   permissive policy and *no* grant to `authenticated`/`anon` — reachable only by the service-role key,
   which lives solely in `admin-api`'s environment. This is the same shape as `org_integrations` and
   `audit_logs` today.

## 6. Impersonation & support access ("view as customer", repairs)

Support work sometimes needs to see or fix a specific customer's data. This is powerful, so it is
**explicit, time-boxed, reason-required, and double-logged** — never a silent backdoor:

- An admin opens a **support grant** for one org: reason (required), scope (`read_only` default, or
  `read_write` for repairs), and an expiry (e.g. 60 min). Read-write requires step-up.
- While the grant is live, the dashboard renders customer views by calling `admin-api`, which runs the
  tenant queries scoped to that single `org_id` via the audited DAL. A persistent banner shows
  "Viewing <Org> as platform support — grant expires 14:32".
- **Every** action is written to `platform_audit_log` *and* mirrored into that org's own `audit_logs`
  with `actor = <platform admin>`, so the customer's trail transparently shows platform involvement.
- Grants auto-expire; owners can revoke any admin's grant instantly.

## 7. Capability modules

The dashboard is organized into modules that map to "full control on customers, payments, backups,
settings, errors and repairs". Each module is a set of allowlisted operations — never arbitrary power.

**7.1 Customers (organizations).** List every org with health, plan, status, member/vehicle counts,
last activity, and open-anomaly volume. Drill into one org to: rename, manage `allowed_domains`,
suspend (blocks logins, preserves data), soft-delete (retention window) and eventual hard-delete
(step-up + typed confirmation), and toggle **per-org modules** by reusing `org_integrations` (McLeod/TMS
today; future modules the same way). This is where a new customer is provisioned.

**7.2 Users & access.** Across all orgs: view memberships, invite/remove members, change roles, resend
invites, force a password reset (step-up), and inspect recent auth events. Managing `platform_admins`
themselves (add/suspend/role-change) is **owner-only** and always audited.

**7.3 Billing oversight (Stripe).** Stripe is the source of truth and charging is automatic on the
website; the dashboard is the control room (see §8).

**7.4 Backups & data.** On-demand logical exports (per-org or full), export/restore history, and a
gated restore-orchestration workflow, plus GDPR-style per-org export and right-to-be-forgotten deletion
(see §12).

**7.5 Settings & feature flags.** Global platform settings, per-org overrides (threshold defaults,
operating-hours templates, module flags), and staged feature rollout — enable a feature for a subset of
orgs, watch, then widen.

**7.6 Errors & repairs (ops).** Live error feed, background-job health (scoring, backfill, McLeod
ingest, Stripe webhooks), data-integrity checks, and a catalog of **named, idempotent, dry-runnable
repair operations** (see §13). No arbitrary SQL write path.

**7.7 Audit & compliance.** A searchable, exportable, append-only log of every platform action — the
backbone of the whole design. Filter by admin, org, action, or time; export for compliance review.

## 8. Billing model (Stripe on website · control in admin)

The split the product owner chose is the clean, standard SaaS shape:

- **Charging is automatic, on the marketing website.** Stripe Checkout / Customer Portal handle signup,
  card capture, subscription creation, renewals, retries, and dunning. FuelGuard never touches card data.
- **`admin-api` ingests Stripe webhooks** (`checkout.session.completed`, `customer.subscription.*`,
  `invoice.*`, `charge.*`) into local **mirror tables**, with the raw event stored for idempotency
  (Stripe can redeliver). Webhook signatures are verified; each `event.id` is processed once.
- Each org is linked to a `stripe_customer_id`. The dashboard then shows plan, status
  (active/past_due/canceled/trialing), current-period end, MRR, and invoice history per org and in
  aggregate.
- **"With support of our control"** = manual override levers that call the Stripe API server-side, each
  step-up + audited: comp/credit an account (Stripe coupon/credit), change or cancel a plan, pause
  collection, retry a failed payment, or flag an org as comped so automatic suspension skips it.
- **Entitlement enforcement:** subscription status flows back into the customer app (e.g. `past_due`
  beyond grace → read-only or suspended). The rule engine and features gate on the mirrored status, so
  billing state and product access never drift apart.

## 9. Data model — new tables (all `platform_*`, service-role only, deny-by-default RLS)

Sketches (final columns settled per-migration; every table gets RLS enabled with no client policy):

- **`platform_admins`** — `id, email (citext unique), user_id (fk auth.users, null until first login),
  role (platform_owner|platform_admin|platform_support|platform_readonly), status (active|suspended),
  mfa_enrolled_at, last_reauth_at, ip_allowlist (inet[]), created_at, disabled_at, notes`.
- **`platform_audit_log`** — `id, admin_id, admin_email, action, target_org_id, target_entity,
  target_id, reason, before jsonb, after jsonb, ip, user_agent, created_at`. Append-only (no update/
  delete grant); the immutable spine.
- **`support_impersonation_grants`** — `id, admin_id, org_id, scope (read_only|read_write), reason,
  created_at, expires_at, revoked_at`.
- **`billing_customers`** — `org_id (pk), stripe_customer_id, plan, status, current_period_end,
  cancel_at, mrr_cents, comped bool, updated_at`.
- **`billing_invoices`** — mirror of Stripe invoices (`stripe_invoice_id, org_id, amount_due, amount_paid,
  status, hosted_url, period_start, period_end, created_at`).
- **`billing_events`** — raw Stripe webhook log keyed by `stripe_event_id` for idempotent processing.
- **`backup_jobs` / `restore_jobs`** — `id, kind (org_export|full_export|restore), org_id?, status
  (queued|running|done|failed), requested_by, artifact_url, checksum, started_at, finished_at, error`.
- **`platform_error_events`** — `id, source (api|admin-api|web|job), org_id?, level, fingerprint,
  message, context jsonb, count, first_seen, last_seen` (or a thin adapter over Sentry).
- **`platform_jobs_health`** — last run / success / lag per background job (scoring, backfill, ingest,
  webhooks) so "stuck job" is visible and repairable.
- **`feature_flags` / `feature_flag_overrides`** — global flags + per-org overrides for staged rollout.
- **`platform_settings`** — singleton-ish global config (grace periods, retention windows, thresholds).

## 10. Admin API design (`apps/admin-api`)

A dedicated Express + TS service, structured like `apps/api` (zod at the edge, service-role client,
per-route auth), but every route sits behind the full platform gate. The middleware chain, in order:

1. `requirePlatformAuth` — verify JWT via JWKS (reuse the existing verifier).
2. `requireAAL2` — reject anything below `aal2` with `mfa_required`.
3. `requirePlatformAdmin` — fresh `platform_admins` lookup (active); attach `req.platform = {adminId,
   email, role}`.
4. `requirePlatformRole(...roles)` — per-route RBAC.
5. `requireStepUp` — only on destructive/sensitive routes; checks `last_reauth_at` within the window.
6. Handler → **audited DAL** → service-role → DB, always writing `platform_audit_log`.

**Fitness function.** Extend the existing route-auth test so that *every* `admin-api` route is proven to
require `requirePlatformAdmin` + `aal2` (fail CI if a route is added without the gate) — the same
auto-discovery approach already guarding the customer API's `/api/*` routers. Rate-limiting, structured
request logging, and per-action metrics are mounted globally, as in `apps/api`.

## 11. Frontend (`apps/admin`)

A new Vue 3 + Vite + Tailwind v4 app that imports the **same** `style.css` token layer and component
patterns as `apps/web`, so it inherits the design language for free. Differences are intentional: a
distinct accent and a permanent "PLATFORM" top bar + org-context banner during impersonation, so an
operator is never confused about which plane or which customer they're acting on. Login → MFA → shell
with the modules from §7 as nav. It talks only to `admin-api`. The service-role key and Stripe secret
never exist in this bundle (frontend holds only the Supabase anon key + the admin-api base URL).

## 12. Backups & disaster recovery

Be precise about what is managed infra vs. what the dashboard orchestrates:

- **Managed baseline (Supabase):** automated daily backups + point-in-time recovery are provided by the
  platform; the dashboard links to and documents them rather than reimplementing them.
- **On-demand logical exports:** the dashboard can trigger a per-org or full logical export
  (`pg_dump`-style or a scripted extract), store the artifact with a checksum, and record it in
  `backup_jobs` with download + verify. Useful for migrations, customer offboarding, and audits.
- **Restore orchestration:** a restore is heavily gated (owner-only + step-up + typed org name
  confirmation) and recorded in `restore_jobs`. A full-cluster PITR restore is an infra operation; the
  dashboard drives the runbook and records it — it does not pretend to one-click a production restore.
- **Data privacy workflows:** per-org data export (portability) and right-to-be-forgotten hard-delete,
  both audited, both step-up. Retention windows on soft-deletes give an undo path before permanence.
- **Rehearsal:** restores are rehearsed against a staging project on a schedule; DR is only real if it
  has been practiced.

## 13. Errors & safe "repairs"

"Repairs that can be done" become a **catalog of named, allowlisted, idempotent operations** — never an
ad-hoc SQL console with write access. Each repair has a description, a required role, a **dry-run** that
reports what *would* change, an explicit confirm, and an audit entry. Launch set:

- Re-run scoring for an org (optionally a date range) — idempotent by construction.
- Rebuild a derived/aggregate table for an org.
- Clear or re-queue a stuck background job.
- Re-sync a Stripe customer (reconcile mirror tables against Stripe).
- Rotate an org's McLeod ingest token (reusing the hashed-token flow).
- Re-send a failed webhook's downstream effect.

Errors feed from the API/admin-api/web error handlers (a thin `platform_error_events` sink, or Sentry
with a table adapter) and are shown grouped by fingerprint with per-org attribution and severity. Job
health surfaces lag and last-success so a silent failure becomes visible before a customer notices. A
**break-glass read-only** SQL view (owner-only, step-up, fully logged) is the escape hatch for the
unforeseen; an arbitrary-write SQL path is intentionally *not* built.

## 14. Enterprise-grade practices baked in (checklist)

- Least-privilege platform RBAC; deny-by-default everywhere; allowlisted operations only.
- Mandatory MFA (AAL2); step-up "sudo" for destructive/sensitive actions; instant DB-based revocation.
- Immutable, exportable audit log of every action; dual-logging into tenant `audit_logs` for transparency.
- Tenant RLS never weakened; cross-org access only via one audited service-role DAL.
- Secrets server-side only (service-role, Stripe) — never in the admin bundle; ingest tokens hashed.
- Time-boxed, reason-required, revocable impersonation.
- Idempotent, dry-runnable repairs; typed confirmations + retention windows for irreversible ops.
- Separate deploy + subdomain; strict CSP/HSTS; no CORS to customer origins; short sessions + IP allowlist.
- Route-auth fitness test proves every admin route is gated; migrations reviewed; PII minimized in logs.
- Observability: structured logs, error tracking, uptime + per-action metrics, alerting on anomalous
  admin activity (e.g. bulk deletes, off-hours access).
- Backups + rehearsed DR; data export/delete workflows for compliance (GDPR/CCPA).

## 15. Phased rollout

- **Phase 0 — Foundations.** Migrations for `platform_admins` + `platform_audit_log`; seed the owner;
  `apps/admin-api` skeleton with the full auth/MFA/RBAC/audit chain; `apps/admin` skeleton (login → MFA →
  empty shell on the shared design system); route-auth fitness test. Deploy behind the subdomain. Nothing
  destructive exists yet. **This phase is the security spine — everything else builds on it.**
- **Phase 1 — Customer oversight (read).** Org list + detail, users, usage, per-org module toggles
  (`org_integrations`), read-only impersonation. Every view audited.
- **Phase 2 — Billing oversight.** Stripe webhook ingestion + mirror tables + dashboard views + the
  controlled override levers (comp/plan/cancel/retry), all step-up + audited. Entitlement status flows
  back to the customer app.
- **Phase 3 — Ops, errors & repairs.** Error feed + job health + the idempotent repair catalog with
  dry-run/confirm.
- **Phase 4 — Backups & data privacy.** On-demand exports, restore orchestration + runbook, export/delete
  workflows.
- **Phase 5 — Hardening.** IP allowlist, session/device management, alerting, and a security review
  (checklist + a pass focused on the cross-tenant DAL) before widening operator access beyond the owner.

## 16. Open questions / future

- Hosting for the two new subdomains (same Railway project vs. separate) and DNS/cert setup.
- Error tracking: adopt Sentry, or keep the lightweight in-DB sink to start?
- Do we want a second platform admin soon, or owner-only through Phase 5? (Affects how early RBAC is exercised.)
- Multi-org membership for customers is still v1-single; if that changes, the access-token hook and a few
  reads evolve — independent of this plane, but worth tracking.
- Notifications channel for platform alerts (email/Slack) — likely folds into the existing scheduled-task
  and notification plumbing.
