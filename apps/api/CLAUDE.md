# apps/api — Express 5 API + worker

## Route pattern (copy an existing router, e.g. `src/routes/transactions.ts`)

- Router-factory function returning `Router`; `router.use(requireAuth)` at the top; per-route
  `requireOrg` + `requireRole(...)` — derive roles from the section matrix in
  `packages/shared/src/auth.ts` (`rolesThatCanView` / `rolesThatManage`), don't hand-list them.
- Handlers wrapped in `asyncHandler`; errors via `apiError(code, message)`; bodies validated with the
  Zod schema from `packages/shared` (`validateBody`).
- Every state-changing route writes `writeAudit(admin, {...})` with a namespaced action
  (`compliance.*`, `driver.*`). Long-running work returns 202 + jobId through the jobs service.
- Sensitive step-ups: `requireFreshAuth`; module gating: `requireModule`.

## The rule that matters most

`getSupabaseAdmin` is the SERVICE ROLE — it bypasses RLS. Every query must carry its own
`.eq("org_id", ...)` scoping, and the test must prove it: use
`src/testing/supabaseRecorder.ts` and call `expectOrgScoped(rec, ORG)`. A fake that swallows filters
is how cross-tenant reads shipped before.

## Other enforced constraints

- No partial `.upsert()` (`lint:upserts`) — UPDATE or a set-based RPC instead.
- Service/logic functions ≤ 200 lines (`lint:funcsize`); split rather than waiver.
- Schedulers: registered in `src/schedulers.ts`, pattern is env-flag → interval → per-org `last_*_at`
  dedupe (copy `digestScheduler.ts`). They run in exactly one process fleet-wide
  (`WORKER_ROLE`, `docs/WORKER-DEPLOYMENT.md`).
- The queue is platform infra at `src/queue/` (promoted from `services/queue/` 2026-08-27, program
  step P1.4); handlers live in `src/queue/handlers/` and MUST be registered in `handlers/index.ts`;
  jobs are claimed with FOR UPDATE SKIP LOCKED, per-kind concurrency caps in `worker.ts`.
- Notifications go through `notify()` → the `emit_notification` RPC (entitlement, mutes, quiet hours,
  dedupe key) — never insert notification rows by hand. Note: `notify()` reaches the driver app only;
  office-facing delivery is email via `lib/mailer.ts` until a web inbox exists.
- EFS card writes go through the capability registry (`src/efs/`), never ad-hoc service code.
- Pure logic goes in `packages/shared` with unit tests; services do I/O only.
- Never log PII (license numbers, card numbers) — redact request bodies before persisting them
  (`redactCardXml` is the precedent).
