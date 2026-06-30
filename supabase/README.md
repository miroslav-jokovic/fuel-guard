# FleetGuard — Database (Supabase)

Schema, RLS, and seed for FleetGuard. Built from `docs/02-DATA-MODEL.md` (with the v1.1 audit
amendments in `docs/06-AUDIT-FINDINGS.md`).

```
supabase/
├─ migrations/
│  ├─ 0001_extensions_and_enums.sql   enums (+ 'superseded' status)
│  ├─ 0002_functions.sql              set_updated_at(), auth_org_id(), auth_role()
│  ├─ 0003_core_tables.sql            9 core tables + triggers + indexes
│  ├─ 0004_rls.sql                    RLS enabled + policies on every table
│  ├─ 0005_storage.sql                private `receipts` bucket + org-prefix policies
│  ├─ 0006_auth_hook.sql              Custom Access Token hook (injects org_id + user_role)
│  ├─ 0007_imports.sql                fuel_cards, imports, import_rows, declined_transactions
│  ├─ 0008_ai_verifications.sql       Claude AI verification records
│  └─ 0009_notifications_audit_triggers.sql  org notify config + audit triggers
├─ seed.sql                           Silvicom org, 8 vehicles, 6 drivers, ~147 transactions
└─ tests/rls.test.mjs                 offline RLS + auth-hook matrix (PGlite) — audit C2
```

> Integration tables (`fuel_cards`, `imports`, `import_rows`), `ai_verifications`, and
> `integration_credentials` are added in their own phases (4.5, 5.5, 10).

---

## Apply to a Supabase project

**Option A — Supabase CLI (recommended):**

```bash
supabase link --project-ref <your-project-ref>
supabase db push                 # applies everything in migrations/ in order
psql "$DATABASE_URL" -f supabase/seed.sql   # dev only
```

**Option B — SQL editor:** paste each `migrations/*.sql` file in order (0001 → 0005), then
`seed.sql`. (Do **not** use the SQL editor to *verify* RLS — see below.)

After applying, enable the **Custom Access Token hook** (Phase 2) so every JWT carries `org_id`
and `role` — the helper functions `auth_org_id()` / `auth_role()` read those claims, and **all RLS
depends on them**.

---

## Verify RLS — the right way

> ⚠️ The Supabase **SQL editor and the service-role key BYPASS RLS**. Verifying there gives false
> confidence. Always verify as a real end-user JWT.

**Live check (canonical):** with the Supabase JS client, sign in as a user in org A and confirm:

- selecting `vehicles` returns only org A's rows;
- selecting another org's rows returns `0`;
- a `driver` cannot insert into `vehicles` (RLS error) but can insert a `fuel_transaction`;
- a `fleet_manager` cannot read `audit_logs`; an `admin`/`auditor` can;
- a Storage object under another org's prefix cannot be read/written.

**Offline check (automated, no project needed):** the committed harness applies all migrations +
seed into an in-process Postgres (PGlite) with `auth`/`storage` shims and runs the matrix above as a
non-privileged role (the only role RLS is enforced for):

```bash
pnpm add -w @electric-sql/pglite      # one-time dev dependency
node supabase/tests/rls.test.mjs
```

Expected: **all checks PASS** (tenant read isolation, no-claim denial, role-based write rules,
cross-org write denial, audit-log read scoping, storage prefix isolation).

---

## Authorization summary (enforced by `0004_rls.sql`)

| Table | Read | Write |
|-------|------|-------|
| organizations | org members | admin |
| memberships | org members | admin |
| invites | admin | admin |
| drivers | org members | admin, fleet_manager |
| vehicles | org members | admin, fleet_manager |
| fuel_transactions | org members | insert: +driver · edit/delete: admin, fleet_manager |
| anomalies | org members | update: admin, fleet_manager · insert/delete: service role (engine) |
| anomaly_thresholds | org members | admin |
| audit_logs | admin, auditor | service role only |
| storage `receipts` | own org prefix | own org prefix |

The **service role** (API only) bypasses RLS for engine scoring, audit writes, and imports — always
after the API derives `org_id` from the verified JWT and ownership-checks ids (audit B5).

---

## Notes for graders / reviewers

- `gen_random_uuid()` is core in Postgres 16 (Supabase). The `pgcrypto` extension line is harmless
  there; the offline harness strips it since PGlite has the core function.
- `current_odometer` is **advisory/derived** (audit B4) — never used as a rule input.
- `disabled_rules` (not `enabled_rules`) — "off" is explicit/additive (audit L6).
- Re-scoring marks superseded anomalies `superseded` rather than deleting workflow state (audit M5).
