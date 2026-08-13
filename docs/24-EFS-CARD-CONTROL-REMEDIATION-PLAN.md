# EFS Card Control — Remediation & Parity Plan (v2)

**Date:** 2026-08-13
**Supersedes:** v1 of this document (2026-08-13, earlier)
**Companion to:** `docs/23-EFS-CARD-CONTROL-FINDINGS-2026-08-12.md`
**Status:** Plan only. Execution starts in a new session.

---

## What changed in v2

Three inputs since v1:

1. **B4 is answered.** Clearing a product-limit override **does** restore the card's original limits. Phase 4's contingency branch is deleted; we still verify it once on QA rather than trusting it silently.
2. **The `FuelGuard-phase-b-delivery` and `FuelGuard-delivery-verify` repos** show the delivery discipline used for Phase B: build on a `delivery-main` branch, verify in a clean clone, then merge. §0.7 formalises it.
3. **The real requirement, stated plainly by you:**

   > *"We have to make sure in this planning phase we set everything for production, but to test it in QA before we push to production. Issues we had before with testing is IPs that are also strict for testing and these are the same as production's ones, so we basically have all things setting in production code and testing them in QA."*

That third point is the structural change, and it is not a footnote — it is the spine of v2. **v1 gated new capabilities behind deploy-wide env vars. That is architecturally wrong for your topology and would have caused exactly the class of accident the report documents.** §0.4 explains why, and **Phase 1.5 — the Capability Promotion System** is the new phase that fixes it. Every later phase now hangs off it.

---

## 0. How to use this plan

### 0.1 The objective, in one paragraph

FuelGuard must be a faithful mirror of, and a safe editor for, **what your EFS account and policies actually have configured** — odometer following, custom overrides, all of it. Every change ships to production the moment it is written, but **no EFS write capability becomes live for the production org until it has been proven against the QA org, and the proof has been shown to transfer.** Both of those halves need building. Neither exists today.

### 0.2 Structure of every step

| Field | Meaning |
|---|---|
| **Change** | Exact files touched, and what changes in each |
| **Verify** | Runnable commands and/or observable outputs, with the expected result stated |
| **Rollback** | How to undo, if the verify fails |

A step is **not done** until its Verify passes. A phase is **not done** until its **Phase Gate** passes. No phase starts before the previous gate is green and you have approved it.

### 0.3 Standing gates (run before every commit)

From `.github/workflows/ci.yml`, mirrored in `docs/plans/DEVIN-HANDOFF-2026-08-07-DEPLOY.md:66-83`:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn
pnpm lint
pnpm lint:filesize        # 500-line cap per file
pnpm lint:funcsize        # 200-line cap per function
pnpm lint:migrations
pnpm lint:boundaries
pnpm lint:tokens-parity
pnpm --filter @fuelguard/web lint:tokens
pnpm lint:secrets
pnpm typecheck
pnpm test                 # unit suites + 4 RLS matrices
pnpm build
```

**Pin these counts** — `pnpm test` is `pnpm -r test && pnpm test:rls`, so one unrelated unit failure means the matrices never run:
`rls` **179** · `hazmat_rls` **16** · `load-lifecycle` **54** · `duty-sessions` **20**. A changed count is a finding, not a nuisance.

> ⚠️ `ci.yml` is **protected** (`docs/plans/PHASE-7-SSOT-CODEGEN.md:51`). Steps that add a CI gate are marked **HUMAN**.

---

### 0.4 ⚠️ The deployment reality — read this before anything else

This is the constraint that reshapes the plan.

```
                    ┌─────────────────────────────────────────┐
                    │  ONE Railway service: apps/api          │
                    │  ONE static egress IP (whitelisted       │
                    │  by EFS via EFS_SOAP_EGRESS_PROXY_URL)   │
                    └───────────────┬─────────────────────────┘
                                    │  same process, same env vars
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────────┐      ┌───────────────────────────┐
        │ QA org 07fe4058…      │      │ PRODUCTION org 86d6b3ea…  │
        │ efs_soap_credentials: │      │ efs_soap_credentials:     │
        │   environment=sandbox │      │   environment=production  │
        │   ws.partner.efsllc…  │      │   ws.efsllc…              │
        │ 13 disposable cards   │      │ 199 real cards            │
        └───────────────────────┘      └───────────────────────────┘

        ┌─────────────────────────────────────────┐
        │  SECOND Railway service: apps/admin-api  │
        │  DIFFERENT egress IP — NOT whitelisted   │
        │  NO EFS credentials, NO SOAP client      │
        │  SAME Supabase project + service role    │
        └─────────────────────────────────────────┘
```

**Four consequences, each of which changes a design decision:**

**(a) A separate staging deployment is impossible.** A new Railway service gets a new egress IP, which EFS has not whitelisted, so it cannot talk to EFS at all. This is exactly the pain you described. **The plan must never propose a staging environment.** QA-vs-production separation is an *org* boundary inside one deploy, and that is the established pattern — `docs/plans/DEVIN-EFS-QA-SETUP.md:82-87` already documents why the QA credentials live on their own org.

**(b) Deploy-wide env flags cannot gate a capability.** `EFS_CARD_DELETE_OVERRIDE_ENABLED` (`env.ts:231`) is a single boolean for the whole process. Turning it on to test `deleteOverride` on QA turns it on for production in the same instant. **Every per-operation gate in this plan must be a per-org database row, not an env var.** Existing deploy-wide flags that gate operations get migrated into the capability model in Phase 1.5.

**(c) The probe and experiment routers are a live hazard while Phase 0 runs.** They do not consult `efs_card_control_settings` at all (`experiments.ts:133-143`, `writeProbe.ts:88-103`) and take the card number straight from the request body with **no org-ownership check**. So while `EFS_CARD_CONTROL_PROBE_ENABLED=true`, an admin request carrying a production card number writes to a real production card — no ledger row, no rate limit. That is why the org-ownership guard is **Step 0.1**, ahead of the discovery it enables.

**(d) The proving run must live in `apps/api`; the promotion decision should live in `apps/admin-api`.** admin-api has no EFS credentials, no SOAP client, and a non-whitelisted egress (`apps/admin-api/src/env.ts:8-27` — eight keys, zero `EFS_*`). Giving it any of those means a second IP to whitelist and breaks the process-isolation invariant its own env header asserts. But it shares the Supabase project, so it can **read the evidence `apps/api` writes and act on it**. That split is the design in Phase 1.5.

---

### 0.5 The Operation Enablement Gate (OEG)

Every new EFS **write** operation must pass the same five proofs against QA before it can be promoted anywhere. This generalises the existing ten-proof `/write-check` (`writeProbe.ts:19-27`) to a per-operation form, and in Phase 1.5 it stops being a convention and becomes a **recorded artefact**.

| # | Proof | Why |
|---|---|---|
| **OEG-1** | **Entitlement.** The operation returns something other than `not_allowed` / `auth` on the account. | The account may simply not be entitled — still the open question on `deleteOverride` |
| **OEG-2** | **Zero-edit echo.** An empty edit list passes `assertEchoFidelity` against WEX-authored XML, and `cardVersion` is **unchanged** after dispatch. | A successful write is not evidence of a correct write (`writeProbe.ts:41-44`) |
| **OEG-3** | **Real change lands**, confirmed by re-read within `VERIFY_DELAYS_MS = [0, 3000, 5000]`. Record apply latency. | Baseline ~533ms from the H1 experiment |
| **OEG-4** | **Vocabulary match.** Every value we send is byte-identical in casing and format to the account's observed vocabulary for that field. | **The H1 lesson.** EFS answers a mis-cased write with an identical void success and silently does not apply it (`docs/22:445-493`). Highest-probability failure mode for every new string field |
| **OEG-5** | **Revert lands**, proven by a final re-read. | Never leave a QA card dirty |

Two properties of the proof are what make promotion safe, and both are recorded:

- **`document_shape`** — `flat` or `nested:<name>` (`efsCardXml.ts:348`). A proof transfers only to an account whose documents have the same shape. Your own code says so: *"a QA account and a production account are two different EFS installations, and a proof obtained on one only transfers to the other if the documents have the same structure"* (`efsCardXml.ts:342-346`).
- **`vocabulary`** — the exact strings the account uses for every field this capability writes.

---

### 0.6 Repo constraints that shape the design

| Constraint | Consequence |
|---|---|
| `lint:filesize` 500 lines | `control.ts` is **527**, `cardControlContract.ts` is **528** — both at or over. **Nothing can be added until they are split.** Step 1.0 |
| `lint:funcsize` 200 lines | New orchestration must be small composed functions |
| `strictLimiter` 30 req/15min on `/api/fuel-cards` | Each route-test `describe` spins its own server, must stay under ~28 requests |
| admin-api `routeAuth.test.ts:20` regex | A new `/admin/*` router gets 401/403 coverage **automatically**, but only if mounted with the literal `app.use("/admin/x", xRouter())` syntax |
| Migrations: next free is **0185** | `0172`/`0174`/`0175` burned; highest applied `0184`. Never edit an applied migration |
| `diffCanonical` is **private** in `efsCardEcho.ts:355` | The E-1 ordering fix must move+export it or fix in place |
| No coverage threshold, no e2e | Don't promise either as a gate |
| Platform step-up ≠ customer step-up | admin-api uses TOTP recency from the JWT `amr` claim, 5-min window (`platformAuth.ts:129-135`). apps/api mints `x-step-up-token`. They share only the error string |

### 0.7 Delivery discipline

Copy the Phase B pattern visible in the two delivery repos:

1. Build on a **`delivery-<phase>` branch**, never directly on `main`.
2. Run the full standing gates **in a clean clone** (`FuelGuard-delivery-verify` is that clone) — this catches "works because of my local state."
3. Merge to `main` only after the phase gate is green and you have approved.
4. Migrations reach the database only via `migrate.yml` on merge to `main`. **Never hand-apply SQL** (`docs/MIGRATION-DISCIPLINE.md:37-39`).

> ⚠️ Known CI hazard, already documented at `docs/AUDIT-2026-08-09.md:65-71`: all workflows trigger independently on `push: main` with **zero `needs:` or `workflow_run:` edges**, so *a push to main that breaks every test still runs `supabase db push` against production*. Until that is fixed, **the clean-clone verification in step 2 is the only thing standing between a bad commit and the production database.** Treat it as mandatory, not optional. Filing the CI dependency fix is a **HUMAN** task worth doing early.

### 0.8 SOAP and web test patterns

SOAP tests copy `apps/api/src/lib/efsCardWrite.test.ts:43-76` verbatim: the `stub()` injectable `fetchImpl`, XML fixtures in `apps/api/src/lib/__fixtures__/efs/`, `afterEach(() => { __resetEfsSessions(); __resetSoapPacing(); })`, env literal with `EFS_SOAP_MAX_RPS: 100` and `EFS_SOAP_INTERACTIVE_RPS: 100`. **The first stubbed response is always `loginOk`, so the request under assertion is `s.bodies[1]`.** Card numbers in fixtures must be obviously fake (`lint:secrets` scans tracked content).

Web tests copy `CardControlDrawer.test.ts`: `vi.hoisted()` mock state, `vi.mock("./useCardControl")`, inline child stubs, a `caps()` factory, `render(over)`, text-based `button()` lookup with a diagnostic throw. **House convention: every `it` names the defect it prevents.**

---

## Phase 0 — Account discovery & parity baseline

**Goal:** an evidence-backed inventory of what your EFS account and policies actually have configured, so phases 2–7 are scoped to reality.
**Risk:** low — read-only, after one safety fix.
**Produces:** `docs/25-EFS-ACCOUNT-INVENTORY.md`.

### Step 0.1 — Probe org-ownership and production guards

Pulled to the front because Phase 0 needs `EFS_CARD_CONTROL_PROBE_ENABLED=true`, and §0.4(c) explains why that is currently unsafe.

**Change**
- `apps/api/src/routes/fuelCards/probe.ts`, `writeProbe.ts`, `experiments.ts`: before any SOAP call, resolve the submitted `cardNumber` through the org-scoped mirror lookup already used by `control.ts:154` (`efsCardMirror.ts:458-473`). Not in the caller's org → **404**, same shape as `control.ts`.
- Second guard: refuse when the resolved credentials' `environment === "production"` or the endpoint host is the production host, unless `EFS_ALLOW_PRODUCTION_PROBE` (new, default `false`) is `"true"`. This one **is** legitimately an env var — it discriminates by the org's own credential environment, so it blocks production while leaving QA usable.
- `read_state` keeps working under the org guard; it is Phase 0's workhorse.

**Verify**
1. `pnpm --filter @fuelguard/api test apps/api/src/routes/fuelCardsProbe.test.ts` — new cases: *"refuses a card number the org does not own"* (404), *"refuses a production-environment credential without the explicit override"* (403).
2. Standing gates green.
3. Deployed, as QA-org admin: production card number → **404**; QA card `…7671` → 200.

**Rollback** Revert. Do not run Phase 0 discovery until this is in.

---

### Step 0.2 — Read-only account-inventory operations

**Change** New `apps/api/src/lib/efsAccountOps.ts`, following the `getPolicy` template exactly (`efsCardOps.ts:328-381`): op name → body with `el("clientId", session.clientId)` → `parseSoap` → `findDescendant(root,"result") ?? "return" ?? root` → zod `safeParse` → throw `EfsSoapError(..., "malformed_response", { issues })`.

| Op | Tells us |
|---|---|
| `getPromptTypes` | **The account's actual prompt IDs** — ground truth for Phase 3 |
| `getPolicyDescriptions` | Every policy number + description |
| `getProducts`, `getProductGroups` | Product codes, fuel types, groups, `isFuel` |
| `getContracts` | Contract IDs, currency, `limitMethod`, master flag |
| `getCreditLimits` | **Real headroom** — `transLimit`, `creditAvailable`, `dailyLimit`, `dailyAvailable`, `totalAvailable`, `maxMoneyCode`, `uom` |
| `getCardRefreshingLimits` / `getPolicyRefreshingLimits` | **Velocity limits actually set** |
| `getLocationGroupDescriptions` / `getLocationGroups` | Group ids, names, `ruleBased`, `editable` |
| `getSitePolicyDescriptions` | Site-policy structure, if used |
| `getCarrierInfo` | Carrier id/name, and **whether location groups are enabled for the account** |
| `serverTime` | Clock-skew reference for time restrictions |

Schemas go in a **new** `packages/shared/src/efsAccountContract.ts` — not `cardControlContract.ts`, which is over the size cap.

**Verify**
1. `apps/api/src/lib/efsAccountOps.test.ts` — one recorded fixture per op. Assert each request contains the right `CardManagementEP_<op>` wrapper and `clientId`, and the parse matches.
2. `pnpm lint:filesize`; standing gates green.

**Rollback** Delete both new files and their tests.

---

### Step 0.3 — The discovery endpoint

**Change**
- New `apps/api/src/routes/fuelCards/inventory.ts` → `POST /api/fuel-cards/account-inventory`, `requireAuth` + `requireOrg` + `requireRole("admin")`. **Read-only, so no probe flag and no step-up** — same posture as `/diagnose` (`probe.ts:92-97`).
- Sequence: `getCarrierInfo` → `getPromptTypes` → `getContracts` → per contract `getCreditLimits` → `getPolicyDescriptions` → per policy `getPolicy` + `getPolicyRefreshingLimits` → `getProductGroups` → `getProducts` → `getLocationGroupDescriptions` → `serverTime`. Optional `{ sampleCards?: string[] }` (max 25, org-owned) adds `getCardv2` + `getCardRefreshingLimits` each.
- Returns a structured inventory, PAN-redacted via `redactCardXml`, plus a `steps[]` array in the `/diagnose` shape so partial failure is legible. Audit row `integration.efs_soap.account_inventory` with `environment` and `egressIp`.
- Mount in `apps/api/src/app.ts:222`.

**Verify**
1. `apps/api/src/routes/fuelCardsInventory.test.ts` — under 28 requests. 403 non-admin; 404 for a foreign `sampleCards` entry; response shape.
2. Deployed on QA: `ok: true`, every step green. A red step is a finding to record.

**Rollback** Unmount in `app.ts`.

---

### Step 0.4 — Run discovery, write the inventory

**Change** No code. Produce `docs/25-EFS-ACCOUNT-INVENTORY.md`.

**Procedure**
1. Set `EFS_CARD_CONTROL_PROBE_ENABLED=true`; confirm `EFS_ALLOW_PRODUCTION_PROBE` is unset.
2. Run `/account-inventory` on the **QA org**. Save raw JSON.
3. Run it on the **production org** — read-only, and where the real answer lives, since QA cards won't carry your custom configuration.
4. Capture `getCardv2` + `getCardRefreshingLimits` for 5–10 production cards spanning different policies.
5. `read_state` on the same cards for `documentShape` and the redacted document.
6. **Unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy.**

**The document must answer these** — they are the scoping inputs for everything after:

| # | Question | Feeds |
|---|---|---|
| Q1 | Which Info IDs does `getPromptTypes` return? | Phase 3 |
| Q2 | Which Info IDs are in use, card vs policy, with which `validationType` and `value`? | Phase 3 |
| Q3 | **Is odometer following configured?** `ODRD` or `HBRD`? `ACCRUAL_CHECK`? What accrual value? Card or policy? How many cards? | Phase 3 — the capability you named |
| Q4 | **The account's exact vocabulary** for every writable string field: `status`, `handEnter`, `infoSource`, `limitSource`, `locationSource`, `timeSource`, `validationType`, `payrollUse`, `refreshingLimitSource`. Exact casing. | **OEG-4 for every phase**, and the seed for the Phase 1.5 vocabulary snapshot |
| Q5 | Which `limitId`s appear, with what `limit`/`hours`/`minHours`/`autoRollMap`/`autoRollMax`? | Phases 4, 6 |
| Q6 | Refreshing limits: card level, policy level, or none? What `refreshingLimitSource`? | Phase 6 |
| Q7 | `getCreditLimits` per contract — real ceilings and `uom`? | Phase 2, Phase 6 validation |
| Q8 | Does `getCarrierInfo.locationGroups` say the account uses groups? Which exist, `ruleBased`/`editable`? | Phase 6 |
| Q9 | Time restrictions in use, on which days? | Phase 6 |
| Q10 | How many policies, and what does each set? | Phase 2 |
| Q11 | **Production `documentShape` — and does it match QA's?** | **Gates the entire promotion model.** If they differ, a QA proof cannot transfer and Phase 1.5's shape check will (correctly) block every promotion |
| Q12 | Header fields present in production XML that `wsCardSchema` does not model? | Phase 2 |

**Verify** The doc answers Q1–Q12, each with raw evidence quoted and the source operation named. Confirm the probe flag is unset (`POST /api/fuel-cards/experiment` → 403 `probe_disabled`).

**Rollback** N/A. If discovery contradicts the plan's assumptions — **especially Q11** — stop and re-scope.

### ✅ Phase 0 Gate

- [ ] Probe routers refuse foreign and production cards
- [ ] `docs/25-EFS-ACCOUNT-INVENTORY.md` answers Q1–Q12 with evidence
- [ ] **Q4 vocabulary table complete** — the OEG-4 reference
- [ ] **Q11 answered** — QA and production document shapes compared
- [ ] Probe flag unset and redeployed
- [ ] Standing gates green; RLS counts 179/16/54/20
- [ ] **You have reviewed the inventory and confirmed Phase 3/6 scope**

---

## Phase 1 — Safety, correctness, structural prep

**Goal:** close every Critical and High finding, fix the active data-loss bug, and make room in the two over-cap files.

### Step 1.0 — Split the two over-cap files

Mechanical, behaviour-preserving, first because nothing can be added to either.

**Change**
- `routes/fuelCards/control.ts` (527) → `routes/fuelCards/control/`: `index.ts` (router + non-goals docblock), `prepare.ts` (`prepare`, `run`, `Prepared`, `mutationFingerprint`, `idempotencyKeySchema`, `ActionRefusalError`, `refusal`, `controlErrorResponse`, `toMutationView`), then `lock.ts`, `unlock.ts`, `override.ts`, `prompts.ts`, `history.ts`.
  While splitting, **fix the inconsistency**: the prompts route calls `executeCardMutation` inline (`control.ts:381-406`) instead of `run()`. Route it through `run()`.
- `packages/shared/src/cardControlContract.ts` (528) → keeps write schemas and the intent/scope unions, re-exporting the rest; new `efsWsSchemas.ts` takes `wsCardInfoSchema`, `wsCardLimitSchema`, `wsTimeRestrictionSchema`, `wsCardSchema`, `wsPolicySchema`, `mergeEffectiveConfig`, `EffectiveRow`, `isEnforced`.

**Verify**
1. `pnpm lint:filesize` — everything under 500.
2. `pnpm lint:boundaries`, `pnpm typecheck`, `pnpm test` — **zero test changes required.** If any test needs editing, the split was not behaviour-preserving: revert and redo.
3. `git diff --stat` shows moves, not rewrites.

**Rollback** Single revert.

---

### Step 1.1 — 🔴 Fix the `reportValue` prompt-deletion bug

The one item losing data today.

**Change**
- `cardControlContract.ts` `promptInputSchema:314`: add `reportValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable()`. Replace the single `.refine` at `:318` with two — `EXACT_MATCH` requires non-empty `matchValue`; `REPORT_ONLY` requires non-empty `reportValue`.
- Add **explicit removal**: `remove: z.boolean().default(false)` on `promptInputSchema`, or `removeInfoIds: z.array(z.string()).default([])` on `setPromptsSchema`. **Removal must never again be inferred from an empty string.**
- `services/efsCardEdits.ts` `promptsEdits:194`: removal driven by the explicit field only; update path (`:217`) writes `reportValue` for `REPORT_ONLY` and `matchValue` for `EXACT_MATCH`, blanking the other; append path (`:231-240`) populates `reportValue` from input instead of hardcoding `""`.
- `routes/fuelCards/control/prompts.ts`: extend the DRID guard (`control.ts:363`) to require the explicit flag for **any** removal, and step-up for any removal.
- `apps/web/src/pages/FuelCardDetailPage.vue:43-51` — carry `reportValue`.
- `CardControlDrawer.vue:136-142` (seed) and `:225` (submit) — carry `reportValue`; **delete the empty-string filter**.
- `CardPromptsPanel.vue` — bind the value field to `matchValue` or `reportValue` by type; add an explicit **"Remove this prompt"** danger button; delete the `removals`/`removesDriverId` inference (`:52-55`).

**Verify**
1. New fixture `__fixtures__/efs/getCardV2.reportOnly.xml` reproducing the QA card's `UNIT` record (empty `matchValue`, `reportValue = T001`, `REPORT_ONLY`).
2. `efsCardEdits.test.ts` — three `it`s: *"does not remove a REPORT_ONLY prompt when the operator changes nothing"*, *"writes reportValue, not matchValue, when switching EXACT_MATCH → REPORT_ONLY"*, *"appends a REPORT_ONLY prompt with its report value, not an empty string"*.
3. Route test: *"refuses a prompt removal without the explicit flag"* → 400.
4. Web test: *"a no-op save on a REPORT_ONLY card sends the prompt back unchanged"*.
5. **Live QA:** card `…7671` — `read_state`, open drawer, change nothing, save, `read_state` → **`infos` identical**. Then change the `UNIT` report value, save, re-read, revert.

**Rollback** Revert and re-attempt immediately; the bug is active.

---

### Step 1.2 — `infoSource` guard

**Change** `routes/fuelCards/control/prompts.ts`: in `buildEdits`, when `doc.card.infoSource` is not `CARD` or `BOTH` (case-insensitive, `efsCardCatalog.ts:51` style), throw `ActionRefusalError("invalid_request", …)` naming the card's actual `infoSource`. Surface as a disabled state with the reason, not a post-hoc error.

**Verify** New fixture `getCardV2.policySource.xml`; assert 400 naming `POLICY`; assert `BOTH`/`CARD` still succeed in any casing. Web test: *"prompts section is disabled with a reason when infoSource is POLICY"*.

**Rollback** Single revert.

---

### Step 1.3 — 🔴 E-1: make the echo guard order-aware

`WSCardv2` is an `xsd:sequence`. New fields and collections are appended after everything else (`efsCardEcho.ts:167-177`), and `diffCanonical` iterates the union of path keys (`:355-364`) — **inter-name ordering is never compared**. Phase 3 (a prompt on a card with no `infos`) and Phase 4 (limits on a card with none) are both exactly this case.

**Change**
- `efsCardCanonical.ts`: add exported `elementOrder(root, exclude): string[]`. Move `diffCanonical` here from `efsCardEcho.ts:355` and export it.
- `efsCardEcho.ts`: add `WS_CARD_SEQUENCE = ["cardNumber","header","infos","limits","locationGroups","locations","timeRestrictions"] as const`, cited to the WSDL. Change the two append loops (`:167-177`) to **insert at the correct sequence position**. Extend `assertEchoFidelity` to compare `elementOrder(expected)` vs `elementOrder(actual)` and throw `echo_unfaithful` with a sequence diff.

**Verify**
1. *"introduces a new infos collection in sequence order, not at the end"* — `getCardV2.empty.xml`, `replaceAll` on `infos`, assert `<infos>` precedes `<limits>` in the bytes.
2. Same for `limits`.
3. *"the fidelity guard rejects an out-of-sequence request"*.
4. *"a zero-edit echo of every fixture is byte-order-stable"* — loop all fixtures.
5. All existing echo tests pass **unchanged** — this is a strictly stronger guard.
6. **Live QA:** `/write-check` `readOnly:true` on `…7671`; steps 1–6 green, step 6 (`cardVersion` unchanged) load-bearing.

**Rollback** Revert. Phases 3 and 4 are blocked until this lands.

---

### Step 1.4 — H-1: remove the `iat` step-up fallback

The web side is **already migrated** — `apps/web/src/lib/api.ts:46-49` spreads `stepUpHeader()` into every request and `StepUpPrompt.vue` always mints a real token. The docblock at `requireFreshAuth.ts:50-57` names its own removal condition and that condition is met.

**Change** Delete the `iat` branch from `requireFreshAuth` (`:72-93`) and `hasFreshAuth` (`:104-107`). Both reduce to `hasStepUpToken(req)`. Keep `DEFAULT_STEP_UP_MAX_AGE_SEC` in the 403 payload — the web client reads it.

**Verify**
1. Rewrite `requireFreshAuth.test.ts`: *"a fresh iat alone no longer satisfies step-up"*, *"a valid step-up token satisfies it"*, *"an expired token does not"*, *"a token minted for a different org does not"*.
2. All five call sites still behave (`settings.ts:192/272/340`, `writeProbe.ts:93`, `experiments.ts:137`, plus the `hasFreshAuth` predicates).
3. **Manual, deployed:** on QA, a 4-use override without the password → 403; with the password → succeeds; then **refresh the session token and retry without the password → must still be 403.** That last check is the point of the step.

**Rollback** Revert. This makes step-up stricter; if it breaks a flow, add the prompt to that flow — do not restore the fallback.

---

### Step 1.5 — C-1 + C-2 + M-3: bind entitlement and environment to the endpoint

This is the *foundation* the promotion system in Phase 1.5 builds on.

**Change**
- **Migration `0185_efs_card_control_environment.sql`** (idempotent):
  - `efs_card_control_settings`: `probed_endpoint_host text`, `probed_document_shape text`.
  - `efs_card_mutations`: `environment text`, `endpoint_host text`, `card_last4 text`.
  - RLS unchanged (service-role only, 0106-style comment).
- `efsSoapCredentials.ts` `upsertEfsSoapCredentials:261`: add an `env: Env` parameter; validate `environment` against the endpoint host and reject a mismatch; when `endpoint_url` or `environment` changes, set `write_entitlement='unknown'` and `enabled=false` and audit it.
- `efsCardControlAccess.ts` `loadCardControlAccess:57`: after `entitlement !== "confirmed"` (`:85`), also refuse when `probed_endpoint_host` differs from the current host, or `probed_document_shape` differs from the observed shape. Add `blockedBy: "endpoint_changed"` to `cardCapabilitiesSchema:231-240`.
- `writeProbe.ts:261`: persist `probed_endpoint_host` and `probed_document_shape`.
- `routes/integrations.ts:375` and `:436`: add `requireFreshAuth()` (**M-3**).
- `efsCardControl.ts` + `efsCardReconcile.ts:296-308`: carry `environment`, `endpoint_host`, `card_last4` into ledger and audit meta.
- `env.ts:184`: `EFS_SOAP_ENVIRONMENT` default `production` → `sandbox` (**L-3**).

**Verify**
1. `GET /api/version` → `schema.applied: 185`, `state: current`, `drift: false`.
2. `pnpm lint:migrations`, `pnpm test:rls` — counts unchanged.
3. Unit tests: *"an environment/endpoint mismatch is rejected at upsert"*, *"changing the endpoint resets entitlement and disables card control"*, *"access is refused when the endpoint host differs from the probed host"*, *"a mutation records environment, endpoint host and card last-4"*.
4. **Deployed, QA:** `/write-check` → `confirmed`, host stored. Change `endpoint_url` → blocked with `endpoint_changed`. Re-probe to restore.

**Rollback** Migration is additive; revert code and re-probe.

---

### Step 1.6 — H-3: rotation invalidates sessions

**Change**
- Call `__resetEfsSessions(creds)` and `invalidatePolicy(orgId)` at the end of `upsertEfsSoapCredentials:261` and `disableEfsSoapCredentials:283`.
- Same at the cert activate/rollback/retire sites in `routes/integrations.ts`, immediately after the state change and **before** `writeAudit` — matching the `invalidateTlsAgents` pattern at `:635`, `:751`, `:784`, `:816`.
- `efsSoapSession.ts:301`: extend `sessionKey` to include a short hash of the password and the active cert fingerprint, so a rotation changes the key even if a reset call is missed.

**Verify**
1. *"a password change produces a different session key"*, *"upserting credentials clears the cached session"*, *"disabling clears session and policy cache"*.
2. **Deployed:** on QA, make a read; rotate to a wrong password; the next read must fail `auth`, **not** succeed on cache.

**Rollback** Revert.

---

### Step 1.7 — H-5 · M-1 · M-2 · M-4 · M-6 · M-7 · E-2 · fault handling

Independent small fixes, one commit and one test each.

| Item | Change | Verify |
|---|---|---|
| **H-5** | `efsCardXml.ts:406` and `efsCardMirror.ts:489`: mask `\b\d{10,25}\b` (was `12,25`) to match the accepted PAN length | *"a 10-digit card number in a fault message is masked"*; update the payload scanner to 10+ |
| **M-1** | `control/prepare.ts:132`: `Idempotency-Key` becomes **required** — 400 when absent | *"a mutation without an Idempotency-Key is refused"* |
| **M-2** | Persist the vendor-op identity on the ledger row; give `efsCardUnresolved.ts:150` a vendor-op branch using `overrideClearedLanded` instead of skipping empty-edit rows | *"an unverified deleteOverride is reconciled by the sweep"* |
| **E-2** | Wire `EFS_CARD_WRITE_TIMEOUT_MS` (`env.ts:236`) as a real orchestration deadline in `efsCardControl.ts` — an `AbortController` spanning read→write→verify, replacing the comment at `:513` | *"the orchestration aborts at the deadline and settles as unverified"* with a stalling stub |
| **Faults** | Add `/flying\s*j/i` to `FAULT_CODES` (`efsSoapSession.ts:90-109`). Extend `firstScalar` (`efsCardWrite.ts:209`) to recognise `errorNumber`/`errorDesc` documents | *"a flying j exception is classified, not swallowed"*; *"an errorNumber/errorDesc response is recorded as failed with the vendor's text"* |
| **M-4** | Failed `writeAudit` becomes a loud alert, not a silent `false` (`efsCardReconcile.ts:148`). Add `efs_card_mutations` to `RETENTION_FORBIDDEN` (`dataRetention.ts:141-168`) | *"the mutation ledger is not prunable"* |
| **M-6** | Seal `soap_password` via `secretBox`, AAD `(orgId, "efs_soap_password.v1")`. Migration **0186** + read-path fallback for unsealed rows, then a one-shot backfill | *"a sealed password round-trips"*, *"an unsealed legacy row still reads"*; deployed read still works |
| **M-7 · HUMAN** | `.gitleaks.toml` with allowlists for `__fixtures__/mtls/` and `••••` strings; wire into CI | CI green |
| **CI · HUMAN** | Add `needs:`/`workflow_run:` edges so `migrate.yml` cannot run when `ci.yml` failed (§0.7) | A deliberately failing PR does not trigger `db push` |
| **M-5 · defer** | Document the replica-multiplication caveat in `cardWriteLimits.ts` now; implement shared-store windows when replicas > 1 | Comment present; ticket filed |

### ✅ Phase 1 Gate

- [ ] `pnpm lint:filesize` green
- [ ] Standing gates green; RLS counts 179/16/54/20
- [ ] `GET /api/version` → `schema.applied: 186`, `drift: false`
- [ ] Live QA: no-op save on a REPORT_ONLY card leaves `infos` byte-identical
- [ ] Live QA: `/write-check` `readOnly:true` steps 1–6 green
- [ ] Live QA: refresh-token-only request to a step-up action → **403**
- [ ] Live QA: endpoint change → `endpoint_changed`
- [ ] Live QA: wrong password → next read fails `auth`
- [ ] QA card `…7671` Active, no override; probe flag unset
- [ ] **You have reviewed and approved**

---

## Phase 1.5 — The Capability Promotion System

**This is the new phase, and it is what makes "build for production, prove in QA" real.**

**Goal:** every EFS write capability is a named, per-org, individually-promotable fact, backed by recorded proof, promoted only by a platform admin, and only when the proof demonstrably transfers.
**Why it must come before Phases 3–7:** every operation those phases add needs a capability key on day one. Retrofitting is far more expensive, and shipping even one operation without a per-org gate reintroduces exactly the "on for QA means on for production" hazard of §0.4(b).

### 1.5.1 — The model

```
  apps/api  (whitelisted egress, has EFS)         apps/admin-api  (no EFS, shares DB)
  ┌───────────────────────────────┐               ┌──────────────────────────────────┐
  │ runs the OEG proof on QA org  │               │ platform admin reviews the proof │
  │        ↓ writes               │               │        ↓ writes                  │
  │  efs_capability_proofs        │──────────────▶│  efs_capability_promotions       │
  │        ↑ reads at write time  │               │  (org × capability × state)      │
  │  loadCardControlAccess        │◀──────────────┘                                  │
  └───────────────────────────────┘               └──────────────────────────────────┘
```

**Capability keys** — one per write operation, stable strings:

```
card_lock            card_unlock          override_grant       override_clear
prompts_set          override_limits      delete_override      hand_enter
limits_set           refreshing_limits    refreshing_override  time_restrictions
locations_set        location_groups      card_transfer        card_pin
card_replace         managed_fuel
```

**Promotion states:** `unproven → proving → proven → enabled`, plus `denied` and `suspended`.

**The transfer rule — the heart of it.** A proof recorded on org A promotes org B **only if all four hold**:

1. The proof's five OEG results are all green.
2. `proof.document_shape === targetOrg.observed_document_shape`.
3. For every field this capability writes, `proof.vocabulary[field] === targetOrg.observed_vocabulary[field]` — byte-identical, casing included.
4. A platform admin explicitly promotes it, with step-up and a reason.

Rules 2 and 3 are the generalisation of C-1 and the H1 casing incident into a mechanism. Today both are human discipline; here they become a check the system performs.

### Step 1.5.2 — Schema

**Change** Migration **0187_efs_capability_promotions.sql** (idempotent):

```sql
create table if not exists efs_capability_proofs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,  -- org PROVEN ON (QA)
  capability text not null,
  oeg1_entitled boolean not null,
  oeg2_zero_edit_echo boolean not null,
  oeg3_change_landed boolean not null,
  oeg4_vocabulary_matched boolean not null,
  oeg5_reverted boolean not null,
  apply_latency_ms int,
  endpoint_host text not null,
  document_shape text not null,
  vocabulary jsonb not null,          -- { field: exact string observed }
  card_last4 text,
  request_xml_redacted text,
  response_xml_redacted text,
  run_by uuid references auth.users(id) on delete set null,
  run_at timestamptz not null default now()
);

create table if not exists efs_capability_promotions (
  org_id uuid not null references organizations(id) on delete cascade,
  capability text not null,
  state text not null default 'unproven'
    check (state in ('unproven','proving','proven','enabled','denied','suspended')),
  proof_id uuid references efs_capability_proofs(id) on delete set null,
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  reason text,
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, capability)
);
```

Both RLS-enabled with **no policies** — service-role only, with the 0106-style "and why" comment. Also add `observed_document_shape text` and `observed_vocabulary jsonb` to `efs_card_control_settings`, refreshed by the mirror sweep and by `/account-inventory`.

> **Deliberately not `org_modules`.** That table is commercial ("what the customer bought"), constrained to six keys, and RLS-enforced for tenant visibility. Operational provenance ("EFS accepted this operation shape on this account") is a different fact with a different lifecycle; conflating them would make a probe failure read to the customer as a billing change. Migration `0173`'s own header anticipated this extension: *"a module key becomes a fifth AND and nothing else changes."* We are adding a sixth.

**Verify** `GET /api/version` → `schema.applied: 187`, `drift: false`. `pnpm test:rls` — counts unchanged, and add matrix cases proving neither new table is reachable by an authenticated tenant client.

**Rollback** Additive; unused tables are harmless.

---

### Step 1.5.3 — The sixth ANDed fact

**Change**
- `efsCardControlAccess.ts` `loadCardControlAccess:57`: take an optional `capability` argument. When present, load the promotion row and refuse unless `state === 'enabled'`. Add `blockedBy: "not_promoted"` and `blockedBy: "capability_suspended"` to `cardCapabilitiesSchema:231-240`.
- `routes/fuelCards/control/prepare.ts`: each intent passes its capability key.
- **Migrate the deploy-wide operation flag.** `EFS_CARD_DELETE_OVERRIDE_ENABLED` (`env.ts:231`) becomes the `delete_override` capability. Keep the env var for one release as an additional AND (it can only make things stricter), then remove it. This is §0.4(b) made concrete.
- Backfill: for orgs already at `write_entitlement='confirmed'`, seed `card_lock`, `card_unlock`, `override_grant`, `override_clear`, `prompts_set` as `enabled` with `reason: 'backfilled from Phase B write_entitlement'`. **Nothing that works today stops working.**

**Verify**
1. *"a capability that is not promoted is refused with not_promoted"*.
2. *"a suspended capability is refused even when write_entitlement is confirmed"*.
3. *"the five Phase B capabilities are enabled after backfill"* — run against a seeded fixture.
4. **Deployed:** every existing card-control action on QA still works, unchanged.

**Rollback** Revert; the capability check disappears and behaviour returns to the four ANDed facts.

---

### Step 1.5.4 — The proof runner

**Change**
- New `apps/api/src/services/efsCapabilityProof.ts` — runs the five OEG proofs for a given capability against a given card, and writes an `efs_capability_proofs` row. It reuses `writeProbeRealChange.ts`'s `runStep` / `VERIFY_DELAYS_MS` machinery rather than inventing a second one.
- New route `POST /api/fuel-cards/prove/:capability` — `requireAuth`, `requireOrg`, `requireRole("admin")`, `requireFreshAuth()`, `EFS_CARD_CONTROL_PROBE_ENABLED`, **plus the Step 0.1 org-ownership and production guards**. Body: `{ cardNumber, confirm: "PROVE <last4>" }`.
- It sets `state='proving'` before dispatch and `'proven'` or `'denied'` after, on the **org it ran against** (QA). It never sets `'enabled'` — only a platform admin can do that.
- Vocabulary capture: for each field the capability writes, record the exact string observed in the pre-read document.

**Verify**
1. Unit tests per OEG proof, using the `stub()` pattern: *"records oeg4 false when the vendor's casing differs from ours"* is the important one.
2. *"a failed revert marks the proof failed and says the card is still changed"* — mirroring `writeProbeRealChange.ts:157-160`.
3. **Live QA:** run `POST /api/fuel-cards/prove/card_lock` on `…7671`. All five green, latency recorded ≈ 533ms, card restored. The proof row exists with the QA endpoint host, document shape, and status vocabulary.

**Rollback** Unmount the route.

---

### Step 1.5.5 — The promotion control in the admin console

**Change**
- `apps/admin-api/src/routes/capabilities.ts`, mounted as `app.use("/admin/capabilities", capabilitiesRouter())` — **exactly that literal syntax**, so `routeAuth.test.ts:20` picks it up and auto-covers the 401/403 ladder.
  - `GET /admin/capabilities` — the promotion matrix: every org × every capability, with state, proof summary, and **a computed `transferable` boolean plus a `blockers[]` array** when the shape or vocabulary does not match.
  - `GET /admin/orgs/:id/capabilities` — one org's row set with full proof detail.
  - `POST /admin/orgs/:id/capabilities/:capability` — promote / suspend / deny. Middleware: `requirePlatformRole("platform_owner","platform_admin")` + `requireStepUp` (TOTP recency, `platformAuth.ts:129-135`), matching the existing entitlement route (`orgs.ts:135-174`). Body requires `{ action, reason: 3..500, proofId }`.
  - **Server-side, promotion to `enabled` is refused unless all four transfer-rule conditions hold** — the API must not trust the UI's `transferable`.
- Audit: `writePlatformAudit` with `before`/`after`/`reason` into the immutable `platform_audit_log`, **and** `writeTenantAudit` into the org's own `audit_logs` — the dual-write pattern from `lib/impersonation.ts:126-133`. A capability being enabled on a customer's account is something they should see in their own trail; note that today `module.enable` and `entitlement.grant` are platform-audited only, which is a gap worth not repeating.
- `apps/admin/src/pages/CustomerDetailPage.vue` — a **Capabilities** card between Integrations (`:154`) and Entitlements (`:178`), same shape as those. Each row: capability, state, proof age, `transferable` with blockers spelled out, and a Promote/Suspend button that opens the reason prompt.
- Optionally fill the **"Settings & flags"** nav stub (`AppShell.vue:21-27`) with the cross-org matrix — it is the better home for a comparative QA-vs-production view.

**Verify**
1. `routeAuth.test.ts` passes with the new router discovered — confirm it appears in the parsed list.
2. `apps/admin-api/src/routes/capabilities.test.ts`: *"platform_readonly cannot promote"*, *"promotion without step-up is refused"*, *"promotion without a reason is refused"*, **_"promotion is refused when the proof's document shape differs from the target org's"_**, **_"promotion is refused when the proof's vocabulary differs from the target org's"_**, *"promotion writes both a platform audit row and a tenant audit row"*.
3. **Deployed:** as the platform admin (the org-less dashboard account), open the QA org's Capabilities card — `card_lock` shows `proven`. Promote it on QA → `enabled`. Attempt to promote it on **production** → the UI shows `transferable: false` with the blocker named if shapes or vocabulary differ, and the API refuses even if the request is forged.

**Rollback** Unmount the router and hide the card. Existing capabilities stay in whatever state they were.

---

### Step 1.5.6 — Suspension as the fast per-org kill switch

This replaces v1's Step 1.8 (a platform-wide flag) with something strictly better: the same mechanism, at capability granularity.

**Change**
- `POST /admin/orgs/:id/capabilities/:capability` with `action: "suspend"` sets `state='suspended'` with a reason.
- `loadCardControlAccess` reads it with a short TTL cache (10–30s) so suspension propagates without a redeploy.
- Add a platform-wide `suspend_all` that writes `suspended` across every row for an org, and a global variant across all orgs — one call, no redeploy.
- Keep `EFS_CARD_CONTROL_ENABLED` as the outermost AND: the env var can only ever make things stricter.

**Verify**
1. *"a suspended capability is refused within one TTL"*.
2. *"the env kill switch still blocks even when every capability is enabled"*.
3. **Deployed:** suspend `card_lock` on QA; attempt a lock → 403 within the TTL. **Time the propagation and record it.** Unsuspend; lock works.

**Rollback** Revert; suspension state persists harmlessly.

### ✅ Phase 1.5 Gate

- [ ] `schema.applied: 187`, `drift: false`; RLS matrices prove both new tables are tenant-unreachable
- [ ] Every existing card-control action still works on QA after backfill
- [ ] `EFS_CARD_DELETE_OVERRIDE_ENABLED` is now a per-org capability
- [ ] A full OEG proof for `card_lock` recorded on QA, all five green, latency recorded
- [ ] Platform admin can promote on QA and is **blocked** from promoting to production when shape or vocabulary differ — proven server-side, not just in the UI
- [ ] Promotion dual-audits into `platform_audit_log` and the tenant's `audit_logs`
- [ ] Capability suspension propagation time measured and recorded
- [ ] **You have reviewed and approved**

---

## Phase 2 — Read parity

**Goal:** the app faithfully shows **everything the account has configured**. No writes. This is where "our app must not differ from our policy and account settings" is satisfied on the read side.
**Scoped by:** Phase 0, especially Q10 and Q12.

| Step | Change | Verify |
|---|---|---|
| **2.1 Model every field** | Extend `wsCardSchema` with the fields Q12 found unmodelled (known: `payrollAtm/Chk/Ach/Wire/Debit`). Parse them in `parseCardDocument:266-337`. Add `WsCardRefreshingLimits`, `WsCreditLimits` to `efsAccountContract.ts` | New fixture `getCardV2.production.xml` (redacted real document). **The parity tripwire test**: *"every element in the production document is represented in WsCard"* — walk the fixture's element names, assert none are silently dropped. This fails the day EFS adds a field. Zero-edit echo of the new fixture is order-stable (Step 1.3's loop picks it up) |
| **2.2 Surface what's parsed but dropped** | `read.ts:304-311` — include `locationGroups`, `locations` (blocklist), `locationSource`, payroll flags. `cardControlModel.ts` `limitRows:264-276` — render `autoRollMap`/`autoRollMax` with copy stating **`autoRollMax = 0` means no daily maximum, not unlimited**. Widen `useEfsCards.ts:70`. New sections in `CardEffectiveConfig.vue` | *"auto-roll max of zero is described as no daily maximum"*. `lint:tokens` + `lint:tokens-parity`. Visual: a production card with location groups shows the same group ids the inventory recorded |
| **2.3 Real limits** | Card detail also calls `getCardRefreshingLimits`, cached like `efsPolicyCache`, graceful null on failure. Account-level `getCreditLimits` per contract on the index page. Extend `mergeEffectiveConfig` for `refreshingLimitSource` (`D`/`C`/`B` — `efsCardCatalog.ts:147`, currently a dead constant) | Merge tests per source value. *"a refreshing-limits failure degrades to null without failing the page"*. **Deployed: values match Phase 0's inventory field for field — this comparison is the parity proof** |
| **2.4 Policy parity view** | Per-policy panel: `handEnter`, `infos`, `limits`, `timeRestrictions`, the four `*Source` fields, policy refreshing limits. On card detail, make card-vs-policy origin unambiguous via the existing `EffectiveOrigin` vocabulary | Component tests per origin badge. **Deployed: each policy page matches the inventory record exactly** |
| **2.5 Mirror staleness** | Raise `EFS_CARD_SYNC_MAX_DETAIL` above the production card count (199 → 250+) or make the sweep adaptive. Surface `absent_since` in `EFS_CARD_LIST_COLS:33-34`. Fix the roster-only `card_version: ""` case (`efsCardMirror.ts:291-292`) — show "not yet read from EFS" instead of a 409 claiming the card changed | *"a card first seen by the roster reports not-yet-read, not card_state_changed"*. **Deployed:** after one sweep, every production card has `detail_synced_at`; count equals roster count |

### ✅ Phase 2 Gate

- [ ] `getCardV2.production.xml` committed (redacted); parity tripwire green
- [ ] Every field in the production document is modelled
- [ ] Card detail shows prompts, limits (with auto-roll), refreshing limits, time restrictions, location groups, blocklist, hand-entry, all four sources, policy origin
- [ ] Account view shows credit headroom per contract
- [ ] **Side-by-side against `docs/25-EFS-ACCOUNT-INVENTORY.md` shows zero discrepancies** — the phase's real deliverable
- [ ] Every card has `detail_synced_at` after one sweep
- [ ] **You have reviewed and approved**

---

## Phase 3 — Prompts: the full surface, driven by the account

**Depends on:** Phase 0 Q1–Q4; Phase 1 Steps 1.1/1.2/1.3; Phase 1.5.
**Capability keys:** `prompts_set` (already enabled via backfill) — but the **widened** surface is gated behind a fresh proof, because it writes new field/value combinations.

| Step | Change | Verify |
|---|---|---|
| **3.1 Discover, don't hardcode** | Expose `getPromptTypes` results, cached per org. `efsCardCatalog.ts:214` — `EFS_EDITABLE_INFO_IDS` becomes a **runtime-resolved** set (intersection of `getPromptTypes` with `EFS_INFO_LABELS`), with the hardcoded pair as fallback. `promptInputSchema.infoId` → `z.string()` validated against the resolved set at request time; `validationType` → `z.enum(EFS_VALIDATION_TYPES)` — **all seven**. Enforce `DYNAMIC` → `{CNTN,PPIN,DRID}` via `EFS_DYNAMIC_INFO_IDS:144`. Add `value` (accrual), required when `ACCRUAL_CHECK`. Add optional `lengthCheck`/`minimum`/`maximum`. Remove the 2-prompt array cap (`:338`) | Contract tests: each type accepted; `DYNAMIC` with `UNIT` rejected; `ACCRUAL_CHECK` without `value` rejected; unknown `infoId` rejected. *"falls back to DRID/UNIT when getPromptTypes is unavailable"*. **Live QA:** the endpoint's set matches Q1 exactly, **including casing** |
| **3.2 Odometer following end to end** | `promptsEdits` writes `value` for `ACCRUAL_CHECK` instead of hardcoding `"0"` (`:239`). Display it as what it is: *"Driver enters the odometer; the pump rejects a reading more than N miles from the last one."* Add the accrual input | *"an ACCRUAL_CHECK prompt carries its accrual value onto the wire"* asserting exact `<value>` bytes in `s.bodies[1]`. **Full OEG via `POST /api/fuel-cards/prove/prompts_set`** on `…7671` — OEG-4 checks `validationType` casing against Q4. Record in `docs/22` |
| **3.3 Add / edit / remove, one at a time** | Per-prompt `Edit…`, an `Add prompt…` listing available IDs minus those on the card, and an explicit `Remove this prompt` danger button. Confirmation lists **every** add, change and removal by name and value | *"can add a prompt the card does not have"*, *"cannot add one already on the card"*, *"removal requires the explicit control and names the prompt"*. **Live QA:** add a prompt to a card that has none — this exercises Step 1.3's sequence fix on a real document |
| **3.4 Promote** | Platform admin promotes `prompts_set` (widened) for production, only if shape and vocabulary transfer | Promotion succeeds or is blocked with a named reason. Either outcome is a valid result — **a block is the system working** |

### ✅ Phase 3 Gate

- [ ] Prompt IDs come from `getPromptTypes`, not a constant
- [ ] All seven validation types reachable, `DYNAMIC` constrained
- [ ] `ACCRUAL_CHECK` (odometer following) settable with its accrual value, and displayed correctly
- [ ] Add / edit / remove are three distinct explicit actions
- [ ] Full OEG proof recorded; promotion attempted for production with a recorded outcome
- [ ] QA card back to its original prompts
- [ ] **You have reviewed and approved**

---

## Phase 4 — Override with amount (the p194 product-limits recipe)

**Depends on:** Step 1.3 — non-negotiable; the recipe introduces a `limits` collection onto cards that may have none.
**Capability key:** `override_limits` — new, starts `unproven`.
**Simplified by your answer:** clearing the override **does** restore the card's original limits, so no snapshot-and-restore machinery is needed. We still verify it once (Step 4.2 item 5) rather than trusting it silently — the cost is one QA call and the downside of being wrong is free fuel.

| Step | Change | Verify |
|---|---|---|
| **4.1 Contract + edit builder** | `grantOverrideSchema:301` gains optional `limits: z.array(z.object({ limitId, limit: 0..EFS_LIMIT_MAX, hours: 0..999, minHours: 0..999 })).max(10)`. `overrideGrantEdits:93` appends `{op:"replaceAll", name:"limits", records}` when present — **that single edit is the p194 recipe**; the guard verifies intent and `replaceAll` is the declared intent. Require `scope.kind === "all"` when limits are present (the recipe sets `overrideAllLocations = true`). Require step-up whenever limits are present, regardless of `uses`. Remove the stale non-goal line from the docblock | *"a product-limit override sends the p194 limits array"* — assert `s.bodies[1]` contains exactly `<limits><hours>1</hours><limit>1000</limit><limitId>ULSD</limitId><minHours>0</minHours></limits>` for the guide's own example, **in sequence position**. *"…on a card with no existing limits places limits before locationGroups"*. *"…requires step-up"*, *"…requires scope=all"*. `limit > 9999` rejected; unknown `limitId` rejected |
| **4.2 Prove on QA** | No code — `POST /api/fuel-cards/prove/override_limits` | 1. `read_state` → record `limits`, `override`, `overrideAllLocations`, `locationOverride`, `cardVersion`. 2. **OEG-2** zero-edit echo, version unchanged. 3. **OEG-1/3** grant `{limitId:"ULSD", limit:100, hours:1, minHours:0}`, `uses:1`; re-read within `[0,3000,5000]`; assert `override=1`, `overrideAllLocations=true`, limits exactly as sent; record latency. 4. **OEG-4** `limitId` casing byte-identical to Q5. 5. **Confirm the restore behaviour**: clear the override, re-read, assert the card's **original** limits are back. 6. **OEG-5** full restore proven by re-read. 7. Record in `docs/22` |
| **4.3 UI** | `CardOverridePanel.vue` — optional "Also raise a product limit": product select from the account's limit IDs, amount, window hours, min hours. Units spelled out via `formatLimit`/`limitUnit` — **gallons for fuel and DEF, dollars otherwise**. Confirmation names product, amount **with unit**, window, uses. Diff region shows `Limits: <before> → <after>` | *"the confirmation names the product, amount and unit"*, *"an amount above 9999 is rejected before submit"*, *"choosing a product forces scope to all locations"*. **Live QA:** end to end from the UI, confirmed against `read_state`, then cleared |
| **4.4 Promote** | Platform admin promotes `override_limits` for production | Promotion recorded with proof id and reason |

### ✅ Phase 4 Gate

- [ ] Product-limit override works end to end, proven live on QA
- [ ] The restore-on-clear behaviour confirmed by observation, not assumption
- [ ] Sequence ordering holds on a card with no pre-existing limits
- [ ] Full OEG recorded; promotion outcome recorded
- [ ] QA card restored
- [ ] **You have reviewed and approved**

---

## Phase 5 — The drawer redesign

**Goal:** one trigger → one drawer → one operation, over a shared shell.
**Sequencing note:** placed after Phases 3–4 so those features migrate onto the shell rather than being built twice. If you would rather have the UX fix sooner, it can move ahead of Phase 3 — the cost is building the prompts and override UI twice. **Tell me which you prefer before execution starts.**

### Step 5.1 — `CardOperationDrawer.vue`

**Change** A thin wrapper over `SlideOver` (`size="lg"`), fixed six-region anatomy (header · intent summary · inputs · **what will change** · reason · footer), with seven invariants:

1. **Snapshot on confirm** — freeze payload + diff when Confirm is pressed → D2
2. **Pause reseeding while dirty** — banner, not overwrite → D3, D4
3. **Dirty guard** on ESC / scrim / ✕ / Cancel → D12, A7, A8
4. **Result state stays in the drawer**, with a history link and, for `sent`, a **disabled** retry → D11, D13, A9
5. **Step-up predicted**, not discovered → D10
6. **Disabled = explained** → D14, A6
7. **Environment badge** in the header when the endpoint is production, **plus the capability's promotion state** → L-4, and it makes the Phase 1.5 model visible where it matters

Reuse only existing primitives: `SlideOver`, `AppButton`, `AppFormField`, `AppInput`, `AppCombobox`, `DataTable`, `BADGE_BASE`/`toneClass`, `useToastStore`, `StepUpPrompt`, `KebabMenu`, `EfsLocationPicker`. There is **no `ConfirmDialog` and no `EmptyState`** — confirmations replace the body; empty states are `DataTable`'s `empty-text`.

**Lift verbatim** from `CardControlDrawer.vue` — the strongest, test-covered parts: per-intent idempotency keys (`:98-101`), re-mint-on-settle with the `sent` exception (`:196-197`), the re-entrancy guard (`:183`), the card-identity reseed (`:124-145`).

**Verify** `CardOperationDrawer.test.ts`, one `it` per invariant, each named for the defect: *"freezes the payload when Confirm is pressed, so a background refetch cannot change what is sent"*, *"does not wipe operator input when the card version changes mid-edit"*, *"warns before discarding a dirty form on ESC"*, *"keeps the idempotency key after a 'sent' outcome"*, *"predicts step-up before the operator submits"*, *"names the missing input on a disabled confirm button"*. Existing `CardControlDrawer.test.ts` still green.

### Step 5.2 — Migrate the operations

One commit each: Lock, **Deactivate (new — on Active *and* Hold, fixing D8)**, Unlock, Grant exception, Remove exception (fixing D9 — shown whenever uses > 0 **or** a scope field is armed), Edit prompts.

Also here: **wire the `reason` field** so `CardMutationHistory`'s `Why` column stops being permanently blank, and reconcile `docs/22:434-435` (documents reason as required) with `cardControlContract.ts:255-258` (made it optional). And add the **"What will change"** diff to every operation — the single highest-value addition (D5).

**Verify** Per operation: diff content, confirmation copy, four result states. **Live QA per operation** with before/after `read_state`. Delete `CardControlDrawer.vue` and its test only when all have migrated and its assertions are re-homed; `lint:filesize` green.

### Step 5.3 — Trigger placement

Detail page: replace the single `Card actions…` (`FuelCardDetailPage.vue:84`) with an **Actions card** grouped *Card status* / *Fuel access* / *At the pump*, omitting out-of-scope operations and naming who to ask. List page: `KebabMenu` column on `FuelCardsPage.vue:169-177`. `ActiveOverridesPanel.vue:60`: `Remove exception…` per row. `CardEffectiveConfig.vue`: `Edit…` per prompt/limit/time row.

**Verify** *"a yard manager without the override scope sees no Grant exception button and is told who to ask"*. **Manual:** the 2am path — list → kebab → Lock card… → confirm. **Two interactions, down from six.** Accessibility: focus moves to the confirmation heading; ESC during step-up cancels the step-up, not the drawer; every section has `aria-labelledby`; every disabled button has a reason.

### ✅ Phase 5 Gate

- [ ] Every operation has its own trigger and drawer
- [ ] Every operation shows a "what will change" diff before confirming
- [ ] D1–D14 closed, each with a named test; A1–A11 closed
- [ ] Design-contract breaks fixed: `size="lg"`, footer actions, no magic heights, `aria-labelledby`, `space-y-6`
- [ ] `reason` reaches the ledger; the `Why` column populates
- [ ] Promotion state visible in the drawer header
- [ ] Old `CardControlDrawer.vue` deleted
- [ ] **You have reviewed and approved**

---

## Phase 6 — Write parity

**Goal:** every setting the account uses becomes **editable**. Scoped strictly by Phase 0 — do not build editors for capabilities the account does not use.
**Every operation gets a capability key, a full OEG proof on QA, and an explicit promotion.**

| # | Operation | Capability | Change | Notes |
|---|---|---|---|---|
| **6.1** | **Hand-entry policy** | `hand_enter` | One enum field on `setCardv2`; new intent, scope, drawer. Danger confirm moving **to** ALLOW; step-up on ALLOW | Cheapest security win in the list. **OEG-4 is critical** — a string field, exactly the H1 failure class |
| **6.2** | **Product limits editor** | `limits_set` | Same `replaceAll` edit Phase 4 proved. Per-product `limit`/`hours`/`minHours`/`autoRollMax`; `limit ≤ 9999`; gallons-vs-dollars enforced in the UI | Verify `autoRollMax = 0` behaves as "no daily maximum" |
| **6.3** | **Refreshing / velocity limits** | `refreshing_limits` | New write op `setCardRefreshingLimits` in `apps/api/src/lib/efsCardLimitsWrite.ts`. **This op does not go through the echo engine** — discrete payload, not a full document. Needs its own landed-check (re-read via `getCardRefreshingLimits`) and its own ledger intent | **OEG-1 first**: the account may not be entitled — `writeProbe.ts:328,382` already carries text telling the operator to ask WEX to enable it |
| **6.4** | **The `…OVER` refreshing override** | `refreshing_override` | The fourth p194 recipe: `setCard` as in Phase 4, then `setCardRefreshingLimits` against `<cardNumber>OVER` | **Two calls, can half-fail.** Needs its own ledger representation with an explicit partial state and a documented manual recovery. **Add an explicit half-failure test**: what do the ledger and UI say when call 1 lands and call 2 does not? |
| **6.5** | **Time restrictions** | `time_restrictions` | `replaceAll` on `timeRestrictions`. Day is **1 = Sunday**; the date part of `beginTime`/`endTime` is meaningless (always `1970-01-01`) | Verify against `serverTime` for timezone sanity |
| **6.6** | **Blocked locations + groups** | `locations_set`, `location_groups` | `locations` is a **blocklist** — the guide is explicit. Group editing uses the eight `LocGrp*` ops, not `setCardv2`. Gate on `getCarrierInfo.locationGroups` and `WSLocationGroupDescription.editable` | **Do not build group editing unless Q8 says the account uses groups** |

**Common verification for every operation here**
1. Unit test asserting exact request bytes, including sequence position.
2. A **`no_change` tripwire**: a write with the wrong vocabulary casing must be caught by the re-read and settle as `failed`, **never** silently as success.
3. Full OEG proof on QA via `POST /api/fuel-cards/prove/<capability>`, recorded in `docs/22`.
4. Explicit promotion to production with reason, or a recorded block.
5. A parity re-check: after the write, the app's display matches a fresh `/account-inventory` read.

### ✅ Phase 6 Gate

- [ ] Every capability Phase 0 found in use on the account is editable
- [ ] Every new write op has a full OEG proof and a promotion decision recorded
- [ ] `setCardRefreshingLimits` entitlement answered (OEG-1)
- [ ] The `…OVER` two-call op has an explicit half-failure state in ledger and UI
- [ ] Parity comparison against a fresh inventory shows zero discrepancies
- [ ] QA cards restored
- [ ] **You have reviewed and approved**

---

## Phase 7 — Advanced

| # | Item | Note |
|---|---|---|
| **7.1** | **The capacity bridge** — size `ULSD` gallon limits from measured `sensor_capacity_gal` | The genuine differentiator. **Guard the unit trap:** an EFS `limit` is per reset window (`hours`) and capped at 9999; tank capacity is a one-shot physical bound. Never let `resolveCapacity` output reach a limit without an explicit tested conversion and a headroom cushion |
| **7.2** | **Maker-checker** | `approved_by` exists in `0177` and nothing writes it. The `planCardMutation`/`applyCardMutation` seam (`efsCardControl.ts:189`/`:279`) is already built |
| **7.3** | **Revert path** | `before_document` is stored for exactly this. **Blocked on Step 2.1** — revert cannot restore fields `WsCard` does not model |
| **7.4** | **Card lifecycle** — `replaceLostOrStolenCard`, `reissueDamagedCard`, `transferCard`, `setCardPin` | Capabilities `card_replace`, `card_transfer`, `card_pin`. High-consequence: typed confirmation, step-up required, PIN never rendered or logged |
| **7.5** | **`managedFuelAction`** — route-locked fueling | Capability `managed_fuel`. The most product-differentiating EFS primitive we are not using (`docs/22:180-183`) |
| **7.6** | **M-5** — per-minute limits in shared storage | Before scaling past one API replica |
| **7.7 · HUMAN** | **Check the WSDL into the repo** at `docs/efs/CardManagementWS.wsdl` with a retrieval date, plus a CI check that every operation name we call still exists in it | **Do this early and cheaply** — it is the tripwire for vendor drift |

---

## Appendix A — Traceability

| Finding | Step |
|---|---|
| C-1 QA entitlement carries to production | 1.5 + **Phase 1.5 transfer rule** |
| C-2 `EFS_SOAP_ENVIRONMENT` enforces nothing | 1.5 |
| C-3 probe/experiment bypass every gate | **0.1** |
| H-1 step-up bypassable via refresh token | 1.4 |
| H-2 no non-production guard | 0.1 + 1.5 |
| H-3 rotation ≠ revocation | 1.6 |
| H-4 no instant kill switch | **1.5.6** (per-capability suspension) |
| H-5 redaction misses 10–11 digit PANs | 1.7 |
| M-1 optional `Idempotency-Key` | 1.7 |
| M-2 `deleteOverride` never reconciled | 1.7 |
| M-3 no step-up on `/efs-soap/enable` | 1.5 |
| M-4 audit gaps, best-effort writes, retention | 1.5 + 1.7 |
| M-5 per-process rate limits | 1.7 (documented) → 7.6 |
| M-6 plaintext `soap_password` | 1.7 |
| M-7 no `.gitleaks.toml` | 1.7 (HUMAN) |
| CI has no `needs:` edges → bad merge can `db push` | 1.7 (HUMAN) — **and §0.7's clean-clone verify until fixed** |
| L-1 no maker-checker | 7.2 |
| L-2 no revert path | 7.3 (blocked on 2.1) |
| L-3 unsafe env default | 1.5 |
| L-4 environment invisible in UI | 5.1 |
| L-5 status daily cap fails open | Documented; deliberate |
| E-1 xsd:sequence ordering | **1.3** |
| E-2 no orchestration deadline | 1.7 |
| E-3 attributes dropped / text trimmed | 2.1 (parity tripwire surfaces it) |
| `flying j` fault unhandled | 1.7 |
| `errorNumber`/`errorDesc` as success | 1.7 |
| Issue #1 — prompts add/switch/options | 1.1, 1.2, **3.1–3.4** |
| Issue #2 — override amount | **4.1–4.4** |
| Issue #3 — account/policy parity | **0.4, 2.1–2.5, 6.1–6.6** |
| Issue #4 — drawer UX | **5.1–5.3** |
| **NEW: build for production, prove in QA** | **Phase 1.5 in full** |
| D1–D14 | 1.1 (D1) + 5.1–5.3 |
| A1–A11 | 5.1–5.3 |
| Five SmartFunds payroll flags unmodelled | 2.1 |
| Mirror staleness / 200-card budget | 2.5 |
| `absent_since` not surfaced | 2.5 |
| Roster-only `card_version: ""` → false 409 | 2.5 |
| `getPromptTypes` never called | 3.1 |
| `getCreditLimits` never called | 0.2 + 2.3 |
| Refreshing limits absent | 0.2 + 2.3 + 6.3 |
| `handEnter` read-only | 6.1 |
| Location groups / blocklist not surfaced | 2.2 + 6.6 |
| `autoRollMap`/`autoRollMax` invisible | 2.2 |
| Capacity conflation | 7.1 |
| `managedFuelAction` unused | 7.5 |
| WSDL not in repo | 7.7 (do early) |

## Appendix B — Migrations

| # | Purpose | Step |
|---|---|---|
| `0185` | `probed_endpoint_host`, `probed_document_shape`; mutation `environment`, `endpoint_host`, `card_last4` | 1.5 |
| `0186` | Sealed `soap_password` | 1.7 |
| `0187` | `efs_capability_proofs`, `efs_capability_promotions`; `observed_document_shape`, `observed_vocabulary` on settings | 1.5.2 |
| `0188+` | Reserved for Phase 6 ledger intents (refreshing limits, `…OVER` partial state) | 6.3, 6.4 |

All idempotent (`IF NOT EXISTS`), RLS-enabled with no policies, 0106-style comment. Verified by `pnpm lint:migrations` and `GET /api/version` → `schema.applied` / `drift: false`.

## Appendix C — Environment variables

| Var | Change | Step |
|---|---|---|
| `EFS_ALLOW_PRODUCTION_PROBE` | **New**, default `false`. Legitimately deploy-wide: it discriminates by the org's own credential environment | 0.1 |
| `EFS_SOAP_ENVIRONMENT` | Default `production` → `sandbox` | 1.5 |
| `EFS_CARD_DELETE_OVERRIDE_ENABLED` | **Migrated to the `delete_override` capability**; kept one release as an extra AND, then removed | 1.5.3 |
| `EFS_CARD_WRITE_TIMEOUT_MS` | Becomes **live** (currently dead) | 1.7 |
| `EFS_CARD_SYNC_MAX_DETAIL` | Raised above the production card count | 2.5 |

**No new per-operation env vars.** §0.4(b) — one deploy serves both orgs, so an operation flag must be a per-org row.
Remember the parser: `s.toLowerCase() === "true"`. `1`/`yes`/`on` are silently false.

## Appendix D — Standing rules for the execution session

1. **One step, one commit.** Work on a `delivery-<phase>` branch; verify in a clean clone; merge only after the gate is green and approved.
2. **Never edit an applied migration.** New numbered file only, idempotent.
3. **Never leave a QA card dirty.** Every live run ends with OEG-5 and a proving re-read.
4. **Always unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy** after any live session that needed it.
5. **Never assume vendor vocabulary.** Every string field we write is checked against Phase 0 Q4 first. The H1 incident is the precedent: a mis-cased write returns an identical void success and is silently discarded.
6. **A successful write is not evidence of a correct write.** Only a re-read is.
7. **Every new write operation gets a capability key on the day it is written** — never retrofitted.
8. **A blocked promotion is the system working**, not a bug to route around. If a proof will not transfer, find out why before forcing it.
9. **If a verify fails, stop.** Do not proceed; report and re-plan.
10. **Record every live EFS finding** in `docs/22-EFS-CARD-CONTROL.md` in the H1 format, whether it confirms or refutes the expectation.
