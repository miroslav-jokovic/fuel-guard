# EFS Card Control — Phase B Execution Runbook (2026-08-11)

Sequenced from `docs/plans/EFS-CARD-CONTROL-PLAN.md` (the design authority — sections referenced
throughout) against what actually exists in the repo as of commit `91bc3e9`. Phase A (reads) is live
end to end: mirror at 199 cards, all five read operations green from the static egress, probe clean.

## What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Full-document echo + fidelity guard | `apps/api/src/lib/efsCardEcho.ts`, `efsCardXml.ts` | Built, fixture-tested (74 tests) |
| Concurrency token (`cardVersion`) | `efsCardXml.ts` | Built |
| Write request contracts (lock/unlock/override/prompts, reason + expectedVersion) | `packages/shared/src/cardControlContract.ts` | Built |
| Capabilities gate (kill switch → settings → entitlement → role → approver) | `apps/api/src/services/efsCardControlAccess.ts` + `efs_card_control_settings` (0173) | Built; reports `blockedBy` |
| Session/pacing/faults, interactive lane | `efsSoapSession.ts`, `soapClient.ts` | Built, shared with feeds |
| Probe (read half) | `routes/fuelCards/probe.ts` | Built |

## What Phase B must add

Write op (`setCardV2`) in a new `lib/efsCardWrite.ts` (efsCardOps is at 373/500 lines — keep the
write half separate from day one), `services/efsCardControl.ts` (plan §5.5: re-read → mutate → echo
→ write with `retry: false` → re-read → reconcile), the mutation ledger migration (plan §4.2 —
NUMBER IT 0177+; 0172/0174/0175 are burned, see the ledger-collision note in doc 22), per-intent
routes `routes/fuelCards/control.ts` (plan §5.3), write throttles + step-up re-auth (plan §6.2–6.3),
and the web action panels (plan §7.3).

## Step 0 — prerequisites (Miki, before any code)

1. Ask WEX for: (a) confirmation the service account is entitled to `setCardV2` on QA and
   production, (b) a DISPOSABLE card number on the QA environment, (c) QA credentials if they differ
   from production. Name `setCardV2` and `setCardRefreshingLimits` explicitly.
2. Decide the approver list (which admins may execute card writes) — plan §6.1 requires it named,
   not implied by role.
3. Routing fix landed first: `VITE_API_URL` on `@fleetguard/web` → fleetguardapi-production, so the
   UI that gains write buttons talks to the EFS-enabled service.

## Step 1 — ★ THE GATE: entitlement probe (plan §9, verbatim — six proofs, all required)

Extend `routes/fuelCards/probe.ts` with a write-probe step (admin-only, QA endpoint, explicit
confirmation input). It must prove: login; read entitlement; `getCardv2` parses clean;
**zero-edit echo passes `assertEchoFidelity` against WEX-authored XML** (runs even without write
permission); `setCardV2` no-op echo succeeds; **follow-up `getCardv2` returns the SAME
`cardVersion`**. Version moved ⇒ gate FAILED even though the write succeeded — fix the echo, add
the response as a fixture, re-probe. Never proceed past a failed gate. Archive the redacted probe
response in doc 22. Outcome writes `write_entitlement` = `confirmed` / `denied`.

## Step 2 — write path (only after the gate passes)

1. Migration `0177_efs_card_mutations.sql` — the ledger: intent, status
   (`pending/sent/succeeded/failed/drift_detected`), reason, requestedBy, before/after versions,
   redacted fault. RLS deny-all, service-role only, same posture as `efs_cards`.
2. `lib/efsCardWrite.ts` — `setCardV2` from the echo layer. `retry: false` is MANDATORY (a timed-out
   write may have landed); reconcile by re-read (plan §5.5). Treat empty 200 as success, fault or
   `Result -1` as failure (guide p9).
3. `services/efsCardControl.ts` — one function per intent, each: capabilities check → throttle →
   ledger `pending` → re-read `getCardv2` → verify `expectedVersion` (409 on drift) → mutate DOM →
   `assertEchoFidelity` → send → re-read → ledger outcome + audit event.
4. `routes/fuelCards/control.ts` — the five endpoints from plan §5.3, `requireFreshAuth` step-up on
   DRID removal and unlock-from-Fraud.

## Step 3 — frontend (plan §7.3)

Lock/unlock drawer, override panel (uses 1–9, all-locations vs one-location via the now-working
`searchLocation` picker), prompts editor (DRID/UNIT, `replaceAll` semantics surfaced honestly),
mutation history from the ledger, and the settings card (approvers, enable toggle). All action
surfaces render from `capabilities` — never from role guesses.

## Step 4 — controlled rollout

`EFS_CARD_CONTROL_ENABLED=true` on `@fleetguard/api` ONLY (the web service never needs it —
schedulers off, and after the routing fix its API surface serves no EFS calls). Settings row enabled
for one pilot org. First real mutation: lock+unlock a spare card, verify at a pump or in the WEX
portal. Watch the mutation ledger for a week before widening. Keep Phase C (product-limit
overrides, refreshing limits, bulk, revert) out of scope — the design accommodates it; do not build
it yet.

## Effort estimate

Gate probe ~½ day (mostly waiting on WEX for the disposable card). Write path ~2–3 days including
the round-trip suite extensions. Frontend ~2–3 days. Rollout observation ~1 week calendar, near-zero
effort. Critical path: WEX's disposable-card confirmation — send that email first.
