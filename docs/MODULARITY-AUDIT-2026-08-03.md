# D56 Modularity Audit — can `hazmatguard` be switched off for one org?

**Date:** 2026-08-03 · **Method:** live Postgres + full static audit · **Verdict:** **conditional pass**

> **D56:** *"A module is not done until it can be switched off for one org without breaking any other surface."*

---

## 0. Executive answer

**The failure mode you were worried about does not exist.** Turning HazmatGuard off breaks **no** non-hazmat surface — not the dashboard, not dispatch, not fuel planning, not the driver app. The modularity is real, and it is enforced by fitness functions in CI.

**But the module cannot yet be switched off *safely*.** Three things are wrong, and all three are inside the hazmat blast radius rather than outside it:

| | Finding | Impact |
|---|---|---|
| **B1** | **RLS layer does not exist.** `auth_module_enabled()` was defined in `0088` and is **never called by a single policy**. A revoked tenant can still read *and write* hazmat data straight through PostgREST. | Security |
| **B2** | Every hazmat **web route is reachable** with the module off. `HazmatPage.vue` renders a complete, convincing product hub with zero network calls — so no error ever appears. | Commercial |
| **B3** | A background **extraction job fires a push notification** ("Hazmat load needs review") to a de-entitled org, deep-linking to a route the nav hides and the API 403s. | Both |

Plus a fourth that makes the whole test hard to even run: **there is no way to toggle `hazmatguard` for a tenant.** The admin control plane's module toggle writes `org_integrations`, not `org_modules`. Today the only path is hand-written SQL against production.

**B1 is fixed and verified in this session** — see §4. The rest are scoped in §5.

---

## 1. Method

Two independent passes, both against commit `097adef` + this session's `0097–0102`:

**Live database.** A Postgres 16 with **all 102 migrations replayed from scratch** (0 failures). Queries run as `rls_probe` — a role that is **not** superuser and **not** `BYPASSRLS`, i.e. it behaves like Supabase's `authenticated` — with a real JWT claims payload injected via `set local request.jwt.claims`:

```json
{ "sub": "aaaa…0001", "org_id": "cccc…0001", "user_role": "fleet_manager", "email": "fm@acme.com" }
```

**Static audit.** Two parallel code surveys — one over `apps/api` + `supabase/migrations` + queue handlers, one over `apps/web` + `apps/driver` — every claim below carries a `file:line`.

---

## 2. The measurement that matters

The org buys HazmatGuard, then loses it. `0088` promises: *"a disabled module's own tables return ZERO rows, even to a raw PostgREST call … Layer 1 is the boundary (D10)."*

```
############ MODULE ON
   auth_module_enabled('hazmatguard') = true
   hazmat_loads    rows visible = 1
   hazmat_policies rows visible = 1

############ MODULE OFF  (enabled = false)
   auth_module_enabled('hazmatguard') = false      ← the helper is correct
   hazmat_loads    rows visible = 1                ← but nothing consults it
   hazmat_policies rows visible = 1

############ MODULE ROW DELETED  (absent = disabled)
   auth_module_enabled('hazmatguard') = false
   hazmat_loads    rows visible = 1
   hazmat_policies rows visible = 1

############ WRITE, entitlement absent
   insert into hazmat_loads … → INSERT 0 1         ← a revoked tenant can still create hazmat data
```

The helper function works perfectly. **No policy has ever called it.** Confirmed by grep across all 102 migrations: the only occurrences of `auth_module_enabled` are its own definition in `0088` and the prose describing what it was supposed to do.

Every hazmat policy keys on `org_id` / `auth_role()` alone:

```
hazmat_loads    | hazmat_loads_select   | (org_id = auth_org_id())
hazmat_policies | hazmat_policies_select| (org_id = auth_org_id())
hazmat_runs     | hazmat_runs_select    | (org_id = auth_org_id())
…
```

**Why this is a live path, not a theoretical one:** the web app already talks to PostgREST directly with the user's JWT — `apps/web/src/composables/useModules.ts:18` reads `org_modules` that way, and `apps/web/src/features/hazmat/useHazmatProfiles.ts:43` reads `trailers` that way. Only the Express 403 stands between a revoked tenant and their hazmat data, and anything holding the Supabase anon key steps around Express entirely.

---

## 3. Full findings

### Layer 2 (API) — complete ✅

`apps/api/src/routes/hazmat/index.ts:55` applies the gate router-wide:

```ts
router.use(requireAuth, requireOrg, requireModule("hazmatguard"));
```

All **23** hazmat routes are covered. `requireModule` fails closed on absent rows, `null`, and RPC error (`middleware/requireModule.ts:29-41`). Background workers re-check independently (`services/hazmatAnalysis.ts:142`, `services/hazmatExtraction/orchestrate.ts:70`). The unconditional mount at `app.ts:122` is *correct* — a conditional mount would give 404s and be per-process, when the decision must be per-org and per-request.

### Layer 1 (RLS) — did not exist ❌ → **fixed in `0103`**

`0092_hazmat_core.sql:151-240` + the storage policy at `:252-267`. See §2 and §4.

### Layer 3 (UI) — half built ⚠️

**Nav is correctly gated.** All five hazmat entries check `moduleEnabled(modules, "hazmatguard")` (`apps/web/src/lib/nav.ts:109-113`), and empty groups are dropped (`:136-137`), so the Safety section survives with its three non-hazmat items. The review-count badge query is `enabled`-gated so it never fires a 403 (`layouts/AppShell.vue:28-31`).

**The router is not gated at all.** There is no `requiresModule` meta key anywhere in the app; `router/index.ts:305-326` never touches the module set. All seven hazmat routes (`:71-112`) load from a typed URL, a bookmark, or the back button.

**The worst surface is `pages/HazmatPage.vue:1-63`** — static markup, zero data fetching, four cards with four working buttons. A prospect who churned sees a fully-rendered HazmatGuard hub with no error anywhere. That is not a broken screen; it is a *commercially misleading* one, which is worse.

The data-backed pages degrade to a red `text-danger-600` error whose copy is accidentally correct (the API's `moduleUnavailableMessage` bubbles through), but reads as a system fault rather than a plan boundary. `HazmatEquipmentPage.vue:33` is worse still: it never destructures `isError`, so it shows an empty list with **no message at all**, while the equipment dropdown populates from a direct Supabase read — the form looks usable until submit.

### Cross-contamination — clean ✅ (your key question)

**No non-hazmat surface reads a hazmat table or imports `@hazmat/engine` / `@hazmat/data`.** Verified across the whole import graph.

The only cross-feature import in web is the review-count badge in `AppShell.vue:16`, and it is `enabled`-gated. Every other apparent hit is a false positive worth naming so nobody re-flags them:

- `loads.hazmat` is a **boolean column on the dispatch `loads` table** (`0085_driver_loads.sql:40`) — dispatch-module data, no coupling to HazmatGuard. It drives the filter on `DispatchLoadsPage.vue`, the pill on `LoadDetailPanel.vue:121`, the badge on the driver's `LoadCard.tsx:77`.
- `HazmatClass` in `routes/fueling/plans.ts:20` and `services/fuelPlanning.ts:34` is a **HERE routing restriction** (ADR classes), not `@hazmat/*`.

**Turning `hazmatguard` off leaves every dispatch, fuel, dashboard and driver screen fully intact.** That is the D56 question, and the answer is yes.

### Background jobs — leaks ⚠️

`services/queue/handlers/hazmat.ts:14-32` — neither `hazmat_extract` nor `hazmat_analyze` checks entitlement in the handler. The executors below them re-check, correctly skip the model spend… **and then write anyway**:

- `hazmatAnalysis.ts:145-147` inserts a `hazmat_runs` row with verdict `{aborted:"entitlement_revoked"}` and transitions the load to `analysis_flagged`.
- `orchestrate.ts:71` → `finish()` does the same **plus** calls `notifyReviewersOfFlag` at `:65`, because `isGreen(["entitlement_revoked"])` is `false`.

So a revoked org's admins get an Expo push — *"Hazmat load needs review"* — deep-linking to `/hazmat`. This is precisely the "breaks another surface" case D56 forbids, and it is the one finding that reaches a real human.

These run under the service role, which has `BYPASSRLS` — so `0103` does **not** close this. It has to be fixed in the handler.

### Notifications — module-blind ⚠️

`0089_notifications.sql:177` gates on the **`notifications`** module. `0093_hazmat_notifications.sql:8-13` only widens the category constraint to admit `hazmat_review` / `hazmat_cleared` / `hazmat_rejected` — it adds no module linkage. A hazmat notification is suppressed iff *notifications* is off, never because *HazmatGuard* is off. The comments at `services/notify.ts:5-11` claim otherwise.

### Control plane — the toggle writes the wrong table ⚠️

`0088:82-84` deliberately grants no tenant write on `org_modules`, and the backfill at `:89-93` seeds only `dispatch` and `navigation` — **`hazmatguard` is off for every org, existing and new**. The admin console's module toggle (`apps/admin-api/src/routes/orgs.ts:74-108`) writes **`org_integrations`** (`targetEntity: "org_integrations"` at `:100`). Repo-wide, the only writes to `org_modules` are inside migration 0088 itself.

Net: `/api/hazmat/*` currently 403s for 100% of orgs, and D56 can only be exercised by hand-written production SQL.

### Test coverage — none ⚠️

No test references `requireModule` or `module_disabled`. `routeAuth.test.ts` asserts only 401-for-unauthenticated. **Deleting line 55 of the hazmat router breaks nothing in CI.**

---

## 4. The fix for B1, written and verified: `0103_hazmat_module_rls.sql`

One RESTRICTIVE policy per hazmat table. RESTRICTIVE **AND-combines** with the existing PERMISSIVE policies rather than replacing them, so every org/role rule from `0092` keeps working untouched and this adds exactly one condition — the tenant must own the module. Same shape `0083` uses to narrow drivers to their own rows.

```sql
create policy <table>_module_gate on <table> as restrictive for all
  using      (auth_module_enabled('hazmatguard'))
  with check (auth_module_enabled('hazmatguard'));
```

Applied to `hazmat_loads`, `hazmat_runs`, `hazmat_documents`, `hazmat_reviews`, `hazmat_policies`, `hazmat_cargo_tank_profiles`.

**Measured after applying it:**

```
############ AFTER FIX — module ABSENT
   auth_module_enabled('hazmatguard') = false
   hazmat_loads    rows visible = 0          ← was 1
   hazmat_policies rows visible = 0          ← was 1
   write attempt → ERROR: new row violates row-level security policy
                          "hazmat_loads_module_gate"

############ AFTER FIX — module RE-ENABLED (tenant renews)
   hazmat_loads    rows visible = 2          ← data was never destroyed, just hidden
   write attempt → INSERT 0 1

############ REGRESSION — tenant's other surfaces, hazmat revoked
   drivers visible  = 1                      ← intact
   vehicles visible = 1                      ← intact

############ Fresh replay 0001-0103: 0 failures.  Re-applied twice: clean.
```

Note the re-enable case: revocation **hides** data, it does not destroy it. A tenant who lapses and renews gets their loads back. That is the right commercial behaviour and it falls out of doing this in RLS rather than with deletes.

---

## 5. Remaining work, ordered

| | Item | Where | Effort |
|---|---|---|---|
| 1 | ~~RLS module gate~~ | `0103` | **done, verified** |
| 2 | Suppress the notify on entitlement-revoked | `hazmatExtraction/orchestrate.ts:71` — return before `finish()`, matching the manual path at `hazmatAnalysis.ts:147` | 1 line |
| 3 | Handler pre-check | `queue/handlers/hazmat.ts:15,26` — `org_module_enabled(job.org_id,'hazmatguard')` → `{skipped:"module_disabled"}` | ~10 lines |
| 4 | **Entitlement write path** | new `POST /admin/orgs/:id/entitlements/:key` in `apps/admin-api`, writing `org_modules` + platform audit. Without this D56 can't be exercised at all, and you cannot sell the module. | ~half a day |
| 5 | Router module guard | `requiresModule` meta on the 7 routes + prime the module set in `session.init()` so `beforeEach` can await it. **Closes 6 of the 7 web gaps at once.** | ~half a day |
| 6 | Entitlement fitness test | extend `routeAuth.test.ts`: any router whose source contains `requireModule(` must 403 `module_disabled` for an entitled-less principal. Matches the existing fitness-function style. | ~2 hours |
| 7 | Category → module map in `notification_allowed` | `hazmat_* ⇒ hazmatguard`, `message_received ⇒ messages` | ~1 hour |
| 8 | `me.ts:83` doesn't return `modules` | contract promises it (`driverContract.ts:27-32`), `.default([])` hides the omission — the first driver feature to gate on entitlements will silently see everything disabled | ~1 hour |
| 9 | Cosmetic: driver `more.tsx:54-59` advertises HazmatGuard ungated; `SettingsUsersPage.vue:138` labels a section for orgs without it | | ~1 hour |

**Roughly two days of work** to make HazmatGuard genuinely switchable, saleable, and regression-proof.

---

## 6. What this means for the split decision

The audit was proposed as a test of one hypothesis: *is the modularity real, or is it a story the docs tell?*

**It is real.** Zero cross-contamination, enforced by fitness functions. `@hazmat/engine` and `@hazmat/data` are dependency-free and the build fails if anyone breaks that. The API gate is complete and fails closed. What is missing is not architecture — it is **two days of finishing work on a gate that was 60% built**.

A repo split does not deliver any of those two days for free. It re-poses every one of them in a new codebase, on top of rebuilding auth, orgs, roles, RLS, master data, notifications, queue, audit and the driver shell — the ~15–20k LOC quantified in the strategy doc.

The honest read: **HazmatGuard is already a separable product inside a modular monolith. It is roughly two days from being a *sellable* one.** That is the cheapest path to the commercial outcome you want, and it is available now.

---

## Appendix — reproducing the live test

```bash
# any Postgres 16; supabase-specific stubs (auth.users, storage.*) in the preamble
createdb fg && psql -f /tmp/preamble.sql fg
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f" fg; done

# a role that behaves like Supabase `authenticated`: NOT superuser, NOT bypassrls
psql fg -c "create role rls_probe nologin;
            grant usage on schema public to rls_probe;
            grant select, insert, update, delete on all tables in schema public to rls_probe;"

# then, inside one transaction:
#   set local role rls_probe;
#   set local request.jwt.claims = '{"sub":…,"org_id":…,"user_role":"fleet_manager"}';
#   select count(*) from hazmat_loads;
# toggle org_modules.enabled between runs.
```

The `BYPASSRLS` detail is the one that matters: run the probe as superuser and everything passes, because RLS is skipped entirely. That is almost certainly why this gap survived review.
