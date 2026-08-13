# EFS Card Control — Capability Architecture

**Date:** 2026-08-13
**Scope:** the design only. Sequencing lives in `docs/24-…-PLAN.md`; the evidence for these decisions lives in `docs/26-…-PLAN-AUDIT.md`.
**Status:** design for review. Nothing here is implemented.

---

## 1. The problem, stated precisely

Adding one EFS write operation today touches nine files plus a migration, with nothing enforcing that you touched all nine. That is why the surface has stayed at five operations for months.

But "make it a registry" is not the design. The real problem is that the current orchestrator **conflates three independent concerns** and hardcodes all three:

| Concern | Hardcoded to |
|---|---|
| **Targeting** — what object am I mutating, how do I read it, what makes a stale write | one card, `getCardv2`, a sha256 of the card document |
| **Mutating** — how do I produce the write | `setCardv2` with an echo of the response DOM |
| **Verifying** — how do I know it landed | re-read the same card with `getCardv2`, run `intentLanded` |

Five operations fit because those five were designed together. Twelve of the remaining families do not. The architecture below separates the three concerns and lets a capability choose independently in each dimension.

**Design goal:** adding an operation is one contract file, one behaviour file, one view file, and — only when it introduces a new `intent` or `scope` — three lines of SQL. Everything else is generated or enforced.

---

## 2. The shape

```
Capability  =  Contract  ×  Behaviour  ×  View

Behaviour   =  Target  ×  Mutation  ×  Verification  ×  Governance
```

`Target`, `Mutation` and `Verification` are chosen independently. That is the whole idea — v3's "two kinds" collapsed them into one axis and broke on the first operation whose state lives outside the card document.

```
                        ┌──────────────────────────────────────┐
                        │  packages/shared/src/efs/            │
                        │  capabilities/<key>.contract.ts      │
                        │                                      │
   browser-safe.        │  key · intent · scope · route        │
   NO api imports.      │  schema · writeBucket · auditAction  │
                        │  ui spec · vocabularyFields          │
                        │  emittableValues · carriesSecret     │
                        └────────────┬─────────────┬───────────┘
                                     │             │
              type Body = z.infer<…> │             │ type Body
                                     ▼             ▼
      ┌──────────────────────────────────┐   ┌─────────────────────────────────┐
      │ apps/api/src/efs/capabilities/   │   │ apps/web/src/features/fuelCards/│
      │ <key>.behaviour.ts               │   │ capabilities/<key>.view.ts      │
      │                                  │   │                                 │
      │ target · mutation · verify       │   │ confirmation · inputs · diff    │
      │ stepUp × 2 · precondition        │   │                                 │
      │ auditMeta · redaction · proof    │   │                                 │
      └──────────────────────────────────┘   └─────────────────────────────────┘
```

Three artifacts is **forced, not chosen**: `apps/web` cannot import `apps/api` (zero such imports exist today), and `buildEdits(doc: CardDocument)` binds to a live XML DOM that must never enter the browser bundle. The three are type-linked through `type Body = z.infer<typeof schema>` exported from the contract, so a mismatch is a compile error, not a runtime surprise.

---

## 3. The four axes

### 3.1 Target — what is being mutated

```ts
type Target =
  | { kind: "card" }
  | { kind: "cardPair" }        // transferCard: from + to
  | { kind: "policy" }
  | { kind: "group" }
  | { kind: "account" };        // createInfoLimitCard — returns a NEW object
```

The target determines three things the orchestrator needs and the capability does not implement:

| Derived from target | For `card` | For non-card |
|---|---|---|
| How the target is resolved from the request | `efs_cards.id` → sealed PAN, org-scoped | target-specific |
| What optimistic-concurrency token exists | `cardVersion(doc)` — sha256 of the canonicalised document | **none.** `expectedVersion` is `null` and the check is skipped |
| What the ledger keys on | `efs_card_id` | `target_kind` + `target_ref` |

**`expectedVersion` is a property of the target, not of every write.** A location group has no document and no version. Making that explicit is what stops non-card operations from being contorted into the card ledger.

### 3.2 Mutation — how the write is produced

```ts
type Mutation<TBody> =
  | { kind: "echo";   buildEdits: (doc: CardDocument, body: TBody) => CardEdit[] }
  | { kind: "direct"; dispatch:   (ctx: DispatchCtx, body: TBody) => Promise<SetCardResult> }
  | { kind: "sequence"; steps: readonly Step<TBody>[] };

interface Step<TBody> {
  label: string;                        // shown in the UI when a sequence half-fails
  mutation: Exclude<Mutation<TBody>, { kind: "sequence" }>;   // no nesting
  verify: VerifyPlan<TBody>;            // each step verifies independently
}
```

Three things this encodes:

- **`echo` is the only kind that touches the echo engine.** It gets `assertEchoFidelity`, the `replaceAll` preservation assertion, and sequence-order checking for free. Nothing else does, and nothing else needs to.
- **`direct` returns a thunk the orchestrator calls.** The capability never dispatches. That is what keeps the ledger-before-dispatch and never-retry-a-write invariants unconditional rather than per-capability discipline.
- **`sequence` cannot nest.** One level, ordered, each step independently verified. The `…OVER` recipe is `[echo setCard, direct setCardRefreshingLimits]`.

### 3.3 Verification — how landing is judged

```ts
interface Snapshot {
  doc: CardDocument | null;    // present when target.kind === "card"
  extra?: unknown;             // e.g. WsCardRefreshingLimits
}

type Landing = "landed" | "not_landed" | "indeterminate";

interface VerifyPlan<TBody> {
  /** Names its OWN read ops. This is the axis v3 could not express. */
  snapshot: (ctx: ReadCtx) => Promise<Snapshot>;
  judge: (before: Snapshot, after: Snapshot, body: TBody, edits: readonly CardEdit[]) => Landing;
}
```

Two decisions worth defending.

**`Landing` is three-valued, not boolean.** The current code returns a boolean and then patches "we could not tell" with a second-look retry. Making indeterminacy explicit means the second look fires for the right reason, and — more importantly — a capability that genuinely cannot judge (a card ordering op whose fulfilment horizon is days) can say so instead of lying.

**`snapshot` names its own reads.** `setCardRefreshingLimits` writes state that is not in the card document; its snapshot is `getCardv2` **plus** `getCardRefreshingLimits`. This single change is what removes the need for a third and fourth capability "kind."

For the common case there is one shared implementation:

```ts
export const cardEchoVerify = <T>(): VerifyPlan<T> => ({
  snapshot: async (ctx) => ({ doc: await getCardV2(ctx.env, ctx.creds, ctx.cardNumber, ctx.opts) }),
  judge: (before, after, _body, edits) =>
    !after.doc ? "indeterminate"
    : intentLanded(before.doc!, after.doc, edits) ? "landed" : "not_landed",
});
```

Most echo capabilities write `verify: cardEchoVerify()` and think no further.

### 3.4 Governance — who may, when, and how loudly

```ts
interface Governance<TBody> {
  /** Body only. Runs BEFORE prepare(), so a refusal never spends a rate-limit slot. */
  preflightStepUp?: (body: TBody) => boolean;

  /** Runs AFTER the fresh read, with everything the decision actually needs. */
  planStepUp?: (ctx: PlanCtx, snap: Snapshot, body: TBody) => boolean;

  /** Throws ActionRefusalError. Runs after the fresh read, before buildEdits. */
  precondition?: (snap: Snapshot, body: TBody) => void;

  auditMeta?: (snap: Snapshot, body: TBody) => Record<string, unknown>;

  /** Default redactCardXml. MANDATORY when contract.carriesSecret is true. */
  redactRequest?: (xml: string) => string;
  redactResponse?: (xml: string) => string;
}
```

**The step-up split is not cosmetic.** The three gates that exist today fire at different times with different inputs:

| Gate | When | Needs |
|---|---|---|
| override uses > 3 | before `prepare()` | body only |
| unlock a Fraud-flagged card | after the fresh read | the card's *current* status, not the mirror's |
| DRID removal | after the fresh read | `promptsEdits(doc, prompts).removedInfoIds` **and** `body.allowRemoveDriverId` |

A single `stepUp(body, doc?)` called once up front makes two of the three **silently disappear** while every field is present and every fitness assertion passes. Splitting them makes the timing a type-level fact.

---

## 4. What a capability may not do

The capability is **data plus pure-ish functions**. The orchestrator owns every side effect except the vendor call itself, and that is deliberate:

| Invariant | Enforced by |
|---|---|
| A ledger row exists before any dispatch | Orchestrator writes it; capability has no DB handle |
| A write is never retried | Orchestrator passes `retry: false`; `dispatch` receives opts, does not construct them |
| Every write is followed by a verifying re-read | `verify` is **required**, not optional, in the type |
| The audit row is written once, by one place | Capability supplies `auditMeta`; orchestrator writes |
| PAN never reaches a log unredacted | Orchestrator applies `redactRequest`/`redactResponse`; capability cannot log |
| Rate limits and promotion are checked before anything | Orchestrator; capability is not consulted |

If a capability needs to break one of these, that is a design signal to extend the orchestrator — not a reason for the capability to reach around it.

---

## 5. The orchestrator

Five phases, each its own module, each under the 200-line function cap.

```
  ┌─ prepare ─────────────────────────────────────────────────────────┐
  │ 1  deploy kill switch                                             │
  │ 2  Idempotency-Key parse (required)                               │
  │ 3  access: 4 ANDed facts + scope + CAPABILITY PROMOTION           │
  │ 4  credentials                                                    │
  │ 5  target resolve (org-scoped; 404 not 403)                       │
  │ 6  preflightStepUp(body)          ← body only, BEFORE the limiter │
  │ 7  enforceCardWriteLimit          ← LAST, so a refusal is free    │
  └────────────────────────────────────┬──────────────────────────────┘
                                       ▼
  ┌─ plan ────────────────────────────────────────────────────────────┐
  │ 8  org hourly cap            (fail-closed)                        │
  │ 9  in-flight check           (fail-closed)                        │
  │ 10 before = verify.snapshot(ctx)                                  │
  │ 11 version check — SKIPPED when target has no version             │
  │ 12 planStepUp(ctx, before, body)                                  │
  │ 13 precondition(before, body)                                     │
  │ 14 edits = mutation.buildEdits(before.doc, body)   [echo only]    │
  │ 15 INSERT ledger row  status=pending, capability_key, request_body│
  └────────────────────────────────────┬──────────────────────────────┘
                                       ▼
  ┌─ dispatch ────────────────────────────────────────────────────────┐
  │ 16 ledger → status=sent, attempts=1                               │
  │ 17 per step (sequence) or once:                                   │
  │      echo   → assertEchoFidelity → setCardV2                      │
  │      direct → mutation.dispatch(ctx, body)                        │
  │    errors HELD, not thrown. echo_unfaithful short-circuits.       │
  └────────────────────────────────────┬──────────────────────────────┘
                                       ▼
  ┌─ verify ──────────────────────────────────────────────────────────┐
  │ 18 after = verify.snapshot(ctx)                                   │
  │ 19 landing = verify.judge(before, after, body, edits)             │
  │ 20 if not "landed": sleep EFS_CARD_VERIFY_RETRY_MS, re-snapshot,  │
  │    re-judge. A failed second look never downgrades a first.       │
  └────────────────────────────────────┬──────────────────────────────┘
                                       ▼
  ┌─ settle ──────────────────────────────────────────────────────────┐
  │ 21 updateMirror (best-effort, card targets only)                  │
  │ 22 finalize: landed | failed | unverified | unsent                │
  │ 23 audit row (once)                                               │
  └───────────────────────────────────────────────────────────────────┘
```

**Changes from today, and only these:**

| # | Change | Size |
|---|---|---|
| 1 | Step 3 gains the capability promotion check | small |
| 2 | Step 6 is new and sits **before** step 7 | small |
| 3 | Steps 10/18 call `verify.snapshot` instead of `getCardV2` | small |
| 4 | Step 11 is conditional on the target | small |
| 5 | Step 17 switches on `mutation.kind` instead of the `vendorOp` ternary | small |
| 6 | Step 19 calls `verify.judge` instead of `intentLanded` | small |
| 7 | **Step 17 loops for `sequence`, writing `step_index` between steps** | the real work |

v3 claimed this was "~6 lines, the only orchestrator change the plan needs." Items 1–6 are indeed small. **Item 7 is not**, and neither is the fact that every one of 3, 4, 6 and 21 is where the safety lives. Generalising dispatch is easy; generalising verification is the job.

### 5.1 Sequences and partial state

A sequence is **one ledger row with a `step_index`**, not one row per step. This matters: `uq_efs_card_mutations_one_pending` is per-row, so a sequence does not fight it, and a resumed sequence keeps its idempotency key and its audit identity.

```
step 0  echo setCardv2 ────► verify ──► landed ──► step_index = 1
step 1  direct setCardRefreshingLimits(cardNumber + "OVER") ──► verify ──► landed
                                                                    │
                        ┌───────────────────────────────────────────┴──┐
                        ▼                                              ▼
                  all steps landed                           step N not landed
                  status = succeeded                    status = partial, step_index = N
                                                        UI: "step 1 of 2 applied — <label>"
```

`partial` is a **terminal-but-actionable** state, alongside the existing four outcomes. Recovery is re-running from `step_index` (steps must be idempotent) or the documented manual path. The UI must name the step by its `label`, not by a number.

### 5.2 The ledger, and the seam we are not building yet

Card targets keep `efs_card_mutations` unchanged except for four additive columns:

```sql
capability_key  text        -- the FINE key. intent stays the coarse audit key.
request_body    jsonb       -- redacted. Without this, a reconciler cannot re-judge.
step_index      int         -- sequences
-- and: status CHECK widened with 'partial'
```

`capability_key` and `request_body` together are what make **background reconciliation of direct operations actually work.** A row read out of the database can now find its descriptor and re-run `verify.judge` with the original body. Without both, `landed` can only be a function of the after-state — which is true for exactly one existing capability and false for every one we are adding.

**Non-card targets do not get a ledger yet.** The orchestrator talks to a `LedgerAdapter` with one implementation:

```ts
interface LedgerAdapter {
  insertPending(ctx, plan): Promise<{ id: string }>;
  markSent(id): Promise<void>;
  settle(id, outcome): Promise<void>;
  findReplay(ctx): Promise<Outcome | null>;
  assertNoneInFlight(ctx): Promise<void>;
}
```

This is a **seam, not a second table.** No account-scoped operation is scheduled for the next several slices, and possibly none ever ships — `LocGrp*` is conditional on the account using location groups, `setPolicy` is an explicit non-goal, ordering is speculative. Building `efs_object_mutations` now would violate the rule that the abstraction may only accommodate cases that exist in code today.

What the seam buys: when the first account-scoped op arrives, the work is bounded and known — a second adapter over a table with the same columns minus `expected_version`, `before_document`, `after_document`, plus `target_kind`/`target_ref`, and a one-in-flight index on `(target_kind, target_ref)`. Write that down; do not build it.

---

## 6. The three artifacts, concretely

### 6.1 Contract — `packages/shared/src/efs/capabilities/overrideGrant.contract.ts`

```ts
export const overrideGrantContract = defineContract({
  key: "override_grant",
  intent: "override_grant",             // coarse, DB-CHECK-constrained, persisted
  scope: "override",
  route: { method: "POST", path: "/:id/override" },
  writeBucket: "card_override",
  auditAction: "card.override_granted",
  schema: grantOverrideSchema,

  carriesSecret: false,

  /** Vendor string fields this capability sends — the scanner's surface. */
  vocabularyFields: ["overrideAllLocations"],
  /** What it can emit, so the scanner has something to compare against. */
  emittableValues: { overrideAllLocations: ["true", "false"] },

  ui: {
    title: "Grant fuel exception",
    verb: "Grant exception",
    tone: "warning",
    inputs: [
      { name: "uses", control: "stepper", min: 1, max: 9, label: "How many purchases" },
      { name: "scope", control: "radio", options: ["all", "location"] },
      { name: "limits", control: "limitEditor", optional: true },
    ],
    diffRows: ["override", "overrideAllLocations", "locationOverride", "limits"],
  },
});

export type OverrideGrantBody = z.infer<typeof grantOverrideSchema>;
```

Browser-safe by construction: zod, plain data, no DOM, no api import.

### 6.2 Behaviour — `apps/api/src/efs/capabilities/overrideGrant.behaviour.ts`

```ts
export const overrideGrantBehaviour = defineBehaviour(overrideGrantContract, {
  target: { kind: "card" },

  mutation: {
    kind: "echo",
    buildEdits: (doc, body) => overrideGrantEdits(doc, body.uses, body.scope, body.limits),
  },

  verify: cardEchoVerify<OverrideGrantBody>(),

  preflightStepUp: (body) => body.uses > CARD_OVERRIDE_STEP_UP_ABOVE_USES || Boolean(body.limits),

  precondition: (snap, body) => {
    if (body.limits && body.scope.kind !== "all") {
      throw new ActionRefusalError("A product-limit override applies to all locations.", "invalid_request");
    }
  },

  auditMeta: (snap, body) => ({
    overrideUsesBefore: snap.doc!.card.overrideUses,
    overrideUsesAfter: body.uses,
    overrideScope: body.scope.kind,
    limits: body.limits ?? null,
  }),

  proof: {
    precondition: (snap) => (snap.doc!.card.overrideUses ?? 0) === 0,   // OEG-3: before ≠ target
    sample:  () => ({ uses: 1, scope: { kind: "all" }, expectedVersion: "", reason: "" }),
    revert:  (before) => ({ /* restores before.doc's override fields */ }),
  },
});
```

### 6.3 View — `apps/web/src/features/fuelCards/capabilities/overrideGrant.view.ts`

```ts
export const overrideGrantView = defineView(overrideGrantContract, {
  confirmation: (body, card) => ({
    tone: "warning",
    title: `Allow ${body.uses} ${body.uses === 1 ? "purchase" : "purchases"} outside the card's limits?`,
    body: body.limits
      ? `${card.maskedRef} may buy up to ${formatLimit(body.limits[0])} at any location, ${body.uses} times.`
      : `${card.maskedRef} may fuel outside its normal limits ${body.uses} times, ${scopeLabel(body.scope)}.`,
    confirmLabel: "Grant exception",
    busyLabel: "Granting…",
    doneLabel: "Exception granted",
  }),
  diff: (before, body) => [
    row("Exception", describeOverride(before), describeOverride({ ...before, uses: body.uses })),
    ...(body.limits ? [row("Product limit", describeLimits(before.limits), describeLimits(body.limits))] : []),
  ],
});
```

### 6.4 What each registry index does

| Index | Consumers |
|---|---|
| `packages/shared/src/efs/registry.ts` | the intent union, labels, the write-bucket table, the fitness test's shared half |
| `apps/api/src/efs/registry.ts` | the generated router, the orchestrator's descriptor lookup, the reconciler's `capability_key` lookup, the harness |
| `apps/web/src/features/fuelCards/capabilities/registry.ts` | the drawer's operation list, the trigger menus, the mutation hooks |

---

## 7. What is generated, and what is enforced

### 7.1 Generated

| Artifact | From |
|---|---|
| The Express router — one loop, no hand-written handlers | api registry + contract `route` |
| The five web mutation hooks — today five identical seven-line shapes where only `path`, `method` and one body spread vary | contract `route` |
| The drawer's operation list, triggers, and input rendering | contract `ui` + view |
| The promotion table's key set | contract `key` |
| The harness's proof runs | behaviour `proof` |
| The config scanner's comparison set | contract `vocabularyFields` + `emittableValues` |

### 7.2 Enforced by the cross-registry fitness test

Bidirectional, with a **non-empty-discovery guard** — the failure mode `routeAuth.test.ts` documents and currently exhibits.

- every contract has exactly one behaviour and one view, and vice versa
- every contract's `intent` is in `CARD_MUTATION_INTENTS`; every intent has ≥1 contract *(many-to-one — `override_clear` is one intent with two mechanisms)*
- every capability's **mounted path** resolves through `cardWriteLimits.PATTERNS` to **exactly** its declared bucket — **equality, not existence**, because `cardWriteBucket` returns `null` on a miss and the limiter **treats null as allow**
- `carriesSecret: true` ⟹ `redactResponse` is overridden
- `mutation.kind === "sequence"` ⟹ every step has its own `verify`
- `target.kind !== "card"` ⟹ the behaviour does not reference `expectedVersion`
- **three CHECK constraints, parsed from the whole migration directory, last-one-wins**: `0177` intent, `0177` status, `0173` approver scopes. Reading only `0177` goes stale the first time anything is widened
- every source comment naming a `*.test.ts` names a test that exists

### 7.3 Enforced by types

- a capability cannot omit `verify` — it is required
- a capability cannot dispatch — `direct.dispatch` receives opts it did not construct
- `sequence` cannot nest — `Exclude<Mutation, {kind:"sequence"}>`
- `Body` is shared across all three artifacts via `z.infer`, so a contract change breaks the behaviour and the view at compile time

---

## 8. How each operation family maps

| Operation | Target | Mutation | Verify snapshot | Notes |
|---|---|---|---|---|
| lock · unlock · deactivate | card | echo | `getCardv2` | |
| prompts set | card | echo | `getCardv2` | `precondition` rejects `infoSource = POLICY` |
| override grant (± limits) | card | echo | `getCardv2` | `replaceAll` on `limits` = the p194 recipe |
| override clear | card | echo **or** direct | `getCardv2` | **One intent, two capability keys.** The many-to-one case |
| hand-entry · time restrictions · blocked locations · product limits | card | echo | `getCardv2` | |
| `setCardRefreshingLimits` | card | direct | `getCardv2` **+ `getCardRefreshingLimits`** | The operation that forced the `verify` axis |
| the `…OVER` override | card | **sequence** | per step | `[echo setCard, direct setCardRefreshingLimits(card+"OVER")]` |
| `setCardPin` | card | direct | `getCardv2` | `carriesSecret: true` — the response echoes the PIN |
| `transferCard` | **cardPair** | direct | both cards | ⚠️ one-in-flight protects one card; a transfer can race a lock on the destination. **Name and mitigate before S7 ships** |
| `LocGrp*` | group | direct | `getLocGrpLocs` | needs the second `LedgerAdapter` |
| `createInfoLimitCard` | account | direct | the returned card number | a *create*; no before-state |
| `managedFuelAction` | account | direct | — | bulk, N cards per call. Not a card mutation |

Twelve families, four axes, no new "kinds."

---

## 9. Alternatives rejected

Recording these so the design can be argued with rather than merely followed.

**A single `landed(after, body): boolean`.** Rejected: `setCardRefreshingLimits`' state is not in the card document, so no function of `CardDocument` can judge it; and `body` is not persisted, so it cannot be reconstructed for background reconciliation. The `verify` axis exists to solve both.

**Two capability kinds (echo / direct).** Rejected: it collapses Target, Mutation and Verification onto one axis. Four of twelve families fit. Adding kinds as they fail is how a taxonomy becomes a switch statement.

**Five kinds (echo / card-direct / foreign-verify / account / bulk).** Rejected as the *opposite* error — `foreign-verify` is not a kind, it is a `verify.snapshot` that reads something else. Making it a kind duplicates every other axis inside it.

**Generalise `efs_card_mutations` to `efs_mutations` now.** Rejected: it is a risky migration of the one table that must never lose fidelity, in service of operations that may never ship. The `LedgerAdapter` seam gives the same optionality for the cost of an interface.

**One descriptor file with the web bits stripped at build time.** Rejected: it makes the module graph a build-tool concern, and a bundler mistake ships the SOAP client to the browser. Three files, type-linked, fail at compile time instead.

**Generate the migration from the registry via `lint:codegen`.** Rejected on two grounds: `lint:codegen` **does not run in CI** today, so it is decoration; and a migration is append-only and immutable once applied, so a generator that rewrites a pushed file silently diverges from production. Provide a scaffold that *prints* the SQL; let a human allocate the number.

**Drop the `intent` CHECK constraint.** Rejected: `intent` is the audit answer to "what was done to this card." An unconstrained text column lets a typo write a row no consumer's `z.enum` can parse, in the one table that must never lose fidelity.

**A TTL cache on the promotion lookup.** Rejected: `loadCardControlAccess` issues live queries per request, which is *why* per-org suspension is instant. A cache would make the kill switch slower.

---

## 10. Migration path

The architecture is reachable from today's code without a big-bang rewrite.

```
  step 0   Characterisation tests on `main`
           ~10 route-level tests asserting the DISPATCHED XML BYTES for each of the five
           routes, against recorded fixtures. Today nothing exercises route → spec, so
           "the tests still pass" proves nothing. This is what makes step 3 verifiable.

  step 1   Introduce the types. No behaviour change. defineContract/defineBehaviour/defineView
           compile; nothing consumes them yet.

  step 2   Migrate ONE capability — card_lock — end to end. Both the old spec and the new
           descriptor exist; the router uses the descriptor for lock only. Prove the whole
           pipeline: generated route, orchestrator, harness, promotion, drawer.

  step 3   Migrate the remaining four, one commit each. After each, the characterisation
           suite must pass BYTE-IDENTICALLY.

  step 4   Delete CardMutationIntentSpec and the hand-written handlers. `control.ts` becomes
           a factory. lint:filesize drops two violations.

  step 5   First new capability (hand-entry, S6) written descriptor-first. If it needs
           anything not in §3, that is the design's first real test — extend the axis,
           do not contort the capability.
```

**Step 2 is the pilot and it is not optional.** Migrating an operation that already works is how you find out whether the registry, the harness, the promotion model and the drawer shell actually compose — before betting a feature on it.

The gate for step 3 is inverted from the obvious one:

> **Faithful iff the characterisation suite passes byte-identically, AND the only tests that changed are the route-enumeration fixtures, converted from hardcoded literals to registry iteration.**

"No existing test may change" is the wrong gate: `fuelCardsControl.test.ts:90` iterates a hardcoded five-entry `WRITE_ROUTES` array, and converting it is exactly the edit that must happen. A gate that forbids it selects for the unsafe outcome.

---

## 11. What this design does not solve

Stated plainly, because an architecture that claims completeness is lying.

- **`transferCard`'s two-card race.** One ledger row protects one card. The destination can be locked concurrently. Needs either a two-row protocol or an advisory lock, and neither is designed here.
- **Asynchronous fulfilment.** Card ordering "lands" days later, physically. `Landing` can return `indeterminate`, but nothing polls. Ordering needs a job, not a mutation.
- **Bulk.** `managedFuelAction` takes an array. One ledger row per call loses per-card attribution; one row per card breaks the one-in-flight index. Undesigned, and correctly out of scope.
- **Cross-capability invariants.** Nothing prevents granting an override on a card being transferred. The one-in-flight index catches the concurrent case; the sequential case is unmodelled.
- **The echo guard's `replaceAll` blind spot** is fixed by an assertion (see `docs/24` F0.1b), not by this architecture. Every `echo` capability using `replaceAll` depends on that fix landing first.

---

## 12. Why this is the right shape

Three tests, and it passes all three.

**Does it make the common case trivial?** A new echo capability is a contract of plain data, `mutation: { kind: "echo", buildEdits }`, `verify: cardEchoVerify()`, and a view. Everything else — the route, the hook, the ledger, the rate limit, the audit row, the promotion key, the proof run, the drawer — comes free.

**Does it make the hard case possible without deforming the common one?** `setCardRefreshingLimits` supplies a different `verify.snapshot`. The `…OVER` recipe supplies `sequence`. Neither adds a field to, or changes the shape of, an echo capability.

**Does it fail loudly at the boundary?** An operation that does not fit — `LocGrp*` with no card, ordering with a fulfilment horizon of days — cannot be expressed. It will not compile. That is the point: the taxonomy's job is to be honest about what the orchestrator can and cannot guarantee, and the four safety invariants in §4 are guarantees only because non-card operations are shut out until the second `LedgerAdapter` exists.

The five operations that exist today were designed together, which is why they fit any abstraction fitted to them. This design was drawn from the twelve that do not.
