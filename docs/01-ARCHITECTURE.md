# FleetGuard — Architecture

> How the system is put together. Read alongside `02-DATA-MODEL.md`.

---

## 1. Stack (locked)

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | **TypeScript** (strict) | Frontend + backend. |
| Frontend | **Vue 3** (`<script setup>`) + **Vite** | Composition API. |
| Styling | **Tailwind CSS v4** | Matches the licensed templates. |
| UI components | **Tailwind UI v4 (Vue)** + **Headless UI** + **Heroicons** | Source in `/TemplatesTailwind`. Don't reinvent components. |
| Routing | **Vue Router** | |
| State / data | **Pinia** + **TanStack Query (Vue Query)** | Pinia for app/session state, Vue Query for server data caching. |
| Forms / validation | **Zod** (shared schemas) + **VeeValidate** | Zod schemas shared between front and back. |
| Backend | **Node.js** + **Express** (TypeScript) | Thin API for business logic the DB shouldn't own (anomaly scoring, imports, notifications, exports). |
| Database / Auth | **Supabase** (Postgres + Auth + Storage) | Free tier. RLS for tenant isolation. Storage for receipt photos. |
| Hosting | **Railway** | Two services (web + api) in one monorepo. |

> **Why a Node backend at all if Supabase exists?** Most CRUD goes straight from the Vue app to Supabase (protected by RLS). The Express API exists for the things that should not live in the browser or in SQL: the **anomaly scoring engine**, **fuel-card/CSV imports**, **email notifications**, **PDF/CSV report generation**, and any action needing the Supabase **service role** key. This keeps the secret server-side and the logic testable.

---

## 2. System topology

```
                        ┌─────────────────────────────┐
                        │           Railway            │
                        │                              │
  Browser ──HTTPS──►    │  ┌───────────────────────┐   │
  (Vue SPA)             │  │  web  (static + Caddy) │   │  VITE_API_URL, VITE_SUPABASE_URL,
                        │  └───────────┬───────────┘   │  VITE_SUPABASE_ANON_KEY
                        │              │ /api/*         │
                        │  ┌───────────▼───────────┐   │
                        │  │  api  (Node/Express)   │   │  SUPABASE_SERVICE_ROLE_KEY,
                        │  │  - anomaly engine      │   │  SUPABASE_URL, SMTP creds,
                        │  │  - imports / exports   │   │  ALLOWED_ORIGINS
                        │  │  - notifications       │   │
                        │  └───────────┬───────────┘   │
                        └──────────────┼───────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────┐
                        │          Supabase            │
                        │  Postgres (RLS) · Auth ·     │
                        │  Storage (receipt photos)    │
                        └─────────────────────────────┘
```

**Two data paths, on purpose:**
1. **Direct path** — Vue app → Supabase client (anon key + user JWT). Used for reads and simple CRUD. RLS guarantees a user only ever sees their org's rows.
2. **Server path** — Vue app → Express API → Supabase (service role). Used for privileged/complex operations (scoring, imports, notifications, exports, invites).

---

## 3. Monorepo structure

```
fleetguard/
├─ apps/
│  ├─ web/                    # Vue 3 + Vite SPA
│  │  ├─ src/
│  │  │  ├─ components/       # built FROM /TemplatesTailwind
│  │  │  ├─ layouts/          # AppShell (sidebar), AuthLayout
│  │  │  ├─ pages/            # Dashboard, Vehicles, Drivers, FuelLog, Anomalies, Reports, Settings
│  │  │  ├─ features/         # feature modules (anomalies/, fuel/, fleet/…)
│  │  │  ├─ lib/              # supabase client, api client, formatters
│  │  │  ├─ stores/           # Pinia stores (session, org)
│  │  │  ├─ router/
│  │  │  └─ main.ts
│  │  └─ vite.config.ts
│  └─ api/                    # Node + Express + TS
│     ├─ src/
│     │  ├─ routes/           # /anomalies, /imports, /reports, /invites, /notifications
│     │  ├─ services/         # anomalyEngine/, importService, reportService, mailer
│     │  ├─ lib/              # supabaseAdmin (service role), auth middleware
│     │  └─ index.ts
│     └─ package.json
├─ packages/
│  └─ shared/                 # shared TS: Zod schemas, types, anomaly rule definitions, constants
├─ supabase/
│  ├─ migrations/             # SQL migrations (schema + RLS + indexes)
│  └─ seed.sql                # demo org, vehicles, drivers, sample fill-ups
├─ docs/                      # these planning docs
├─ TemplatesTailwind/         # licensed Tailwind UI v4 source (already present)
├─ package.json               # workspaces root (pnpm)
└─ railway.json / nixpacks    # per-service deploy config
```

> Use **pnpm workspaces**. `packages/shared` is imported by both `web` and `api` so the anomaly rules and Zod validation schemas are defined **once**.

---

## 4. Authentication & multitenancy flow

Invite-only, domain-restricted **email/password via Supabase Auth (GoTrue)**. *Not* an OAuth
authorization-code grant — Supabase issues OAuth2-style JWTs internally, which is the only sense in
which "OAuth2" applies. SSO (M365/Google) is deferred. **Single mechanism, no "trigger OR API"
ambiguity** (audit B1–B3, B5):

```
1. Admin invites user by email (must match org allowed_domains) in Settings → Users.
   → Express POST /invites (service role) validates the domain, creates an invite row,
     and triggers the Supabase invite email.
2. User opens the email link → sets a password (Supabase Auth).
3. Client calls Express POST /invites/accept (service role):
   - re-validates the email domain (defense in depth — checked at BOTH invite + accept),
   - creates the `memberships` row (user → org → role) and an audit entry.
   (No auth.users trigger — membership creation is API-driven and explicit.)
4. Client calls supabase.auth.refreshSession() to get a claim-bearing token.
   The Custom Access Token hook looks up membership by user_id and injects org_id + role.
   If NO membership exists, it injects no org claim → app shows "Account pending /
   no organization" state (never a blank, RLS-denied screen).
5. Every request carries that JWT. RLS reads org_id/role from claims to filter + authorize.
```

**Service-role tenant safety (B5):** every API route derives `org_id` from the verified JWT — **never
from the request body** — and ownership-checks any `:id` against that `org_id` before a service-role
write. A cross-tenant denial test is a required deliverable.

**Key rules**
- **Domain allowlist:** signups are rejected unless the email domain matches an org's allowed domain (`silvicominc.com`). Enforced server-side, never trust the client.
- **JWT claims are the source of truth** for tenant + role in RLS. The browser cannot forge them.
- Service-role key lives **only** in the Express API env on Railway — never shipped to the browser.

---

## 5. Anomaly engine design

Deterministic, explainable, configurable. Lives in `packages/shared` (rule definitions) + `apps/api` (execution).

```
Fill-up created/updated
        │
        ▼
┌─────────────────────────────┐
│  Express POST /anomalies/    │
│  score  (or DB trigger →     │
│  pg_net call to API)         │
└──────────────┬──────────────┘
               ▼
   Load context: vehicle (tank cap, baseline MPG, last odometer),
   recent fill-ups, org thresholds, operating hours
               ▼
   Run rule set (Tier 1–4 from PRD). Each rule returns:
   { ruleId, fired: bool, severity, message, evidence }
               ▼
   Persist fired rules as `anomalies` rows (status=open)
               ▼
   If any severity >= High → enqueue email notification
```

- **Inputs are immutable evidence:** each anomaly stores the exact numbers that triggered it (e.g., `{previous_odometer, new_odometer}`), so the explanation never drifts.
- **Baseline MPG** = rolling median of the vehicle's last N valid fill-ups (ignore fill-ups already flagged as odometer-invalid so bad data doesn't poison the baseline).
- **Re-scoring:** editing a fill-up re-runs scoring for that fill-up **and the next fill-up in time
  order** (cascade), serialized per vehicle via an advisory lock (audit B4, H6). Anomalies that are
  already `investigating/resolved/dismissed` are marked `superseded` rather than deleted (M5).
- **v1 = deterministic rules.** Two **additive** layers sit behind feature flags and never block core
  delivery: the **Claude AI verification layer** (`07-AI-VERIFICATION.md`) for location plausibility +
  explainable risk, and **fuel-card ingestion** (`08-EFS-INTEGRATION.md`) which feeds imported
  transactions through this same engine. The `anomalies.source` column already supports `rules` | `ml`.

---

## 6. Storage

Receipt / pump photos are **optional** and go to a Supabase Storage bucket `receipts`, keyed
`org_id/vehicle_id/{fillup_uuid}.webp` (the fill-up UUID is **client-generated**, so the path is known
before upload — audit M6). Photos are **client-compressed to ≤200 KB WebP** before upload and purged
after 12 months to respect the free-tier 500 MB limit (audit H7). Storage RLS policy SQL is in
`02-DATA-MODEL.md §10.9`; signed URLs for display.

---

## 7. Environments & config

| Env | Purpose |
|-----|---------|
| `local` | Supabase local or a dev project; `.env` files per app. |
| `production` | Railway services + a dedicated Supabase project. |

All secrets via Railway variables (see `05-SETUP-GUIDE.md`). Frontend only ever gets `VITE_`-prefixed, non-secret values (Supabase URL + anon key + API URL).

---

## 8. Cross-cutting standards

- **TypeScript strict** everywhere; no `any` in committed code.
- **Zod at every boundary** — API request/response and form input validated against shared schemas.
- **RLS is mandatory** — no table ships without policies (see data model). Test policies from the client SDK, not the SQL editor (the SQL editor bypasses RLS).
- **ESLint + Prettier**, Husky pre-commit, conventional commits.
- **Testing:** Vitest (unit, incl. every anomaly rule), Playwright (critical e2e: login, log a fill-up, see anomaly).
- **Errors:** API returns structured `{ error: { code, message } }`; frontend surfaces friendly toasts.
  API errors **never echo upstream Supabase/Anthropic errors verbatim** (audit L8).

---

## 9. API contract (build before Phase 2)

Every Express endpoint is defined as a Zod input/output schema in `packages/shared` (single source of
truth, shared with tests) — no per-phase improvisation (audit C1). Minimum contract per endpoint:
**method, path, auth + required role, input schema, output schema, error codes.** Core endpoints:

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/invites` | admin | Create domain-checked invite |
| POST | `/invites/accept` | (token) | Create membership on accept |
| POST | `/invites/:id/revoke` | admin | Revoke |
| POST | `/transactions/:id/score` | manager/service | Run rules engine (+ cascade) |
| POST | `/anomalies/:id/ai-examine` | manager | On-demand Claude verification (`07`) |
| POST | `/imports` · `/imports/:id/commit` | manager | CSV ingestion (`08`) |
| GET | `/reports/*.csv` · `/reports/summary.pdf` | manager/auditor | Streamed exports |

Every route derives `org_id` from the JWT and ownership-checks path ids (B5). All list endpoints use
**keyset pagination** (audit M4). New server-only secret: `ANTHROPIC_API_KEY` (Railway env, never in
the browser bundle).

---

## 10. RLS test matrix (Phase-1 deliverable)

Automated Vitest suite **through the client SDK** (not the SQL editor): for each table × each role ×
{own-org, other-org}, assert allowed reads/writes succeed and forbidden ones are denied — including a
cross-tenant access-denial test (audit C2, B5).
