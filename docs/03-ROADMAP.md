# FleetGuard — Build Roadmap

> Phased, dependency-ordered plan. Each phase maps to a numbered prompt block in `04-WINDSURF-PROMPTS.md`.
> Principle: every phase ends in something **runnable and demoable**, not a half-built layer.

---

## Phase map

| Phase | Goal | Depends on | Demoable outcome |
|-------|------|-----------|------------------|
| **0. Foundation** | Monorepo, tooling, shared package, empty apps boot | — | `web` and `api` start locally; lint/test/CI green. |
| **1. Database & RLS** | Supabase schema, RLS, seed data | 0 | DB migrated + seeded; RLS verified from client. |
| **2. Auth & tenancy** | Invite-only OAuth2 login, domain restriction, roles, app shell | 0,1 | Invited @silvicominc.com user logs in, lands on app shell with role-aware nav. |
| **3. Fleet management** | Vehicles & drivers CRUD + assignment | 2 | Manager manages vehicles/drivers in polished UI. |
| **4. Fuel capture** | Fill-up entry (mobile-friendly) + inline validation + receipt upload | 3 | Driver logs a fill-up in <30s; photo stored. |
| **4.5 CSV import** | Fuel-card CSV ingestion: staging → reconcile → commit | 3,4 | Manager imports an EFS/Corpay CSV; rows dedupe & attribute. |
| **5. Anomaly engine** | Shared rule set + API scoring + anomalies persisted | 1,4,4.5 | Logging/importing a bad fill-up creates explained anomalies. |
| **5.5 AI verification** | Claude layer: location plausibility + risk summary (flag-gated) | 5 | Flagged txns get an explainable AI risk assessment. |
| **6. Anomaly workflow** | Review queue + investigation states + thresholds config | 5 | Manager triages queue: open→investigating→resolved/dismissed. |
| **7. Dashboards & reports** | Exec dashboard, drill-downs, CSV/PDF export | 5,6 | Live KPIs, MPG trends, exportable reports. |
| **8. Enterprise hardening** | Audit log, notifications, rate limiting, settings, a11y/perf | 2–7 | Critical anomaly emails sent; actions audited; settings live. |
| **9. Deploy** | Railway (web+api) + prod Supabase + smoke tests | all | Live URL, invited user works end-to-end in prod. |
| **10. EFS auto-feed** *(post-launch)* | Credential store + scheduled poller into the same pipeline | 4.5,9 | Transactions sync automatically; exceptions routed to review. |

---

## Detail per phase

### Phase 0 — Foundation
pnpm workspaces; `apps/web` (Vue3+Vite+TS+Tailwind v4+Router+Pinia+Vue Query+VeeValidate/Zod), `apps/api` (Express+TS), `packages/shared` (types, Zod, rule stubs). ESLint/Prettier/Husky, Vitest, GitHub Actions CI. Wire Tailwind v4 + import a template app-shell so the dev server shows something real.

### Phase 1 — Database & RLS
Author `supabase/migrations` from `02-DATA-MODEL.md`: enums, tables, `updated_at` triggers, helper functions, **RLS on every table**, indexes. `seed.sql` with Silvicom org + sample fleet + seeded anomalies. Verify isolation by querying as a member vs. outsider through the Supabase client.

### Phase 2 — Auth & tenancy
Supabase Auth; invite flow via `api/invites` (service role): create invite (domain-checked) → email → user sets password → trigger creates membership. Custom Access Token hook injects `org_id`+`role`. Frontend: AuthLayout (login/set-password/accept-invite), session Pinia store, route guards, role-aware AppShell built from `application-shells/sidebar`.

### Phase 3 — Fleet management
Vehicles list (data-table template) + create/edit drawer (forms template) with Zod validation; same for Drivers; driver↔vehicle assignment. Manager/admin write, others read (enforced by RLS + UI gating).

### Phase 4 — Fuel capture
Mobile-first fill-up form: vehicle picker, odometer, gallons, price/total (auto-calc the third), location, receipt photo → Supabase Storage. **Inline validation** at entry (warn on odometer below last reading, gallons over tank capacity) before submit. Fuel log list with filters.

### Phase 4.5 — CSV import (fuel cards)
New tables `fuel_cards`, `imports`, `import_rows` + `fuel_transactions.external_ref/import_id`
(`08-EFS-INTEGRATION.md`). Mapping-driven CSV importer: upload → parse to staging → validate →
dedup on `external_ref` → reconcile card→vehicle/driver → review screen → commit (scored in
`fueled_at` order). Idempotent: re-uploading the same file is a no-op. Writes `import.run` audit.

### Phase 5 — Anomaly engine
Implement all Tier 1–4 rules as pure functions in `packages/shared` per the **precise definitions in
`02 §10.7–10.8`** (previousTxn, guards, fuel-type gating, cascade, precedence); unit-test each with
pass+fail fixtures. `api POST /transactions/:id/score` computes `miles_since_last`, `computed_mpg`,
runs rules, writes `anomalies`, updates txn `has_anomaly`/`max_severity`. Re-score the changed txn
**and the next in time order**, serialized per vehicle. Backfill script scores seed data.

### Phase 5.5 — AI verification layer (flag-gated)
Per `07-AI-VERIFICATION.md`: `ai_verifications` table, shared Zod in/out schemas, deterministic
geo-distance util, `aiVerification` service (Haiku→Sonnet escalation, caching, token budget,
kill-switch). Selective triggers (severity ≥ medium). UI: AI assessment card + queue AI-sort +
"re-examine". Fully optional — core works with the flag off.

### Phase 6 — Anomaly workflow
Anomaly queue (filter by severity/status/vehicle/rule), detail view showing evidence + the offending fill-up, state transitions with notes, assignment. Thresholds settings page writing `anomaly_thresholds`.

### Phase 7 — Dashboards & reports
Exec dashboard (stat cards + charts): total spend, gallons, fleet MPG trend, open anomalies by severity, top vehicles/drivers by risk. Per-vehicle & per-driver drill-down with MPG history. CSV + PDF export via API.

### Phase 8 — Enterprise hardening
`audit_logs` writes on the full action list (`02 §10.6`); admin/auditor audit viewer. Email
notifications (SMTP/Resend) for high/critical anomalies + digest. **API rate limiting**
(`express-rate-limit`). Settings: org profile, operating hours, notifications, AI flags/budget.
**Soft-delete** for vehicles/drivers (retire, never hard-delete with history — audit H5).
Accessibility + performance pass (RLS `EXPLAIN ANALYZE`, indexes, lazy routes, keyset pagination).

### Phase 9 — Deploy
Railway: `web` (static+Caddy) and `api` (Node) services, reference vars for cross-service URLs, prod env. Dedicated prod Supabase project; run migrations + minimal seed (org only). Playwright smoke test against prod URL. Invite the first real admin.

### Phase 10 — EFS auto-feed *(post-launch)*
Per `08 §6`: `integration_credentials` (encrypted feed user/secret), a scheduled poller that pulls
EFS transactions on the provider cadence into the **same** parse→stage→reconcile→commit→score
pipeline (`source='efs_feed'`). Clean rows auto-commit; exceptions route to the Phase-4.5 review
screen. **No core schema change** — only source + credentials + scheduler are new.

---

## Sequencing notes for Windsurf

- Build **one phase per working session**; don't let Windsurf jump ahead — each prompt block assumes the prior phase is merged and green.
- After each phase: run `pnpm lint && pnpm test`, then a manual smoke check of the demoable outcome before moving on.
- Keep `packages/shared` the single source of types & rules; never duplicate a Zod schema in an app.
- Phases 5–8 are where "enterprise grade" is earned — do not skip the audit log, the explainable evidence, or the threshold config.
