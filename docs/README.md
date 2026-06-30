# FleetGuard — Planning Docs

Enterprise fuel-theft-prevention & MPG-monitoring platform for commercial fleets.
Tenant: **Silvicom Inc.** · Stack: TypeScript · Vue 3 · Vite · Tailwind v4 · Node/Express · Supabase · Railway.

These docs are the **source of truth**. Build with Windsurf; point it here.

| # | Doc | What it covers |
|---|-----|----------------|
| 00 | [Product Overview (PRD)](./00-PRODUCT-OVERVIEW.md) | Problem, personas, roles, features, anomaly rules in plain language, v1 scope. |
| 01 | [Architecture](./01-ARCHITECTURE.md) | Stack, topology, monorepo layout, auth/tenancy flow, anomaly engine design. |
| 02 | [Data Model](./02-DATA-MODEL.md) | Full Postgres schema, RLS policies, indexes, precise anomaly rule spec, seed plan. |
| 03 | [Roadmap](./03-ROADMAP.md) | 10 dependency-ordered phases, each ending in a demoable outcome. |
| 04 | [Windsurf Prompt Pack](./04-WINDSURF-PROMPTS.md) | Copy-paste prompts, one block per phase. **Start here when building.** |
| 05 | [Setup & Deployment](./05-SETUP-GUIDE.md) | Supabase + Railway setup, env vars, go-live checklist. |
| 06 | [Audit & Resolutions](./06-AUDIT-FINDINGS.md) | 32 reviewed gaps/blockers/assumptions and the decision taken for each (v1.1 changelog). |
| 07 | [AI Verification Layer](./07-AI-VERIFICATION.md) | Claude API layer for location plausibility + explainable risk, after the rules engine. |
| 08 | [Fuel-Card Integration](./08-EFS-INTEGRATION.md) | CSV import now; EFS automated data-feed later, through one pipeline. |

> **Read order for a fresh build:** 00 → 01 → 02 → 06 (the v1.1 decisions amend 00–05) → 03 → 04,
> with 07 and 08 as companion specs for the AI and import phases.

## What FleetGuard does, in one paragraph

Every fuel fill-up produces two numbers a driver can fudge: the **odometer** and the **gallons**.
FleetGuard validates those against each vehicle's tank capacity, history, and expected MPG, then
flags the handful of fill-ups that don't add up — fuel paid for but never burned (theft), bad
odometer entries, or efficiency cliffs — into a review queue a fleet manager can act on. Simple for
drivers (a 30-second mobile form), serious underneath (tenant-isolated, audited, explainable).

## How to start building

1. Read 00→05 (or have Windsurf read `/docs`).
2. Open `04-WINDSURF-PROMPTS.md`, paste the **System primer**, then run **Phase 0**.
3. One phase per session. Run `pnpm lint && pnpm test` and smoke-check before the next phase.

## Build order at a glance

`0 Foundation → 1 DB & RLS → 2 Auth → 3 Fleet → 4 Fuel capture → 4.5 CSV import →
5 Anomaly engine → 5.5 AI verification → 6 Anomaly workflow → 7 Dashboards → 8 Hardening →
9 Deploy → 10 EFS auto-feed (post-launch)`
