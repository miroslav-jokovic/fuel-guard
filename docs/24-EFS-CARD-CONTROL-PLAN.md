# EFS Card Control — Architecture & Delivery Plan (v4)

**Date:** 2026-08-13
**Supersedes:** v1, v2, v3
**Companions:** `docs/23-…-FINDINGS-2026-08-12.md` (what is wrong) · `docs/26-…-PLAN-AUDIT.md` (why this plan changed — the rationale for every correction below)
**Status:** Plan only. Execution starts in a new session.

> **v4 exists because v3 was audited and failed in six places.** Three were load-bearing: the echo guard is a tautology for `replaceAll`; the "configuration match" proof covered ~7% of what it was applied to; the registry taxonomy fitted 4 of 12 operation families. Five further claims were confirmed false **by running the repo's own code**. Appendix C lists every correction. Read `docs/26` for the evidence; this document is what to do about it.

---

## 0. Blockers — resolve before writing any code

Four decisions and one question. None takes more than a day; all of them change the shape of what follows.

| # | Blocker | Why it blocks |
|---|---|---|
| **B0** | **Why is `lint:filesize` red on `main`?** Eight files over the 500-line budget — five of them card control — plus `samsara.ts` grew 16 lines past its pin. Is this gate in the required CI set? | Every step below says "standing gates green" as a precondition. Today that is unsatisfiable. Either the gate is not enforced (in which case say so and stop citing it) or `main` is broken |
| **B1** | **Descriptor shape** — §2.2 below. `verify(ctx)` not `landed(doc, body)`; explicit `target` discriminant; `preflightStepUp` / `planStepUp` split; `redactResponse` hook | Wrong shape = a rewrite in S5/S6 rather than a two-day decision now |
| **B2** | **Key model** — `intent` is the **audit** key (coarse, DB-constrained, stable); `key` is the **capability** key (fine, code-only). **Many-to-one, not a bijection.** `override_clear` already proves it: one intent, two dispatch mechanisms | The reconciler fix, the promotion model and the fitness test all depend on which key is which |
| **B3** | **Approver-scope backfill rule.** `efs_card_control_approvers.scopes` defaults to the four current values and is CHECK-constrained (`0173:65-66`). Promote a capability with a new scope and **every existing approver is silently denied it** | Decide once: does a legacy grant imply new scopes, or does each slice backfill? Discovering this in S3 means a promoted capability nobody can use |
| **B4** | **Three-artifact split is forced, not chosen.** `apps/web` cannot import `apps/api` (zero such imports exist), and `buildEdits(doc: CardDocument)` binds to a live XML DOM that must not enter the browser bundle | Determines the fitness test's real job: cross-checking three registries, not iterating one |

---

## 1. Where we actually are

### 1.1 Built and working

The expensive parts exist: SOAP transport (session cache, single-flight login, breaker, mTLS, cookie jar, per-lane pacing) · the echo-from-response-DOM design · orchestration (ledger before dispatch, always re-read, second look, four honest outcomes, never retry a write, DB-enforced one-pending-per-card) · the mirror with sealed PANs · four ANDed access facts with approver scopes and fail-closed caps · five working intents · a drawer, effective-config view, location picker and mutation history · `/diagnose`, `/write-check`, `/experiment` · an injectable `fetchImpl` threaded through **every** call in an operation, 9 recorded XML fixtures, and a test convention where every `it` names the defect it prevents.

> ⚠️ **This list was assembled partly from the codebase's own self-descriptions, and at least one of those is false.** `efsCardEdits.ts:152` claims *"`efsCardEdits.test.ts` proves it with a record carrying a nested child"* — no such test exists (`grep -ci nest` → 0). **Treat §1.1 as a hypothesis, not a baseline.** F0 includes a cheap fitness check that reconciles comment claims against reality.

### 1.2 The seam that already exists

`CardMutationIntentSpec` (`efsCardControl.ts:129-139`) is a proto-descriptor, and **adding a pure echo intent today requires zero orchestrator changes.** That is real and it is why this is an extraction for the five existing intents.

**It is not why it generalises.** Those five were designed together. §2.3 shows the taxonomy fits 4 of 12 remaining families.

### 1.3 Broken in ways that block the plan

| # | Defect | Blocks |
|---|---|---|
| **D-A** | 🔴 **The echo guard is a tautology for `replaceAll`.** Request side: `renderCollection` → `serializeRecord(record)`. Expectation side: `recordFromObject(record)` — **the same `replace.records` array**, with `dropCollection` deleting the original from the expectation first. Two functions rendering one input is one route with two spellings. **The `reportValue` data-loss bug passed this guard.** | S3, S4, S5, S6 — every `replaceAll` slice |
| **D-B** | `editsLanded` checks `replaceAll` by **count only**; `appendRecord` is an **empty branch** (unconditionally landed) | Reconciliation of every Phase-C write |
| **D-C** | `routeAuth.test.ts` **does not discover `/api/fuel-cards`.** Ran its own regex: 26 routers, fuel-cards absent — the multi-router mount at `app.ts:222` defeats `[^)]*?`. Six routers including every write route are invisible | The entire fitness strategy |
| **D-D** | Route gate tests iterate a **hardcoded five-entry `WRITE_ROUTES` literal**. Registry-generated routes are covered by none of them | F1's verification |
| **D-E** | **No `request_body` column** in the ledger, so a `landed` needing the request body cannot be reconstructed from a DB row | Background reconciliation of direct ops |
| **D-F** | `serializeRecord` emits fields in **`Object.entries` order** — whatever order someone typed the object literal — while unedited records use document order. `canonicalize` sorts by path, so the guard is blind to it. **For an `xsd:sequence` type this is the sequence bug one level deeper** | S3, S4 |
| **D-G** | `lint:filesize` red on `main` (B0) | Every step |

### 1.4 Honest completion

**~70% of the write engine. ~0% of the proof machinery.** v3 implied the latter was well advanced because §1.1 listed "test infrastructure" as built. The harness, the scanner, `efs:prove`, `efs:scan`, and both promotion tables are net-new.

---

## 2. Architecture

### 2.1 What the registry must solve

Adding one operation today touches nine files plus a migration, with nothing enforcing that you touched all nine. That is why the surface has stayed at five.

### 2.2 The descriptor (B1)

**Four kinds, not two.** The taxonomy is driven by *what is targeted* and *how landing is verified* — not by how the write dispatches.

```ts
type Target =
  | { kind: "card" }        // resolved from req.params.id — the ledger's home ground
  | { kind: "cardPair" }    // transferCard: from + to. TWO cards, one ledger row today
  | { kind: "policy" }      // setPolicy, deleteInfoLimitCard
  | { kind: "group" }       // the eight LocGrp* ops
  | { kind: "account" };    // createInfoLimitCard (returns a NEW card), ordering ops

interface VerifyResult { landed: boolean; after?: CardDocument; evidence: unknown }

interface CapabilityBehaviour<TBody> {
  target: Target;

  /** ONE of these. */
  echo?:   { buildEdits: (doc: CardDocument, body: TBody) => CardEdit[] };
  direct?: { dispatch: (ctx: DispatchCtx, body: TBody) => Promise<SetCardResult> };
  compound?: { steps: readonly CapabilityStep[] };   // ordered; see §2.4

  /** Names its OWN read op and its OWN target. Replaces landed(doc, body). */
  verify: (ctx: VerifyCtx, body: TBody) => Promise<VerifyResult>;

  /** Split, because these fire at different times with different inputs. */
  preflightStepUp?: (body: TBody) => boolean;                    // before prepare(); body only
  planStepUp?: (ctx: PlanCtx, doc: CardDocument, body: TBody) => boolean;  // after fresh read

  precondition?: (doc: CardDocument, body: TBody) => void;       // throws ActionRefusalError
  auditMeta?: (doc: CardDocument, body: TBody) => Record<string, unknown>;

  /** Defaults to redactCardXml. MANDATORY override when the response echoes a secret. */
  redactResponse?: (xml: string) => string;

  proof: ProofPlan;
}
```

Three corrections encoded here, each from a confirmed defect:

- **`verify(ctx)` replaces `landed(doc, body)`** because `setCardRefreshingLimits`' state is not in the card document, and because the request body is not persisted (D-E). A capability names its own read.
- **`preflightStepUp` / `planStepUp` are separate** because the override gate fires *before* `prepare()` (body only) while the fraud-unlock and DRID-removal gates fire *after* the fresh read and need inputs in neither `body` nor `doc`. A single `stepUp(body, doc?)` called once up front makes **two of three gates silently disappear** while every fitness assertion passes.
- **`redactResponse` is mandatory when the response carries a secret.** `setCardPin`'s documented output *is the PIN*; a 4-digit value matches no redaction rule and the ledger is retention-forbidden.

### 2.3 Which operations fit which kind

| Kind | Operations | Ledger |
|---|---|---|
| **echo** | lock · unlock · prompts · override grant · override clear (echo path) · `handEnter` · time restrictions · blocked locations · product limits | `efs_card_mutations`, unchanged |
| **direct** | `deleteOverride` · `setCardRefreshingLimits` · `setCardPin` | Same, with `verify` naming its own read |
| **compound** | the `…OVER` refreshing override | **Needs a widened `status` CHECK and an explicit partial state.** §2.4 |
| **account** | the eight `LocGrp*` ops · `createInfoLimitCard` / `deleteInfoLimitCard` · `setPolicy` · card ordering · `managedFuelAction` | **Does NOT use the card ledger.** Own, simpler audit path — §2.5 |

`transferCard` is `cardPair` and is the one genuinely awkward case: two cards, one `efs_card_id` column, and the one-pending index protects only one of them, so a transfer can race a lock on the destination. **Deferred to S7 with that risk named**, not smuggled into `card`.

### 2.4 Compound operations are a first-class problem

The `…OVER` recipe is `setCard` **then** `setCardRefreshingLimits` against `<cardNumber>OVER`. The orchestrator dispatches exactly one write per plan, and `uq_efs_card_mutations_one_pending` **structurally forbids** two pending rows on one card.

This needs, explicitly and in the same migration window as everything else in F1: a widened `status` CHECK with a `partial` state · a `step_index` on the ledger row · a UI that says *which half landed* · and a documented manual recovery. **Do not let this arrive as "just another capability" in S5.**

### 2.5 Account-scoped operations do not use the card ledger

`createLocGrp` takes a group name and returns a group id. There is no card, no `expectedVersion`, no `efs_card_id` — **no ledger row can be inserted at all**, and all four orchestration guarantees are unavailable.

Do not contort the card ledger to hold them. They get a simpler path: an `audit_logs` row with before/after, a `verify` re-read of the account-scoped object, and no `expectedVersion` optimistic concurrency. **Say this in the descriptor's type, so the compiler enforces it.**

### 2.6 Three artifacts, one capability (B4)

Forced by the module graph, not chosen:

| Artifact | Location | Holds |
|---|---|---|
| **Contract** | `packages/shared/src/efs/capabilities/<key>.contract.ts` | `key`, `intent`, `scope`, `route`, `schema`, `writeBucket`, labels, declarative `ui` spec |
| **Behaviour** | `apps/api/src/efs/capabilities/<key>.behaviour.ts` | Everything in §2.2 |
| **View** | `apps/web/src/features/fuelCards/capabilities/<key>.view.ts` | Confirmation copy, input components, diff renderer |

The fitness test's real job is **cross-checking three registries**, in both directions.

### 2.7 The key model (B2)

- **`intent`** — the audit key. Coarse, DB-CHECK-constrained, stable, persisted. Answers *"what was done to this card."*
- **`key`** — the capability key. Fine, code-only, free. Answers *"which descriptor produced it."*
- **Many-to-one.** `override_clear` is one intent with two mechanisms.
- **Add `capability_key` to the ledger** so the reconciler can find the right descriptor. This is what makes background reconciliation of direct ops actually work.

### 2.8 The fitness test

Copy `routeAuth.test.ts`'s mechanism **and fix its bug first** (D-C). Assert, both directions:

- every `CARD_MUTATION_INTENTS` value has ≥1 contract; every contract's `intent` is in the union
- every contract has exactly one behaviour and one view
- every capability's **mounted path** matches `cardWriteLimits.PATTERNS` and resolves to **exactly the declared bucket** — equality, not existence. `cardWriteBucket` returns `null` for an unmatched path and the limiter **treats null as allow**, so a mismatch is silently unmetered
- every capability declares a `proof` plan and (where its response carries a secret) a `redactResponse`
- **three CHECK constraints, parsed from the whole migration directory, last-one-wins**: `0177` intent, `0177` status, `0173` approver scopes. Reading only `0177` goes stale the first time you widen anything
- every source comment referencing a `*.test.ts` names a test that exists (catches the D-A class of self-reported proof)
- **non-empty-discovery guard** — the failure mode `routeAuth.test.ts` documents and currently exhibits

### 2.9 What this is not

Not a plugin system, not dynamic loading, not a DSL. A typed array of objects that several consumers iterate — **within each app**. Resist cleverness.

**The abstraction may only accommodate cases that exist in code today.** A field added "for S7" with no S7 implementation is speculative and gets deleted.

---

## 3. The proof model

### 3.1 Two halves, three states

WEX will not align QA to production, so a strict vocabulary match would block everything. Split the proof — but **honestly**, which v3 did not.

| Half | Where | Proves |
|---|---|---|
| **Protocol** | QA cards | The wire works: entitled, edit shape accepted, echo faithful, change lands, revert works |
| **Configuration** | Production, **read-only** | The values we *would* send match production's actual vocabulary and format |

The configuration half reports **three** states, not two:

`match` · `mismatch` · **`unobserved` — and `unobserved` BLOCKS promotion.**

v3 treated "no observed value" as "no discrepancy." That launders absence of evidence into evidence of safety, and it is the modal case: S3's whole purpose is widening to 24 Info IDs that are **by definition not in use**; `handEnter`'s two writable values may appear on zero production cards; every direct op's payload never appears on a card document at all. Usable evidence exists for roughly **2 of ~30** capabilities.

**With `unobserved` blocking, most capabilities will not promote on the scan alone.** That is the honest answer, and it promotes the **production canary card** from "fallback we expect not to use" to the primary path for everything the scan cannot cover.

Three implementation rules:

1. **Scan raw wire text, never `doc.card`.** The typed view is where format information is destroyed: `boolOrNull` accepts `true/1/y/yes` and returns a boolean, so `false` and `0` are indistinguishable; `locationOverride` collapses **both `"0"` and `"1"` to null**; `leafText` collapses nil and empty, a distinction the echo engine treats as load-bearing.
2. **Descriptors declare their emittable value set**, not just field names. A list of field names gives the scan nothing to compare against.
3. **The scan output is machine-readable JSON**, committed. `docs/25-EFS-ACCOUNT-INVENTORY.md` is generated from it.

### 3.2 The OEG, corrected

| # | Proof | Scope | Notes |
|---|---|---|---|
| **OEG-1** | Entitled | per capability | All ops confirmed enabled on the account |
| **OEG-2a** | **Echo fidelity** — `assertEchoFidelity` passes | **per capability × per document shape, LOCAL AND READ-ONLY** | Runs before dispatch on bytes built from a document. **Run it against all 199 production cards today, free.** v3 left this on the table |
| **OEG-2b** | **`cardVersion` unchanged after a no-op dispatch** | **per edit-shape × document-shape, QA ONLY** | Requires a write, so **never obtainable for production.** The promotion record carries that as a named residual risk |
| **OEG-3** | Change lands within `[0, 3000, 5000]`ms; latency recorded | per capability | **Before-state must differ from target-state, asserted from the planning read, or the run is void.** `vendorNormalisedOnly` treats a case-only diff as benign, so a proof starting in the target state reports success for a silently-ignored write — the exact H1 failure |
| **OEG-4** | Vocabulary byte-match for `vocabularyFields` | per capability | The H1 lesson |
| **OEG-5** | Revert lands, proven by re-read | per capability | |

v3 claimed OEG-2 was "per document shape, not per capability." Wrong twice: with `edits = []` the serializer **never reaches** `renderNewField`, the header-append loop, the new-field append, or the new-collection append — the four blocks where the sequence bug lives. And it cannot run on production at all.

### 3.3 QA cards — assigned by starting state, not by slice

Thirteen cards. **Real PANs — keep them out of the repo** (`lint:secrets` scans tracked content). Last-4 only.

| Role | Count | Required starting state |
|---|---|---|
| Status | 2 | One Active, one Hold |
| Prompts | 3 | One with `infoSource=CARD`, one `POLICY`, **one that must keep an EMPTY `<infos>`** |
| Override / limits | 3 | **One that must keep an EMPTY `<limits>`**, two with known limits recorded before S4 |
| Access controls | 2 | One with time restrictions, one without |
| **Control** | **2** | **Never written to — and one must be on the SAME policy as an experiment card**, or it controls for nothing |
| Spare | 1 | |

Three ordering hazards v3's role table could not express:

- **Empty-collection cards are consumed by first use.** After S3's first add, that card has `infos` and the empty case is unreprovable on it forever. Hence the reserved cards above.
- **S4 and S5 must not share cards.** S5 rewrites limits, so S4's headline observation — clearing restores the *original* limits — stops testing what it was.
- **A control card on a different policy is a control for nothing**, because a POLICY-sourced change affects only cards on that policy.

### 3.4 The harness will trip the system's own blast-radius controls

Nobody planned for this in v3.

- **Org cap: 50 mutations/hour**, all users, all intents, **including failed rows**, fail-closed. ~40 proofs × (apply + revert) ≈ **80 writes**. The harness trips its own cap mid-suite, and a 503 is **indistinguishable in the proof record from "the vendor refused."**
- **`card_override`: 25/day**, fail-closed. S4 + S5 land near it in one day.
- **In-flight lockout: ~58s** on the same card between a proof's own OEG-3 and OEG-5.

**Required before the first live run:** a harness org-cap exemption (or its own budget) recorded in the ledger as such, and a written **"a proof outcomed `sent`" procedure** — because a `sent` outcome leaves the card blocked *and in an unknown state indefinitely*, at which point "never leave a QA card dirty" is unsatisfiable.

---

## 4. Delivery shape

```
B0–B4  Blockers                        1 day    decisions, not code
F0     Emergency fixes + gate repair   ~1 week  ships immediately
F1     Registry + harness              ~2-3 wk  extraction + the corrections above
F2     Drawer shell                    ~1 week  registry-driven UI

S1  Account & policy visibility        read-only; produces the scan JSON
S2  Card status                        the PILOT — proves the whole pipeline
S3  Driver assignment & prompts        Issue #1 · blocked on F0.1b
S4  Override                           Issue #2 · blocked on F1.1
S5  Spend limits & velocity            first direct + first compound
S6  Access controls                    hand-entry, time, locations
S7  Card lifecycle                     replace, transfer (cardPair), PIN
S8  Advanced                           capacity bridge, managed fuel, maker-checker, revert
```

Estimates are **unverified** — I have no basis for them beyond scope. Treat them as ordering, not commitments.

**Stop criterion:** B0–B4, F0, F1, F2, S2, S3, S4 solves all four reported problems on an architecture that makes the rest cheap. S1 and S5–S8 are the parity long tail.

### 4.1 Verification model (defined once)

**Every commit:** `pnpm lint · lint:filesize · lint:funcsize · lint:migrations · lint:boundaries · lint:tests · lint:upserts · lint:tokens-parity · lint:secrets · typecheck · test · build`, plus **`check-rls`** once F0 wires it in.

`pnpm test` is `node scripts/run-tests.mjs` — verified: it discovers matrices and **fails on a missing RESULT line** (`:24, 97-107`). Pin: `rls` **179** · `hazmat_rls` **16** · `load-lifecycle` **54** · `duty-sessions` **20**.

**Every deploy:** `pnpm verify:live` — compares git HEAD and the highest migration against the deployed `GET /api/version`. ⚠️ Nothing currently makes it run; F0 fixes that.

**Every write capability:** the OEG (§3.2), recorded in `docs/22` in the H1 format, whether it confirms or refutes.

**Delivery:** `delivery-<slice>` branch → gates in a **clean clone** → merge on approval. ⚠️ Workflows trigger independently on `push: main` with zero `needs:`/`workflow_run:` edges, so a merge that breaks every test still runs `supabase db push` against production. **Until F0 fixes that, the clean-clone run is the only thing between a bad commit and the production database.**

> **`lint:boundaries` not covering `apps/api` is doc-sourced and UNVERIFIED.** Confirm on the real tree before relying on it for the `apps/api/src/efs/` placement.

---

## F0 — Emergency fixes and gate repair

Two things are losing data or leaving doors open; three gates do not gate.

| # | Item | Change | Verify |
|---|---|---|---|
| **F0.1** | 🔴 **`reportValue` prompt deletion** | `promptInputSchema` gains `reportValue`; two refines. **Explicit removal field** — `CardEdit.replaceAll` gains `removals: readonly string[]`. `promptsEdits` writes the right field per type and stops hardcoding `reportValue: ""`. Carry it through detail page → drawer → submit; delete the empty-string filter; explicit "Remove this prompt" button | New fixture `getCardV2.reportOnly.xml`. Tests named for the defect. **Live QA:** open drawer, change nothing, save, re-read → `infos` byte-identical |
| **F0.1b** | 🔴 **The `replaceAll` preservation assertion** | The guard gains a check computed from the **response DOM**, not the edit: *every record present before is present after, unless its identity key appears in the edit's explicit `removals` list.* This is the second route the docblock claims to have and does not. **Same change as F0.1's explicit-removal field** | Tests: *"a replaceAll that silently drops a record is refused"* · *"a replaceAll with an explicit removal is allowed"* · **replay the F0.1 bug through the guard and assert it now throws `echo_unfaithful`**. **Blocks S3** |
| **F0.1c** | **`editsLanded` made exact** | `replaceAll` compares record *identity sets*, not counts. `appendRecord` compares against the before-document instead of the empty branch | *"a replaceAll that landed the wrong records does not report succeeded"* |
| **F0.2** | 🔴 **Fix `routeAuth.test.ts`'s regex** | One line — handle the multi-router mount at `app.ts:222` | Re-run the discovery: `/api/fuel-cards` **must** appear. Then confirm all six routers pass the 401 assertion |
| **F0.3** | **Probe org + production guard** | Resolve `cardNumber` through the org-scoped mirror → 404 if foreign. Refuse production-environment credentials unless `EFS_ALLOW_PRODUCTION_PROBE=true` | **Deployed:** QA-org admin + production card → 404 |
| **F0.4** | **Step-up `iat` fallback removal** | Both functions reduce to `hasStepUpToken`. Web is already migrated | **Deployed:** refresh the session token, retry a step-up action without the password → still **403**. Check for non-browser callers first |
| **F0.5** | **Rotation invalidates sessions** | `__resetEfsSessions` + `invalidatePolicy` from the credential and cert paths, matching the `invalidateTlsAgents` wiring. Password + cert fingerprint in `sessionKey` | **Deployed:** rotate to a wrong password → next read fails `auth`, not cached success |
| **F0.6** | **Endpoint/environment binding** | Validate `environment` against the endpoint host. On change: reset entitlement, disable, audit. `loadCardControlAccess` refuses on host mismatch. `requireFreshAuth()` on `/efs-soap/enable` and `/disable`. `EFS_SOAP_ENVIRONMENT` default → `sandbox` | **Deployed:** change the endpoint → `endpoint_changed` |
| **F0.7** | **Redaction hardening** | PAN mask `\d{10,25}`. **Plus: the `…OVER` suffix defeats `\b\d{12,25}\b` entirely** (no word boundary before `O`) — add an alphanumeric-suffix rule. Add `fromCard`/`toCard` to the element list | Tests: *"a card number with an OVER suffix is masked in a fault message"* · *"transferCard's fromCard is masked"* |
| **F0.8** | **Small, independent** | `Idempotency-Key` required · `flying j` in the fault table · `errorNumber`/`errorDesc` classified as failed · `EFS_CARD_WRITE_TIMEOUT_MS` wired as a real deadline · failed `writeAudit` becomes a loud alert · `efs_card_mutations` in `RETENTION_FORBIDDEN` | One test each, named for the defect |
| **F0.9** | **Gate repair · HUMAN** | Answer B0 · wire `check-rls.mjs` into the standing gates (it is *referenced by nothing* today) · add `needs:`/`workflow_run:` edges so `migrate.yml` cannot run on a failed `ci.yml` · make `verify:live` actually run on deploy · `.gitleaks.toml` | A deliberately failing PR triggers neither `db push` nor a green deploy |
| **F0.10** | **Check the WSDL into the repo** | `docs/efs/CardManagementWS.wsdl` with a retrieval date, plus a check that every operation name we call exists in it | Cheapest single risk reduction available |
| **F0.11** | **Comment-claims fitness check** | Grep source comments for `*.test.ts` references; assert the named file contains a matching `it(`. Ten lines | It fails today on `efsCardEdits.ts:152` — **that failure is the acceptance criterion** |

### ✅ F0 Gate
- [ ] B0 answered in writing; standing gates green or the exception documented
- [ ] `routeAuth.test.ts` discovers `/api/fuel-cards`
- [ ] The F0.1 data-loss bug, replayed through the guard, now throws `echo_unfaithful`
- [ ] `check-rls`, `verify:live` and the CI edges are wired
- [ ] WSDL in the repo
- [ ] F0.11 fails on the known false comment, then passes once fixed
- [ ] Live QA: no-op prompt save byte-identical · refresh-token step-up → 403 · wrong password → `auth` · endpoint change → `endpoint_changed`

---

## F1 — Registry, harness, promotion

### F1.1 — Fix the echo sequence bug, unambiguously

`WSCardv2` is an `xsd:sequence`; new fields and collections are appended last, and `diffCanonical` never compares inter-name order.

**Two ambiguities v3 left open, both of which must be decided here:**

1. **Relative-to-response or absolute-to-`WS_CARD_SEQUENCE`?** `expectedCanonical` re-inserts a replaced collection **last** in Map order. An order-comparing guard built naively on that would expect a new `<infos>` at the end while the fixed serializer puts it mid-sequence — **failing on exactly the S3/S4 case this fix exists to enable.** Decide, and state what happens when the vendor's own response is out of sequence.
2. **Intra-record order (D-F).** `serializeRecord` uses `Object.entries` order. Fix in the same commit — it is the same bug one level deeper.

**Verify:** *"introduces a new infos collection in sequence order"* · *"introduces a new limits collection in sequence order"* · *"record fields are emitted in WSCardInfo sequence order regardless of object literal order"* · *"the guard rejects an out-of-sequence request"* · *"a zero-edit echo of every fixture is byte-order-stable"* · all existing echo tests pass unchanged.

### F1.2 — Characterisation tests **on `main`, before the extraction**

The extraction is currently unverifiable: no test exercises route → spec. `fuelCardsControl.test.ts`'s own header says a request that reaches a handler dies on "Supabase admin not configured — which is the point," and `efsCardControl.test.ts` constructs its own specs inline.

**Write ~10 route-level tests against the recorded fixtures + `supabaseRecorder`, asserting the dispatched XML bytes for each of the five routes. Run them on `main` first.** That converts "tests still pass" from vacuous to meaningful.

Without this, all of the following pass green: swapping `buildEdits` between lock and unlock (so `POST /lock` writes `Active`) · a wrong `auditAction` · a wrong `scope` (lock-approvers stripping DRID fleet-wide) · a wrong `writeBucket` (fail-open instead of fail-closed, 100/day instead of 25) · a dropped `requestFingerprint` (silently reinstating the pre-0180 replay bug) · a dropped `auditMeta`.

### F1.3 — Extract the descriptors

Five contracts, five behaviours, five views (§2.6). Route `prompts` through `run()` like the other four — verified byte-identical, so it is a true no-op.

**Verify — the gate is INVERTED from v3:**

> **The extraction is faithful iff the characterisation suite passes byte-identically, AND the only tests that changed are the route-enumeration fixtures, converted from literals to registry iteration.**

v3's gate — *"no existing test may change"* — **forbids** converting `WRITE_ROUTES`, which is the one edit that must happen. It selected for the unsafe outcome.

Plus a **wiring-table test**: assert the full tuple per capability — `{key, intent, method, path, scope, writeBucket, auditAction, editBuilderName}` — against a hand-written literal. Diffing a table is what makes a swap visible.

Plus **`pnpm mutation:check` pointed at `apps/api/src/efs/`** for the F1 window. It exists and is not in CI. A near-zero mutation score on the descriptor bindings **is the finding** — it proves the claim is otherwise unprovable.

### F1.4 — Generalise dispatch **and verification**

v3 said this was "~6 lines, and the only orchestrator change the whole plan needs." **Generalising the dispatch is 6 lines. Generalising the verification is not** — the `getCardV2` re-read, `updateMirror`, `intentLanded` and both finalizers all assume "same card, card document," and that is where all the safety lives.

Replace the `op: "deleteOverride"` discriminant and its ternary with the `direct.dispatch` thunk. Replace the landed ternary with `behaviour.verify(ctx, body)`.

### F1.5 — Ledger schema

One migration window (allocate numbers at execution time): `capability_key text` · `request_body jsonb` (redacted through the descriptor's `redactResponse`/`redactRequest`) · widened `status` CHECK with a `partial` state · `step_index int` for compound ops · the `efs_card_control_approvers.scopes` CHECK widened per B3.

**Only with `capability_key` and `request_body` does background reconciliation of direct ops work.** v3 claimed the registry alone fixed it; it does not.

### F1.6 — Reconciler

Give `efsCardUnresolved.ts` a branch that looks up the descriptor by `capability_key` and calls its `verify` — with the right read op, not a shared `getCardV2`.

**Verify:** *"an unverified deleteOverride is reconciled"* · *"an unverified direct op is reconciled through its own read op"*.

### F1.7 — Fitness test

Per §2.8, both directions, three CHECK constraints from the whole migration directory, bucket **equality** against the **mounted** path, non-empty-discovery guard.

### F1.8 — The harness

- **Local:** replay a fixture, run any capability's edit builder, assert exact wire bytes. CI.
- **OEG-2a scanner:** run `assertEchoFidelity` **read-only against all 199 production cards**, per capability edit shape. Free, and the strongest proof available.
- **Config scanner:** raw wire text → JSON with `{observedValues[], count, rawSpelling, nilCount, absentCount, presentEmptyCount}` per field. Three-state comparison against each descriptor's declared value set.
- **Live prover:** OEG-1/2b/3/4/5 against a QA card from the `proof` plan. Writes `efs_capability_proofs`.
- **CLI:** `pnpm efs:prove <capability> --card <last4>` · `pnpm efs:scan --org <id>` · `pnpm efs:echo-scan --org <id>`.

### F1.9 — Promotion, minimum viable

`efs_capability_proofs` and `efs_capability_promotions`. RLS enabled, no policies, service-role only — **and now actually enforced, because F0.9 wired `check-rls`**.

`loadCardControlAccess` takes an optional capability and refuses unless promoted. Backfill the five existing intents as `enabled`. Migrate `EFS_CARD_DELETE_OVERRIDE_ENABLED` into the `delete_override` capability.

**No admin console UI** — one endpoint plus the CLI. Two orgs, one promoter.

**Suspension is the per-org kill switch.** `loadCardControlAccess` already issues live queries per request, which is *why* suspension is instant. **Do not add a TTL cache — it would make the kill switch slower.** (v3 said otherwise; that sentence is deleted.)

### ✅ F1 Gate
- [ ] Characterisation suite written on `main` and passing byte-identically after extraction
- [ ] The only changed tests are the route-enumeration fixtures, now registry-driven
- [ ] Wiring-table test in place; `mutation:check` on `apps/api/src/efs/` reports a meaningful score
- [ ] Fitness test catches a deliberately half-wired capability, a wrong bucket, and a missing CHECK value
- [ ] `lint:filesize` violations reduced by **2** (`control.ts`, `cardControlModel.ts`). `cardControlContract.ts` will **grow** — re-pin or split it deliberately
- [ ] `pnpm efs:echo-scan` runs against all 199 production cards, read-only, and reports per-capability echo fidelity
- [ ] `pnpm efs:scan` produces three-state JSON with `unobserved` counted
- [ ] `pnpm efs:prove card_lock --card <last4>` green end to end
- [ ] Every existing operation still works on QA

---

## F2 — Drawer shell

One trigger → one drawer → one operation, rendered from the contract's `ui` spec and the view module.

Seven invariants: **snapshot on confirm** · **pause reseeding while dirty** · **dirty guard** on ESC/scrim/✕ · **result state stays in the drawer** with a history link and a disabled retry on `sent` · **step-up predicted, not discovered** (using `preflightStepUp`) · **disabled = explained** · **environment badge + promotion state in the header**.

Every operation gets a **"what will change" diff**.

Reuse only existing primitives: `SlideOver` (`size="lg"`), `AppButton`, `AppFormField`, `AppInput`, `AppCombobox`, `DataTable`, `BADGE_BASE`/`toneClass`, `useToastStore`, `StepUpPrompt`, `KebabMenu`, `EfsLocationPicker`. **No `ConfirmDialog`, no `EmptyState`** — confirmations replace the body; empty states are `DataTable`'s `empty-text`.

**Lift verbatim:** per-intent idempotency keys, re-mint-on-settle with the `sent` exception, the re-entrancy guard, the card-identity reseed.

Triggers: an Actions card on the detail page · a `KebabMenu` column on the list page (today a dead end) · `Remove exception…` per row in the overrides panel · `Edit…` per row in effective-config.

**Verify:** one test per invariant, named for the defect. Accessibility: focus to the confirmation heading, ESC during step-up cancels the step-up, `aria-labelledby` on every section, a reason on every disabled button. **Manual:** the 2am path in two interactions, down from six.

---

## The slices

Each slice: read → write → UI → proof → promote. Verification per §4.1.

### S1 — Account & policy visibility (read-only)

Produces the scan JSON that scopes S3–S6, and `docs/25-EFS-ACCOUNT-INVENTORY.md` generated from it.

**Build:** the inventory read ops (`getPromptTypes`, `getPolicyDescriptions`, `getProducts`, `getProductGroups`, `getContracts`, `getCreditLimits`, `getCardRefreshingLimits`, `getPolicyRefreshingLimits`, `getLocationGroupDescriptions`, `getLocationGroups`, `getSitePolicyDescriptions`, `getCarrierInfo`, `serverTime`). Model every field production sends. Surface what is parsed but dropped: `locationGroups`, blocked `locations`, `locationSource`, `autoRollMap`/`autoRollMax`, the five SmartFunds payroll flags. Refreshing limits and credit headroom in the UI. A policy parity view. **Mirror fixes:** raise the detail budget above the fleet count **and pin `budget > fleetSize` as an invariant**; add a **ratio guard on tombstoning** (today a partial roster of 40/199 stamps `absent_since` on 159 live cards); surface `absent_since`; stop the roster-only `card_version: ""` case throwing a 409 that claims the card changed.

**Verify — mechanical, not eyeballed.** v3's "a side-by-side shows zero discrepancies" is unfalsifiable. Instead: feed the scan JSON into the pure renderers (`promptRows`, `limitRows`, `timeRows`, `sourceSentence`, `activeOverrides`) and assert **every observed field is reachable by exactly one row and no row renders `undefined`/`—`**. That mechanically catches "parsed but dropped," which is the slice's actual purpose.

**Two postures, deliberately different:** unmodelled fields **fail the scan** (finding them is its job) and are **logged, not CI-failed, by the mirror sweep** (a vendor change should tell you, not break an unrelated PR).

### S2 — Card status (the pilot)

Run the whole new pipeline end to end on operations that already work, before betting a feature on it.

Migrate lock/unlock to descriptors. Add **Deactivate on Active *and* Hold** — today retiring a held card requires unlocking first, momentarily re-enabling fuel purchases. Move onto the shell.

Full OEG for `card_lock` — the operation the H1 incident happened on, so the right one to re-prove under the new harness. Then the config scan against production, then promote. **If the scan blocks it, that is the system working.**

### S3 — Driver assignment & prompts (Issue #1)

**Blocked on F0.1b.**

Drive the available set from `getPromptTypes`. Widen to all 7 validation types with `DYNAMIC` → `{CNTN, PPIN, DRID}` enforced. Add `value` for `ACCRUAL_CHECK` — **odometer following**. Add optional `lengthCheck`/`minimum`/`maximum`. Remove the 2-prompt cap. Add the `infoSource` precondition — a card-level prompt write on a `POLICY`-source card is a silent no-op reported as success today. Edit / Add / Remove as three explicit actions.

⚠️ **`promptsEdits` is already 63 lines and gains 26 IDs, 7 types, a constraint, and four optional fields. `lint:funcsize`'s 200-line cap applies once it leaves `/routes/`. Plan the decomposition — a per-type table, not a switch — in F1, not mid-slice.**

### S4 — Override (Issue #2)

**Blocked on F1.1.**

`grantOverrideSchema` gains optional `limits[]`. `overrideGrantEdits` appends `{op:"replaceAll", name:"limits", records, removals: []}` — with F0.1b's assertion now covering it. Require `scope.kind === "all"` and step-up when limits are present. Fix override residue: "Remove exception" today renders only when `overrideUses > 0`, so a card with an armed scope field and zero uses is unclearable.

UI: product select, amount with the **unit spelled out** (gallons for fuel and DEF, dollars otherwise), window hours.

**Prove:** OEG plus a single confirming observation that clearing restores the original limits. You have confirmed this; verify once rather than trusting silently, because the failure mode is free fuel.

### S5 — Spend limits & velocity

**First `direct` capability and first `compound` operation.**

Product-limits editor · `setCardRefreshingLimits` as `direct` with `verify` naming `getCardRefreshingLimits` · then the `…OVER` compound.

⚠️ The compound needs everything in §2.4 — widened `status` CHECK, `step_index`, a UI that says which half landed, a documented manual recovery — **all delivered in F1.5, not improvised here.** Plus an explicit half-failure test.

### S6 — Access controls

`handEnter` ALLOW/DISALLOW/POLICY — one enum, the cheapest anti-skimming control, currently read-only. **OEG-4 is critical: a vendor string field, exactly the H1 class, and the config scan will likely report `unobserved` for both writable values — so this needs the canary card.** Time restrictions (day is **1 = Sunday**; the date part is meaningless). Blocked locations (a *blocklist*). Location groups as `account`-kind ops, **only if S1 says the account uses them.**

### S7 — Card lifecycle

`replaceLostOrStolenCard` · `reissueDamagedCard` · `transferCard` (**`cardPair` — two cards, one ledger row; a transfer can race a lock on the destination, and that risk must be named and mitigated before shipping**) · `setCardPin` (**mandatory `redactResponse` — its documented output is the PIN**).

### S8 — Advanced

Capacity bridge (guard the unit trap: an EFS limit is per reset window and capped at 9999; tank capacity is a one-shot physical bound) · `managedFuelAction` (bulk, `account` kind) · maker-checker (`approved_by` exists and is unwritten) · revert (blocked on S1 modelling every field).

---

## 5. Operational readiness

**None of this existed in v3.** All of it is required before the first production promotion.

### 5.1 Observability

| Signal | Threshold |
|---|---|
| Mutation outcomes by intent: succeeded / failed / drift / **unverified** | Alert on unverified rate above baseline |
| **`echo_unfaithful` count** | **Should be identically zero. Any occurrence pages** |
| Session breaker opens | Alert |
| Promotion state changes | Log to `platform_audit_log`, notify |
| Mirror sweep completion + cards without `detail_synced_at` | Alert if any card is missed |
| Unknown vendor elements seen by the sweep | Weekly digest — this is the vendor-drift tripwire, and something must **read** it |

### 5.2 Incident runbook — write before the first promotion, not after the first incident

Minimum: **assess** (bulk read to determine blast radius) · **contain** (suspend the capability — instant, no redeploy) · **recover** (the revert path, currently blocked on S8/S1; until then, the WEX portal is the documented manual fallback, with the exact steps written down) · **the "outcomed `sent`" procedure** from §3.4, which the QA harness will exercise before production ever does.

### 5.3 Separation of duties

`approved_by` exists in `0177` and nothing writes it. One person currently plans, applies, proves and promotes a control that can stop 199 trucks fuelling. The `planCardMutation`/`applyCardMutation` seam is already built — this is cheap and it should not wait for S8.

### 5.4 Also missing

Disaster recovery for a corrupted mirror · a written secrets-rotation *procedure* (F0.5 fixes the mechanism, not the runbook) · a defined authority for production promotion.

---

## 6. Standing rules for the execution session

Twelve failure modes, each grounded in something that has already happened here. **These belong in the session's rules, not in a doc nobody re-reads.**

1. **Never weaken a gate to make it green.** No new `GRANDFATHERED` entry, no raised pin, no `.skip`, no loosened regex, no widened schema to accept what failed, no deleted assertion. `check-file-size.mjs`'s own header records four waived files growing **282 lines in three weeks** — *"the files the gate existed to contain became the only ones free to grow."* **A gate change is its own commit, with its own justification.** If a gate blocks you, **stop and report**.
2. **Never fabricate a verification.** Every "Verify" claim carries the actual command and its actual output, pasted. For live-EFS steps, the `read_state` before and after, verbatim. *"I ran it and it passed"* is a claim about a verification, not one.
3. **A comment claiming a test must name the test.** F0.11 enforces it. This codebase already contains a false one.
4. **Never normalise vendor data on the write path.** No incidental `trim()`, `toLowerCase()`, `toUpperCase()`. Normalisation is a named, tested adapter like `matchStatusCasing`. H1 cost you an incident here.
5. **Never reimplement what exists.** Banned without explicit approval: a second XML builder, a second `redactCardXml`, a second PAN mask, a second SOAP client, a second idempotency-key generator. Your own code warns about this: *"a second serializer would be a second place to get the echo wrong."*
6. **Assert on wire bytes, not intermediate objects.** For any new guard, **state what the second, independent route is.** If you cannot name it, it is a tautology — which is exactly how D-A happened.
7. **A test name is not a test.** Keep the name-the-defect convention; point `mutation:check` at new modules to measure whether the tests bite.
8. **The abstraction may only accommodate cases that exist in code today.** A speculative field gets deleted. When an operation does not fit, extend the taxonomy explicitly — do not contort the operation.
9. **One step, one commit, and the diff contains nothing the step describes.** Tidy-ups are their own commit.
10. **Never delete a comment referencing an incident, a date, an audit finding, or a ticket.** If code moves, the comment moves with it.
11. **Every vendor field, operation name and enum cites the WSDL or the guide, by line.** `setCardv2` vs `setCardV2` is the live example.
12. **A successful response is never evidence of a correct write. Only a re-read is.**

Plus the operational rules: never leave a QA card dirty · unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy after any session that needed it · never edit an applied migration · no QA card numbers in the repo · **a blocked promotion is the system working** · record every live EFS finding in `docs/22` in the H1 format, confirming or refuting · **if a verify fails, stop.**

---

## Appendix A — Traceability

C-1/C-2 → F0.6 + F1.9 · C-3 → F0.3 · H-1 → F0.4 · H-2 → F0.3/F0.6 · H-3 → F0.5 · H-4 → F1.9 suspension · H-5 → F0.7 · M-1/M-4 → F0.8 · M-2 → F1.6 · M-3 → F0.6 · M-5 → deferred · M-6 → F0.8 · M-7 → F0.9 · L-1 → §5.3 · L-2 → S8 · L-3 → F0.6 · L-4 → F2 · E-1 → F1.1 · E-2 → F0.8 · E-3 → S1 · Issue #1 → F0.1 + S3 · Issue #2 → S4 · Issue #3 → S1 + S5 + S6 · Issue #4 → F2 · D1 → F0.1 · D2–D14, A1–A11 → F2.

**From the audit:** D-A → F0.1b · D-B → F0.1c · D-C → F0.2 · D-D → F1.3 · D-E → F1.5 · D-F → F1.1 · D-G → B0 · taxonomy → §2.2/§2.3 · three artifacts → §2.6 · key model → §2.7 · three-state scan → §3.1 · OEG split → §3.2 · card assignment → §3.3 · harness caps → §3.4 · observability/runbook/SoD → §5 · AI guardrails → §6.

## Appendix B — Migrations

One F1 window: `capability_key` · `request_body jsonb` · widened `status` CHECK (+`partial`) · `step_index` · widened approver-scope CHECK (B3) · `probed_endpoint_host` / `probed_document_shape` · `efs_capability_proofs` · `efs_capability_promotions` · sealed `soap_password`.

**Allocate numbers at execution time** — you are shipping actively. All idempotent, RLS-enabled with no policies, 0106-style comment, **and now actually verified because F0.9 wires `check-rls`.**

## Appendix C — What changed from v3, and why

| v3 said | v4 says | Evidence |
|---|---|---|
| The echo guard is "the only defence against delete-by-omission" — built and working | **Tautological for `replaceAll`.** F0.1b adds the real second route | `efsCardEcho.ts:298-299` builds the expectation from the same `records` array; the F0.1 bug passed the guard |
| Two descriptor kinds | **Four kinds** + explicit `target`; account-scoped ops leave the card ledger | 4 of 12 families fit two kinds |
| One descriptor file | **Three artifacts** across api/shared/web | `apps/web` cannot import `apps/api`; zero such imports exist |
| `landed(doc, body)` | **`verify(ctx)`** | Refreshing-limits state is not in the card document; `body` is not persisted |
| One `stepUp(body, doc?)` | **`preflightStepUp` + `planStepUp`** | Two of three gates fire post-read with inputs in neither argument |
| Registry alone fixes reconciliation | **Needs `capability_key` + `request_body`** | No such columns exist |
| F1.3 is ~6 lines, the only orchestrator change | **6 lines of dispatch; verification is substantial** | The re-read, mirror update and finalizers all assume "same card, card document" |
| Pays down 4 filesize violations | **Two.** `cardControlContract.ts` will **grow** | Only `control.ts` and `cardControlModel.ts` shrink |
| "All existing tests pass unedited" is the F1 gate | **Inverted** + characterisation tests on `main` + wiring table + `mutation:check` | That gate *forbids* fixing the hardcoded `WRITE_ROUTES` |
| Config match closes the WEX gap | **~7% coverage; three states with `unobserved` blocking** | The modal case is a value not currently in use |
| OEG-2 is per document shape | **2a local/read-only on all 199 production cards; 2b QA-only, per edit-shape, never obtainable for production** | A zero-edit echo skips the four code paths where the bug lives |
| OEG-3 = "change lands" | **+ before-state must differ from target-state** | `vendorNormalisedOnly` reports a silently-ignored write as landed |
| Cards assigned by slice | **By required starting state and policy**, with reserved empty-collection and same-policy control cards | Empty-collection cards are consumed by first use |
| Suspension bounded by a TTL cache | **No cache** — it would make the kill switch slower | `loadCardControlAccess` queries live per request |
| Copy `routeAuth.test.ts`'s mechanism | **Fix its regex first** — it does not cover `/api/fuel-cards` today | Ran it: 26 routers, fuel-cards absent |
| `lint:filesize` green is a precondition | **It is red on `main`. B0 must answer why** | 8 violations + a broken pin |
| — | **New: observability, incident runbook, separation of duties** | None existed |
| — | **New: twelve standing rules against AI failure modes** | Requested; each grounded in an incident here |
