# Platform plane — audit (2026-08-07)

Written after the driver-app settings page showed HazmatGuard, Messages and Notifications as
"Not in your plan" for Silvicom Inc — the company that owns FuelGuard. Everything below is read off
the code, with file and migration references.

## 1. The finding, stated plainly

**There is no operator/tenant distinction at the organization level.** `organizations` (created in
`0003_core_tables.sql:7-15`, extended by `0009`, `0024`, `0086`, `0087`) has eleven columns and not
one of them says what *kind* of organization a row is. No `is_internal`, no `kind`, no `plan`, no
`tier`. The string `silvicom` appears nowhere in `apps/`, `packages/` or `supabase/` — only in prose.

So Silvicom's organization is a customer row. It is subject to `org_modules` entitlement gating
written for people who pay us, and the dashboard correctly tells the owner of the product to
"Contact FuelGuard" about buying HazmatGuard.

The separation that *does* exist is real and well built — it just lives in a different plane. Platform
identity is `platform_admins` (`0070`), a service-role-only allowlist behind a five-stage middleware
ladder, with `0070:8` stating the principle outright: **"No JWT claim ever encodes platform access."**
That plane knows what an operator is. The tenant plane does not know what an operator's *org* is.

`0139_backfill_modules_existing_orgs.sql` is the current answer, and it is temporal rather than
identity-based: it grants everything to "orgs that exist at the moment this migration runs". Silvicom
would be entitled by accident of timing, not because of what it is. Its own header says as much.

## 2. What is actually built (platform console)

`apps/admin-api` is 1,527 lines across 21 files, 456 of them tests. `apps/admin` is a ~986-line Vue 3
SPA served by it. Quality is high: **zero TODO/FIXME/stub markers anywhere**, every router mounted,
every endpoint the SPA calls exists, and a `routeAuth.test.ts` fitness function that scrapes `app.ts`
and proves each mounted `/admin` prefix rejects unauthenticated, non-allowlisted and aal1 callers.

Built and working:

| Capability | State |
| --- | --- |
| List customers with aggregate stats | Done — `GET /admin/orgs` over the `platform_org_overview` RPC (`0072`) |
| View one customer (audited) | Done — `GET /admin/orgs/:id`, writes `org.view` to `platform_audit_log` |
| **Grant / revoke `org_modules`** | **Done** — `POST /admin/orgs/:id/entitlements/:moduleKey`, upserts with `enabled_by`, audited |
| Integration kill switch | Done — flips `org_integrations.enabled`; never creates rows, never touches credentials |
| List org members | Done, read-only |
| Impersonation | Done — 60-minute, hard-coded `read_only` grants, reason required, dual-audited to the platform log *and* the customer's own `audit_logs` |
| Platform audit log | **Write-only** — six action types are appended; no endpoint and no UI reads it |
| Billing, provisioning, member management, feature flags | **Absent** — six of seven sidebar items render as disabled "· soon" text |

So the fix for the screenshot already exists as a shipped feature. It has simply never been reachable.

## 3. Why it has never been reachable

Three independent blockers, all outside the code:

1. **The console has never been deployed.** Every URL reference in the repository is the placeholder
   `https://admin.<domain>`. `ADMIN-PHASE0-RUNBOOK.md` steps 1, 2, 4, 5, 6 and 7 are still written as
   pending owner actions. `.github/workflows/` contains **zero** references to admin — no build, no
   deploy verification, no `/api/version` equivalent.
2. **The only platform admin is somebody else.** `0070:42-44` seeds exactly one row:
   `developmentteam@uncdevelopment.com`. Miki signs in as `miki@silvicominc.com`, which is not on the
   allowlist — and there is **no endpoint to add a platform admin**. Operator #2 requires manual SQL.
3. **Migrations are not reaching Supabase at all.** `GET /api/version` reports
   `schema.applied: null` — `applied_schema_version()` (0140) is absent, and the org_modules evidence
   says 0139 never ran either. The ledger stalled somewhere in 0134–0138, which also means `0135` and
   `0136` — two real driver-scope security closures — are very likely not live.

## 4. Security findings worth acting on

**F1 — the module gate exists at only one of two layers, for only one of six modules.**
`0103_hazmat_module_rls.sql` is a remarkable document: it records that `auth_module_enabled()` was
defined in `0088` and *"then never called by a single policy anywhere in the schema"*, with measured
evidence that a `fleet_manager` with the entitlement revoked still read rows and completed an INSERT.
`0103` fixed that — **for `hazmatguard` only**. There is no `_module_gate` RESTRICTIVE policy for
`dispatch`, `messages`, `notifications`, `training` or `navigation`. Those five are protected solely
by `requireModule` middleware in `apps/api`. That matters because the tenant dashboard talks to
PostgREST directly with the user's JWT (`apps/web/src/composables/useModules.ts:18` is one example),
so any table reachable that way is reachable without passing through Express at all.

**F2 — `requireStepUp` and `ip_allowlist` are wired to nothing.** `platformAuth.ts:85` implements a
five-minute re-authentication window against `platform_admins.last_reauth_at`; no route mounts it, and
**nothing in the codebase ever writes `last_reauth_at`**, so mounting it today would reject every
request. `platform_admins.ip_allowlist inet[]` (`0070:26`) is read by nothing. Security controls that
exist as schema but not as behaviour are worse than absent ones — they read as protection in review.

**F3 — the audit log cannot be read.** `platform_audit_log` (`0071`) is genuinely well built: append
only, with triggers that block UPDATE, DELETE and TRUNCATE even for the table owner. Nothing selects
from it. An operator plane whose audit trail has no reader is half a control.

**F4 — entitlement changes are invisible to the customer.** `CustomerDetailPage.vue:181` promises
"recorded in the platform log **and the customer's audit trail**". Only impersonation writes the
tenant mirror (`orgs.ts:193`); entitlement grant/revoke writes the platform log alone. A customer
whose plan changed cannot see who changed it.

**F5 — the newest write path has no test.** `POST /admin/orgs/:id/entitlements/:moduleKey` and
`setOrgEntitlement` — the exact mechanism that fixes the screenshot — have zero coverage, while every
older route is tested. `lookupPlatformAdmin`'s email→user_id linking and its `status !== 'active'`
rejection are also untested (both suites inject the lookup wholesale).

## 5. The design question, and the answer

The tempting fix is a bypass: mark Silvicom's org internal and have `resolveFeatures` treat internal
orgs as entitled to everything.

**That is the wrong answer, and it should be rejected explicitly.** `resolveFeatures`
(`featureCatalog.ts:192-215`) is the single place where released × entitled × org-enabled × override
is computed, and it is the most security-sensitive pure function in the product. Adding an org-class
branch there does two bad things: it puts a second path through the hot security code, and — worse —
it means the org we develop and test against **stops exercising the entitlement path at all**. We
would lose the ability to see what a customer without HazmatGuard sees, in the one environment where
we would notice.

The right answer is that org class governs **provisioning**, not **resolution**. An internal org gets
real `org_modules` rows for everything released, granted through the same audited console action a
customer's grant goes through. Every gate then runs for real, for us, exactly as it does for a
customer — and we can revoke a module from ourselves for an afternoon to check what that looks like.

## 6. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D-P1 | `organizations` gains a `kind` column: `customer` / `internal` / `demo`. Default `customer`. | The missing concept, added once, in the place it belongs. Demo is included now because a sales-demo org has the same "entitled to everything, owned by us" shape and will otherwise be solved twice. |
| D-P2 | Org class drives **provisioning**, never **resolution**. `resolveFeatures` is not touched. | See §5. One path through the security-critical resolver; we keep dogfooding the customer experience. |
| D-P3 | `seed_default_org_modules()` becomes class-aware: `internal` and `demo` orgs are seeded every **released** module; `customer` orgs keep `dispatch` + `navigation`. | The trigger already exists and already runs on insert. Making it read one column is smaller than any alternative and needs no application change. |
| D-P4 | `0139` is superseded by a class-based backfill and should not ship as written. | It grants everything to "orgs existing at run time". Run after a real second customer is onboarded, it silently gifts them HazmatGuard, Messages and Notifications — precisely the outcome its own header says it exists to avoid. |
| D-P5 | The console gains "Grant all released modules" on the customer detail page, audited like any single grant. | Makes the internal-org case a one-click, logged action rather than a migration, and is equally useful for a customer who buys the full suite. |
| D-P6 | Platform admins are managed **in the console**, not in SQL. The `0070` seed row stays as the bootstrap and nothing else. | "Add an operator" is a routine act. Routine acts done by hand-written SQL against production are how mistakes reach customer data. |
| D-P7 | Every module gets a RESTRICTIVE `_module_gate` RLS policy, matching what `0103` did for hazmat. | The dashboard talks to PostgREST directly. Middleware-only gating protects the routes we remembered to gate, not the data. |
| D-P8 | `requireStepUp` is either mounted with a real `last_reauth_at` write path, or deleted. `ip_allowlist` likewise. | A control that cannot fire is not a control. Whichever way it goes, the repository should stop implying otherwise. |
| D-P9 | Silvicom holds **both** identities: an organization it uses as a fleet, and `platform_admins` rows its staff operate with. Never conflated. | Dogfooding requires being a real tenant. Operating requires being outside every tenant. The two are separate credentials with separate audit trails, and that is correct. |

## 7. Plan

### P0 — Unblock, today (no schema change)

1. Get migrations flowing again: re-run **Apply Supabase migrations**, confirm its three secrets, and
   read `supabase migration list --linked`. Nothing below can land until this works. Verify with
   `pnpm verify:live` — `schema.state` must read `current`.
2. Add `miki@silvicominc.com` to `platform_admins` as `platform_owner`, and enrol TOTP. This is the
   one hand-written row we are entitled to; D-P6 makes it the last.
3. Deploy the admin console (`railway.admin.json`) as its own Railway service, with `ALLOWED_ORIGINS`
   and the Vite build vars set. Follow `docs/plans/ADMIN-PHASE0-RUNBOOK.md`.
4. Grant Silvicom HazmatGuard, Messages, Notifications and Training **through the console**. The
   screenshot resolves, the grant is audited with a named actor, and we have proven the mechanism.
5. Remove `0139` from the migration set, per D-P4.

### P1 — Org classification (the actual fix)

- Migration: `organizations.kind` with a CHECK, default `customer`, plus a backfill setting Silvicom's
  org to `internal` by id (a one-time data statement, not a rule).
- Rewrite `seed_default_org_modules()` per D-P3 — class-aware, still `on conflict do nothing`.
- Class-based backfill replacing `0139`: grant every released module to `kind in ('internal','demo')`.
- Surface `kind` in the console customer list and detail (a badge, and internal orgs sorted apart),
  and in `platform_org_overview`.
- Tests: the resolver is unchanged and its tests must stay green untouched — that is the proof D-P2
  held. New tests cover the trigger's three branches.

### P2 — Close the module-gate gap (F1)

- One migration adding `<table>_module_gate` RESTRICTIVE policies for `dispatch`, `messages`,
  `notifications` over their tables, modelled exactly on `0103`.
- Extend `supabase/tests/rls.test.mjs` with the assertion `0103` was written after: with the
  entitlement revoked, a `fleet_manager` JWT reads zero rows and every write fails. Assert it for all
  four gated modules, so the next module cannot ship without one.
- Decide and document what background workers do — `0103:28-30` already flags that service-role queue
  handlers bypass this and must check `org_module_enabled()` themselves.

### P3 — Platform admin management (D-P6, F2)

- `GET/POST/PATCH /admin/platform-admins` — list, invite, suspend, change role. `platform_owner` only,
  self-demotion and self-suspension refused, every action audited.
- A console page for it, showing role, status, MFA enrolment and last activity.
- Resolve `requireStepUp`: mount it on this router and on entitlement writes, with a re-auth endpoint
  that stamps `last_reauth_at` — or delete it and the `ip_allowlist` column. Recommendation: mount it,
  because "change who can operate the platform" is exactly the action a sudo window is for.

### P4 — Make the audit trail useful (F3, F4)

- `GET /admin/audit` with filters (actor, org, action, date) and pagination, plus a console page.
- Mirror entitlement grant/revoke into the tenant's `audit_logs` the way impersonation already is, so
  a customer can see that their plan changed and who changed it. This also makes
  `CustomerDetailPage.vue:181` true.

### P5 — Provisioning

- Create an organization from the console: name, `kind`, allowed domains, first admin invite. Today
  onboarding customer #2 is manual SQL against production.
- Suspend / reactivate an org, and edit `allowed_domains`, which the detail page renders read-only.

### P6 — Operational parity for admin-api

- `GET /admin/version` mirroring the tenant API's endpoint, with the same schema-drift reporting.
- Extend `.github/workflows/deploy-verify.yml` to poll the admin service too — it is currently invisible
  to CI in every respect.
- Tests for the entitlement write path and `lookupPlatformAdmin` (F5). Import `MODULE_LABELS` from
  `@fuelguard/shared` in `CustomerDetailPage.vue` instead of the local duplicate at `:80-87`.
- Retire the "Phase 0 shell" copy on the dashboard, and either build or remove the six inert nav items.

## 8. What this does not change

`resolveFeatures` and the three-layer control plane stay exactly as they are — that design is sound and
this plan's central decision is to leave it alone. The `platform_admins` allowlist, the no-claims rule,
the append-only audit table and the read-only impersonation lifecycle likewise. The problem was never
the platform plane's design; it was that the tenant plane has no idea the platform plane exists, and
that the console built to bridge them has never been switched on.

## 9. Open questions

1. Should `demo` orgs expire automatically? A sales demo that lives forever becomes a support burden.
2. Does an internal org's data belong in the same Supabase project as customer data? It does today, and
   `0139`'s existence suggests nobody has decided this deliberately.
3. When a module is released later, should `internal` orgs be granted it automatically, or should that
   remain a console action? Automatic is convenient and quietly changes entitlements without an actor.
