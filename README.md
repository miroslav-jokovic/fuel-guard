# FleetGuard

Enterprise fuel-theft-prevention & MPG-monitoring platform for commercial fleets.
Tenant: **Silvicom Inc.**

> Planning & specs live in [`/docs`](./docs/README.md). Build the app phase by phase using the
> Windsurf prompt pack (`docs/04-WINDSURF-PROMPTS.md`), against the v1.1 decisions in
> `docs/06-AUDIT-FINDINGS.md`.

## Stack

TypeScript · Vue 3 + Vite · Tailwind CSS v4 · Node + Express · Supabase (Postgres + Auth + Storage) ·
Railway. pnpm workspaces monorepo.

## Layout

```
apps/web        Vue 3 + Vite SPA (Tailwind v4)
apps/api        Node + Express API (anomaly engine, imports, exports, notifications)
packages/shared TS types, Zod schemas, anomaly rules — the single source of truth
supabase/       migrations + seed (added in Phase 1)
docs/           product, architecture, data model, roadmap, prompts
TemplatesTailwind/  licensed Tailwind UI v4 (Vue) source — build UI from here
```

## Prerequisites

- Node 22+ (`.nvmrc` pins 22)
- pnpm via Corepack: `corepack enable`

## Commands

```bash
pnpm install        # install all workspaces
pnpm dev            # run web + api in parallel
pnpm build          # build all packages (topological: shared → api/web)
pnpm typecheck      # type-check all packages
pnpm test           # run unit tests (Vitest)
pnpm lint           # ESLint (flat config)
pnpm format         # Prettier write
```

Run a single workspace, e.g. the web app:

```bash
pnpm --filter @fleetguard/web dev
pnpm --filter @fleetguard/api dev
```

## Environment

Copy the example env files and fill them in (see `docs/05-SETUP-GUIDE.md`):

- `apps/web/.env`  → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
- `apps/api/.env`  → `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, `PORT`, …

Only `VITE_`-prefixed, non-secret values ever reach the browser bundle.

## Build status

- **Phase 0 — Foundation:** ✅ monorepo, tooling, CI, web+api+shared boot & build.
- **Phase 1 — Database & RLS:** ✅ migrations + seed in `supabase/`, RLS verified (offline matrix).
- **Phase 2 — Auth & tenancy:** ✅ invite-only email/password, Custom Access Token hook, API
  (`/api/invites*`, `/api/me`) with JWT verification, web session store + guards + auth UI + Users
  screen. Verified: 27 unit tests, 15/15 RLS+hook matrix, typecheck/lint/build green.
- **Phase 3 — Fleet management:** ✅ Vehicles & Drivers CRUD + driver assignment, shared Zod
  schemas, Vue Query + Supabase data layer, slide-over forms, role gating, empty/loading/error
  states. Verified: 38 unit tests, typecheck/lint/build green.
- **Phase 4 — Fuel capture:** ✅ mobile-first fill-up form (client UUID, derived $/gal, inline
  odometer/over-capacity warnings with hard-confirm, optional WebP-compressed receipt upload),
  keyset-paginated Fuel Log with filters. Verified: 52 unit tests, typecheck/lint/build green.
- **Phase 4.5 — Fuel-card import:** ✅ XLSX/CSV EFS import (Transaction → fuel_transactions,
  Reject → declined_transactions), product-code filtering, multi-line handling, composite-key dedup,
  Unit→vehicle / Driver→driver reconcile, review-and-commit page. Migration 0007 (4 tables + RLS).
  Verified: 63 unit tests, 18/18 RLS matrix, parsed the real EFS export (149 rows → 73 fuel + 76 skipped).
- **Phase 5 — Anomaly engine:** ✅ all 12 Tier 1–4 rules (pure, gated, precedence, disabledRules) +
  baseline/MPG/off-hours-tz helpers + anomaly reconciliation; API scoring service with re-score
  cascade + backfill; web triggers scoring after fill-up/import. Verified: 86 unit tests (pass+fail
  per rule) and the engine run over the 147 seeded fills fired every seeded anomaly type (11 flagged).
- **Phase 5.5 — AI verification layer:** ✅ Claude layer (migration 0008 `ai_verifications`), shared
  Zod output schema + deterministic haversine/implied-speed + escalation/budget/cache helpers, API
  service (Haiku→Sonnet, kill-switch, budget, cache, geo-facts-in-code) with `POST
  /anomalies/:id/ai-examine` + auto-invoke on scoring, reusable AiAssessmentCard. Verified: 96 unit
  tests, 20/20 RLS matrix, typecheck/lint/build green.
- **Phase 6 — Anomaly workflow:** ✅ review queue (filters + severity sort), anomaly detail
  (evidence, transaction, AI card + re-examine), version-checked status transitions via API
  (open→investigating→resolved/dismissed, required note, 409 on conflict, audited), Settings hub +
  Anomaly Thresholds form. Verified: 102 unit tests, typecheck/lint/build green.
- **Phase 7 — Dashboards & reports:** ✅ exec dashboard (stat cards, MPG/spend/severity charts via
  Chart.js, period selector, top-risk vehicles), vehicle drill-down with MPG history, Reports page +
  API CSV (transactions/anomalies) and PDF summary (pdfkit), all org-scoped + audited. Verified: 110
  unit tests + dashboard aggregation over seed→engine data ($48k spend, 6.59 fleet MPG, 17 open);
  typecheck/lint/build green.
- **Phase 8 — Enterprise hardening:** ✅ DB audit triggers (vehicles/drivers/thresholds) + audit
  viewer, email notifications (provider-agnostic Resend/Brevo, high/critical alerts), API rate
  limiting, org settings (operating hours + notification recipients), Playwright smoke scaffold.
  Migration 0009. Verified: 116 unit tests, 21/21 RLS+audit-trigger matrix, web bundle free of the
  service-role key, typecheck/lint/build green.

- **Phase 8.5 — Detection hardening:** ✅ (docs/09) source-aware time rules (EFS date-only no longer
  poisons off-hours/rapid/jump; daily-mileage cap instead), **cross-source ±5 odometer reconciliation**
  (the driver-accuracy check), new theft detectors (**cumulative-overfuel** for split-fills/container
  theft, **card-multi-vehicle** for card sharing, **expected-odometer-band** for padding), clean-baseline
  exclusion, multi-line-invoice merge, deterministic ordering, wider re-score cascade, idempotent-anomaly
  index. Migration 0010. Verified: 127 unit tests (pass+fail per rule), 22/22 RLS+hardening matrix,
  engine-over-seed still catches every seeded theft type.

**MVP complete (Phases 0–8.5).** Remaining: Phase 9 — deploy to Railway + prod Supabase.

> Note: the new tuning knobs (`odometer_tolerance_miles`, `max_daily_miles`, `cumulative_window_hours`)
> ship with sensible DB defaults; exposing them in the Thresholds settings UI is a small follow-up.
