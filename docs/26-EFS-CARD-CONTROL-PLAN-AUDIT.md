# Audit of the EFS Card Control Plan — assumptions, gaps, blockers, bad practices

**Date:** 2026-08-13
**Audits:** `docs/24-EFS-CARD-CONTROL-PLAN.md` (v3) and, where the plan inherits from it, `docs/23-EFS-CARD-CONTROL-FINDINGS-2026-08-12.md`
**Method:** two independent adversarial reviews with different lenses (architecture; verification), plus direct execution of the repo's own code to confirm the five most damaging claims.

---

## 0. Verdict

The plan is well-researched and self-auditing, and it is **wrong in three load-bearing places**. All three are the same species of error: *a mechanism that looks like a proof but is a restatement.*

1. **The echo guard is structurally blind to `replaceAll`** — and `replaceAll` is the edit that S3, S4, S5 and S6 all depend on. The plan lists the guard under "built and working — do not rewrite" and calls it "the only defence against delete-by-omission." For replaced collections it is a tautology, and the live data-loss bug in F0.1 is the existence proof.
2. **The "configuration match" idea — the load-bearing insight of the whole promotion model — produces usable evidence for roughly 2 of ~30 capabilities.** Its failure mode is to pass silently when it has no evidence, which launders *absence of evidence* into *evidence of safety*.
3. **The registry's two-kind taxonomy fits 4 of 12 remaining operation families**, and the descriptor cannot physically live in one file because `apps/web` cannot import `apps/api`.

Separately, five claims were confirmed **by running the repo's own code**, and three of them mean an existing gate is not gating.

None of this is fatal. All of it is much cheaper to fix now than in S5.

---

## 1. Confirmed by execution

I ran these rather than reasoning about them.

### 1.1 🔴 `routeAuth.test.ts` does not cover `/api/fuel-cards` — today

The plan holds this fitness function up as the model to copy (§2.4). I ran its own discovery regex against `app.ts`:

```
regex:      /app\.use\("(\/api\/[^"]+)"\s*,[^)]*?\w+Router\(\)\)/g
discovered: 26 routers
"/api/fuel-cards" discovered?  false
```

Cause — `app.ts:222` mounts six routers on one prefix:

```ts
app.use("/api/fuel-cards", fuelCardSettingsRouter(), fuelCardsRouter(), fuelCardControlRouter(),
        fuelCardProbeRouter(), fuelCardWriteProbeRouter(), fuelCardExperimentsRouter());
```

`[^)]*?` cannot cross the `)` of the first `Router()`. **Six routers — including every write route, the probe router and the write-probe router — are invisible to the one auth fitness function in the API.** They happen to be safe (each calls `router.use(requireAuth)`), but that is a fact about the authors, not the gate. The non-empty guard (`count > 5`) passes with 26.

This is the exact failure the test's own docblock records for `/api/me/notifications`. It is not history; it is current. **One-line fix, and it belongs in F0** because it is the precondition for the plan's entire fitness strategy meaning anything.

### 1.2 🔴 A source comment claims a test that was never written

`apps/api/src/services/efsCardEdits.ts:149-152`:

> *"That cannot pass silently: `assertEchoFidelity` compares full field PATHS… Recorded as a property, not a hope — `efsCardEdits.test.ts` proves it with a record carrying a nested child."*

```
grep -ci "nest" apps/api/src/services/efsCardEdits.test.ts  →  0
```

There is no such test. And the claim is false on its own terms: `recordFromElement` flattens a nested container to its `textContent`, `serializeRecord` re-emits it flat, and `recordFromObject` builds the expectation from that same flattened object — both sides agree and the guard passes.

**Why this matters beyond one comment:** §1.1 of the plan ("built and working — do not rewrite") was assembled substantially from the codebase's own self-descriptions. At least one of those is a comment describing a proof that does not exist. **The rest of that table needs the same treatment before it is trusted as a baseline.**

### 1.3 🔴 The route gate tests iterate a hand-maintained literal

`apps/api/src/routes/fuelCardsControl.test.ts:90`:

```ts
const WRITE_ROUTES: Array<[string, string, unknown]> = [ …5 entries… ]
```

Every gate assertion — 401 without a token (`:101`), 403 per persona (`:105`), `reason` required (`:127`), `expectedVersion` required (`:137`) — iterates that array. A route added by a registry loop is covered by **none** of them.

And the plan's F1.2 gate says *"every existing card-control test passes unchanged; if one needs editing, the extraction was not faithful."* That rule **forbids** converting `WRITE_ROUTES` to iterate the registry — the one edit that must happen. **The gate as written selects for the unsafe outcome.**

### 1.4 🔴 The ledger has no request-body column, so F1.4's claimed fix does not work

The plan claims that keying the registry by persisted `intent` lets the background reconciler look up `landed` for a DB row, and books it as *"a real bug the registry fixes, not just tidiness."*

```
grep -ci "request_body" supabase/migrations/0177…sql 018*.sql  →  0 everywhere
```

The plan's own signature is `landed: (after: CardDocument, body: TBody) => boolean`. `body` is not persisted and cannot be reconstructed — `request_fingerprint` is a sha256 (one-way), and `request_xml_redacted` is lossy, redacted, length-capped, and absent entirely for rows that died before dispatch.

So the fix works **only** for a `landed` that closes over nothing but `after` — i.e. exactly `overrideClearedLanded`, the one that already exists. For every capability the registry is being built to enable, it fails.

### 1.5 ✅ One thing the plan got right that a stale audit contradicted

`scripts/run-tests.mjs:24, 97-107` genuinely discovers matrices and fails on a missing RESULT line. `docs/AUDIT-2026-08-09.md:69` describes the *old* `pnpm -r test && pnpm test:rls` behaviour and is stale. §4.1 is correct.

---

## 2. 🔴 CRITICAL — The echo guard is a tautology for `replaceAll`

This is the most important finding in the audit.

`assertEchoFidelity` compares an expectation against the bytes about to be sent. The docblock at `efsCardEcho.ts:291-293` states the design intent:

> *"Derived from the EDIT LIST and the response DOM — deliberately NOT by calling the serializer. The guard's whole value is that expectation and reality are computed by two different routes; sharing `renderCollection` between them would make `assertEchoFidelity` a tautology."*

But look at what actually happens for a replaced collection (`efsCardEcho.ts:298-299`):

```ts
} else if (replace?.op === "replaceAll") {
  for (const record of replace.records) fragments.push(recordFromObject(name, record));
}
```

- **Request side:** `renderCollection` → `serializeRecord(name, record)` — built from `replace.records`.
- **Expectation side:** `recordFromObject(name, record)` — built from **the same `replace.records`**.
- And `dropCollection(name)` deletes the original collection from the expectation before the comparison runs.

Not sharing the *serializer* is not the same as not sharing the *input*. Two different functions rendering the same array is one route with two spellings. **For the contents of a replaced collection, the guard proves only "the bytes encode the records I asked for." It cannot detect that the record set itself is wrong.**

**The existence proof is already in production.** F0.1 is a live bug where a `REPORT_ONLY` prompt is silently deleted on save. That deletion travels `promptsEdits` → absent from `records` → `replaceAll` → dispatched. It is textbook delete-by-omission. The guard passed it.

**Blast radius across the plan:** S3 (prompts), S4 (`replaceAll` on `limits` — *"that single edit is the recipe"*), S5 (product limits), S6 (`timeRestrictions`, blocked `locations`) are all `replaceAll`. The plan's stated safety argument for all four is a guard that is inert on them.

### Two further defects in the same area

**`editsLanded` checks `replaceAll` by count only** (`efsCardWrite.ts:271-273`):

```ts
case "replaceAll": {
  if (collectElements(after.root, edit.name).length !== edit.records.length) return false;
```

Two records replaced by two *wrong* records reconciles as `succeeded`.

**`appendRecord` is an empty branch** (`efsCardWrite.ts:275-280`) — *"Phase 1 uses no appendRecord edits; when Phase C does, this is the branch to make exact rather than the one to trust."* S3's prompt-add and S4's p194 recipe **are** Phase C. Every `appendRecord` currently reconciles as landed unconditionally.

### The fix, and it is small

A `replaceAll` preservation assertion computed from the **response DOM**, not from the edit:

> Every record present in the response is present in the request, unless its identity key appears in an **explicit removal list** carried on the edit.

That is the second route the docblock claims to have. It requires `CardEdit.replaceAll` to gain `removals: readonly string[]`, which it should have anyway — F0.1's fix is *exactly* "removal must be explicit, never inferred." The two changes are the same change.

**Sequencing: this becomes F0.1b, before S3.** It is perhaps two days, and every risky slice depends on it.

---

## 3. 🔴 CRITICAL — "Configuration match" covers ~7% of what the plan applies it to

§3 asserts: *"you never need to write to production to know whether the value you would send matches its vocabulary — you read the card and compare."*

### 3.1 The blind spot is the modal case, not an edge case

The scan reads production cards. It can only observe values that **are already in use**. But every capability worth building writes a value that is, by definition, **not currently in use**:

| Capability | What the scan can observe |
|---|---|
| Prompt `infoId` / `validationType` (S3) | S3's whole purpose is widening from 2 IDs to 26 and 2 types to 7. **The 24 new IDs and 5 new types are not in use, therefore not observable.** The scan is empty precisely where the risk is |
| `handEnter` ALLOW/DISALLOW (S6) | If production's cards read `POLICY` — which 2 of 3 header fixtures do — the scan yields **zero evidence** for the two values you would write. S6 calls OEG-4 "critical for `handEnter`"; the config half is empty for it |
| `limitId` (S4/S5) | The p194 recipe writes limits onto cards "that may have none" |
| Every `DirectCapability` (S5–S7) | Discrete payloads that never appear on a card document. The scan reads cards; it cannot see these fields at all. The type doesn't even carry `vocabularyFields` |

Counting the plan's write surface (~30 capabilities), the scan produces usable evidence for **`status`, and partially `handEnter`.** Roughly 7%.

And for `status` — the one case that works — it is **already handled dynamically**: `matchStatusCasing` derives casing from the observed value of the same field on the same card at write time. A static scan tells you nothing you don't already do.

### 3.2 Format, where casing does not apply

You raised this; here is the mechanism.

- **`boolOrNull` (`efsCardXml.ts:139-145`) accepts `true/1/y/yes` and returns a JS boolean.** A scan reading `doc.card` sees `overrideAllLocations: false` whether the wire said `false` or `0`. We write the literal `"true"`/`"false"`. On an account whose serializer speaks `0`/`1`, the scan reports **match** and we send a format the account has never emitted.
- **`locationOverride` is worse:** `efsCardXml.ts:294-297` collapses **both `"0"` and `"1"`** to `null`. So the typed view cannot distinguish an account that spells "no override" as `0` from one that spells it `1`. `overrideClearEdits` writes `"0"` unconditionally, and `overrideClearedLanded` only checks `overrideUses === 0` — so on a `1`-spelling account the clear reports success **with the scope field still armed.** S4 itself names the failure mode here: free fuel.
- **nil vs empty vs absent:** the canonical form treats these as three distinct sentinels; `leafText` collapses nil and empty to `null`. A scan on `doc.card` is blind to a distinction the echo engine treats as load-bearing.

### 3.3 The fix — three states, not two

1. **Scan raw wire text, never `doc.card`.** The typed view is exactly where the format information is destroyed.
2. **Descriptors declare their emittable value set**, not just field names. `vocabularyFields: string[]` gives the scan nothing to compare against.
3. **Report three states: `match` / `mismatch` / `unobserved` — and make `unobserved` block promotion.** As written, "no observed value" reads as "no discrepancy." A gate that passes by default when it has no evidence is worse than no gate.

With `unobserved` blocking, most capabilities will not promote on the scan alone. **That is the honest answer**, and it is what forces the production canary card back from "fallback we expect not to use" into the primary path for the capabilities the scan cannot cover.

---

## 4. 🔴 CRITICAL — OEG-2 does not generalise, and cannot be run on production at all

The plan's §3.1 optimisation — *"OEG-2 is per document shape, not per capability"* — was mine, and it is wrong twice.

**It is not a property of the document.** With `edits = []`, `serializeSetCardRequest` never reaches `renderNewField`, never reaches the header-append loop, never reaches the new-field append, never reaches the new-collection append, and `renderCollection` takes only the passthrough branch. **Those four skipped blocks are exactly where F1.1's sequence bug lives.** A green zero-edit echo says nothing about whether a `setField` on an absent field, an `appendRecord`, or a `replaceAll` produces a document the vendor accepts.

**It cannot be run against production, ever, under the plan's own rules.** OEG-2 is `writeProbe.ts` steps 4–6, and step 5 dispatches a real `setCardV2`. §3 forbids production writes. Since document shape is a property of the *EFS installation's serializer*, all 13 QA cards share one shape by construction — so "per document shape" means **one QA run covering zero production cards**, presented as covering the fleet.

**Fix — split it:**

- **OEG-2a (echo fidelity)** is local and read-only. `assertEchoFidelity` runs before dispatch on bytes built from a document. **Run it against all 199 production cards today, free**, with zero edits and with each capability's real edit shape. This is a genuinely strong, genuinely free proof that the plan leaves on the table.
- **OEG-2b (`cardVersion` unchanged after a no-op write)** requires a dispatch. Scope it **per edit-shape × document-shape**, and state plainly in the plan that it is **never obtainable for production** — so the promotion record carries that as a named residual risk instead of an unstated one.

**And a third fix to OEG-3.** `vendorNormalisedOnly` (`efsCardReconcile.ts:66-75`) treats a case-only diff as benign. So if a proof card is *already* in the target state, a silently-ignored mis-cased write reports `succeeded` — the exact H1 failure OEG-4 exists to catch. Add: **before-state must differ from target-state, asserted from the planning read, or the run is void.**

---

## 5. 🔴 CRITICAL — The registry taxonomy fits 4 of 12 remaining operation families

`EchoCapability` and `DirectCapability` differ only in *how the write dispatches*. Both bake in four assumptions the orchestrator enforces and the ledger schema encodes: one target card resolved from `req.params.id` · a required `expectedVersion` from a fresh `getCardV2` · one ledger row keyed `efs_card_id not null references efs_cards(id)` · verification by re-reading the **same card** with **`getCardV2`**.

| Operation family | Fits | Why not |
|---|---|---|
| lock, unlock, prompts, override grant, `handEnter`, time restrictions, blocked locations, product limits | ✅ echo | — |
| `deleteOverride` | ✅ direct | The only op `DirectCapability` was reverse-engineered from |
| **`setCardRefreshingLimits`** | ❌ | Card-keyed, but **its state is not in the card document.** `landed(after: CardDocument)` cannot express a re-read via `getCardRefreshingLimits` |
| **the `…OVER` compound** | ❌ | Two dispatches, two card numbers, one of which is not in `efs_cards`. `uq_efs_card_mutations_one_pending` **structurally forbids** two rows on one card. Needs a widened `status` CHECK the plan never mentions |
| **the eight `LocGrp*` ops** | ❌ | Take a group id, not a card. **No `efs_card_id` → no ledger row can be inserted at all.** All four orchestration guarantees unavailable |
| **`createInfoLimitCard`** | ❌ | Policy-keyed; **returns a brand-new card number.** It is a *create*; the ledger is built around *mutate* |
| **`transferCard`** | ❌ | Two cards, one `efs_card_id` column. The one-pending index protects only one of them — a transfer can race a lock on the destination |
| **card ordering** | ❌ | Multi-step, returns an `orderId`, fulfilment is asynchronous and physical. "Landed" is a state machine with a horizon of days |
| **`managedFuelAction`** | ❌❌ | Takes an **array**, each element with `cardNumber` *and* `cardNumber2`. Bulk |

**Four of twelve.** The five that fit today are the five that were designed together — that is evidence the abstraction was *fitted*, not that it *generalises*.

Appendix C rule 7 says *"if it will not fit the descriptor, that is a design signal."* **The signal has already fired, at plan time.**

### 5.1 The fix, decided now rather than in S6

- Replace `landed: (after: CardDocument, body) => boolean` with **`verify: (ctx) => Promise<VerifyResult>`** — so a capability can name its own read op and its own target.
- Make **`target` an explicit discriminated field**: `{kind:"card", id}` | `{kind:"cards", from, to}` | `{kind:"policy", n}` | `{kind:"group", id}` | `{kind:"none"}`.
- Accept that **account-scoped ops (`LocGrp*`, `createInfoLimitCard`, ordering) do not use the card ledger at all** and need their own, simpler audit path. Do not contort the card ledger to hold them.

Two days now; a rewrite in S6.

### 5.2 The corollary: F1.3 is not a 6-line change

The plan says generalising the vendor op is *"~6 lines, and it is the only orchestrator change the whole plan needs."* Generalising the **dispatch** is 6 lines. Generalising the **verification** — the `getCardV2` re-read, `updateMirror`, `intentLanded`, and both finalizers, all of which assume "same card, card document" — is not. **That is where all the safety lives.**

---

## 6. 🔴 CRITICAL — The descriptor cannot live in one file

§2.5 places the registry in `apps/api/src/efs/`. §2.3 then promises it generates the **web hooks** and the **drawer**.

`apps/web/src` contains **zero** imports of `apps/api`. Every cross-app type crosses through `@silvicom/shared`. And the descriptor cannot move to shared, because `buildEdits(doc: CardDocument)` binds it to a live XML DOM — putting that in `packages/shared` drags a DOM parser and the SOAP transport into the browser bundle.

§2.5 reassures that *"`lint:boundaries` does not cover `apps/api` at all."* **That is checking the wrong constraint.** The binding constraint is the module graph, not the lint rule.

**Consequence:** one descriptor becomes three artifacts — an `apps/api` behaviour half, a `packages/shared` contract half (`route`, `intent`, `scope`, `writeBucket`, `schema`, labels), and an `apps/web` `ui` half. The fitness test's real job is then **cross-checking three registries**, which the plan does not describe.

**Knock-on correction:** §1.5 and Appendix A claim the refactor pays down *four* of the eight filesize violations. It pays down **two** — `control.ts` and `cardControlModel.ts`. `efsCardControl.ts` is explicitly a small change and does not shrink; `experiments.ts` is untouched; and `cardControlContract.ts` lives in shared and will **grow** when the contract half lands. Believe the F1 gate ("≥2"), not the prose.

---

## 7. HIGH — Gates that do not gate

| # | Gate | Why it fails |
|---|---|---|
| 7.1 | **`lint:filesize` is red on `main` right now** — 8 violations, 5 of them card control, plus `samsara.ts` grew past its pin. Every step's "standing gates green" precondition is currently unsatisfiable. **Answer this before anything else** |
| 7.2 | **`scripts/check-rls.mjs` is referenced by nothing** (`docs/AUDIT-2026-08-09.md:335`). F1.7 creates two new tables and asserts "RLS enabled, no policies, service-role only" as if a checker enforces it. Either wire it in F0 or stop citing it |
| 7.3 | **`lint:codegen` never runs in CI** (same audit line). Any plan that leans on codegen drift-detection is leaning on decoration |
| 7.4 | **`cardWriteBucket` fails OPEN.** It returns `null` for an unmatched path and `enforceCardWriteLimit` treats `null` as allow. A generated route whose path doesn't match `PATTERNS` — which lives in `packages/shared` and cannot import an `apps/api` registry — is **completely unmetered**. The fitness test must assert **equality** with the descriptor's declared bucket against the **actual mounted path**, not existence of a match |
| 7.5 | **`verify:live` has nothing making it run.** §4.1 makes it the deploy gate; F0.7's verify tests the migrate gate instead |
| 7.6 | **The `intent` CHECK is one of three.** `0173:65-66` constrains `efs_card_control_approvers.scopes` — **every new `CardScope` needs that migration too**, unmentioned. And `0177:51` constrains `status`, which S5's partial state needs widened. A fitness test that reads only `0177` goes stale the first time you widen anything |
| 7.7 | **Existing approvers are silently denied new scopes.** `scopes` defaults to the four current values. Promote a capability with a new scope and every existing approver lacks it — a promoted capability nobody can use. Needs a backfill rule decided once, up front |

---

## 8. HIGH — The live-QA proof runs will trip the system's own blast-radius controls

Nobody planned for the harness being subject to the guardrails.

- **Org hourly cap: 50 mutations**, counted across every user and every intent **including failed rows**, fail-closed. The plan budgets ~40 proofs; each is apply + revert = **~80 writes**. The harness trips its own cap mid-suite, and a 503 is **indistinguishable in the proof record from "the vendor refused."**
- **`card_override` daily cap: 25**, fail-closed. S4 + S5 override proofs plus the compound recipe and its half-failure test land near that ceiling in a single day.
- **In-flight lockout: ~58 s** on the same card between a proof's own OEG-3 and OEG-5 steps. And any run that outcomes `sent` leaves the card blocked **and in an unknown state indefinitely** — at which point Appendix C rule 3 ("never leave a QA card dirty") is unsatisfiable and the plan gives no procedure.
- **Card roles are necessary but not sufficient.** Three ordering dependencies the role table cannot express:
  - S3 needs *"a prompt on a card with no `infos`."* After the first run that card has `infos`; **the empty-collection case is unreprovable on it forever.** Same for S4's "limits on a card with none." **Reserve two cards that must stay empty.**
  - Override cards are assigned to **both S4 and S5.** S5 rewrites their limits, so S4's headline observation — clearing restores the *original* limits — is no longer testing what it was.
  - Control cards are "the only way to tell the account changed from we changed it" — but a POLICY-sourced change affects only cards on that policy. **The role table never assigns policies**, so a control card on a different policy is a control for nothing.

**Fix:** assign QA cards by *required starting state and policy*, not by slice; give the harness an org-cap exemption or its own budget; and write the "a proof outcomed `sent`" procedure before the first live run.

---

## 9. MEDIUM — Unverified and silently-breaking

| # | Item |
|---|---|
| 9.1 | **Mirror tombstoning under a partial roster.** The guard covers only the fully-empty case. A response returning 40 of 199 cards stamps `absent_since` on 159 live cards. Needs a ratio guard |
| 9.2 | **PAN redaction on new code paths.** `\b\d{12,25}\b` does **not** match `7083…111OVER` — no word boundary before `O`. Inside a `<cardNumber>` element the element rule saves it; **inside a fault message it is emitted in the clear.** F0.6's widening to `\d{10,25}` does nothing about alphanumeric suffixes. And `transferCard`'s `fromCard`/`toCard` elements are not in the element list at all |
| 9.3 | **`setCardPin` writes the PIN into the ledger, permanently.** Its documented output *is the PIN*. A 4-digit value matches no redaction rule, and F0.6 adds the ledger to `RETENTION_FORBIDDEN`. S7 says "PIN never rendered or logged" and nothing enforces it. Descriptors need a `redactResponse` hook |
| 9.4 | **`serializeRecord` emits fields in `Object.entries` order** — i.e. whatever order someone typed the object literal in `buildEdits` — while unedited records use document order. `canonicalize` sorts by path, so the guard is blind to intra-record order. **For an `xsd:sequence` type this is F1.1's bug one level deeper**, and F1.1 does not address it |
| 9.5 | **F1.1 will fight its own guard.** `expectedCanonical` re-inserts a replaced collection **last** in Map order. An order-comparing guard built on that would expect the new `<infos>` at the end while the fixed serializer inserts it mid-sequence — failing on exactly the S3/S4 case F1.1 exists to enable. F1.1 must specify: compare **relative to the response**, or **absolutely against `WS_CARD_SEQUENCE`**? And what if the vendor's own response is out of sequence? |
| 9.6 | **`stepUp` conflates two gates with two timings.** Override's is pre-flight and body-only (before `prepare`); fraud-unlock and DRID-removal are mid-plan, post-fresh-read. Two of the three also need inputs that are in neither `body` nor `doc` (a Supabase read of the mirrored status; `promptsEdits(...).removedInfoIds` plus `hasFreshAuth(req)`). A generated router calling `stepUp(body)` once up front makes **the fraud and DRID gates silently disappear** while every fitness assertion passes. Split into `preflightStepUp` and `planStepUp` |
| 9.7 | **Limiter ordering is a documented invariant with no test.** `enforceCardWriteLimit` is called **last** inside `prepare` so a refusal never spends a slot — *"'You have reached today's maximum of 25 fuel overrides' after twenty-five malformed requests is a lie."* The descriptor's `stepUp(body, doc?)` takes a `doc` that only exists **after** `prepare`, i.e. after the limiter is spent. Inverting it passes every existing test |
| 9.8 | **`mutationFingerprint` is passed per-route as a literal.** A generated route that omits it silently reinstates the pre-0180 bug where a reused Idempotency-Key replays an unrelated outcome. Zero tests mention it |
| 9.9 | **Promotion state machine** — no transition test, no suspend-mid-flight test, no test that promotion is consulted on the direct path. And F1.7's "propagation bounded by a short TTL cache" is fiction: `loadCardControlAccess` issues live queries every request, which is *why* suspension is instant. Adding the cache would make the kill switch **slower**. Delete the sentence |
| 9.10 | **Detail budget vs fleet size** — nothing pins `budget > fleetSize` as an invariant, so it silently re-breaks as the fleet grows |
| 9.11 | **`lint:funcsize`'s 200-line cap will bite in S3**, not "eventually." `promptsEdits` is already 63 lines and gains 26 Info IDs, 7 validation types with a constraint, `ACCRUAL_CHECK` + `value`, and three optional fields. Plan the decomposition (a per-type table, not a switch) in F1 |
| 9.12 | **`override_clear` already breaks the key model.** It is one intent with two dispatch mechanisms selected at request time. §2.2 says `key` is the registry key; §2.3 says the registry is keyed by `intent`; §2.4 asserts a bijection. Pick one: `intent` is the **audit** key (coarse, DB-constrained), `key` is the **capability** key (fine, code-only). Many-to-one. Add `capability_key` to the ledger — which is also what makes §1.4's fix work |

---

## 10. Guardrails against AI-specific failure modes

You asked for this specifically. These are the ways an AI implementer characteristically damages a codebase like yours, ordered by how much damage they do here. **These belong in the execution session's standing rules, not in a doc nobody re-reads.**

### 10.1 🔴 Weakening a gate to make it green

The highest-risk behaviour by a wide margin, because it is locally rational and globally catastrophic. Under pressure to produce a green run, the tempting moves are: add an entry to `GRANDFATHERED`, raise a pin, add `.skip`, loosen a regex, widen a Zod schema to accept the input that failed, delete the failing assertion, or catch-and-continue.

Your repo has already been bitten: `check-file-size.mjs`'s own header records that the first version's unconditional waiver list let four files grow **282 lines in three weeks** — *"the files the gate existed to contain became the only ones free to grow without limit."*

**Rule: a gate may never be weakened in the same commit as the change that made it fail.** Widening a pin, adding a waiver, or loosening a fitness regex is its own commit, with its own justification, reviewed on its own. If a gate blocks progress, **stop and report** — do not route around it.

### 10.2 🔴 Fabricated verification

Claiming a step passed without running it. Highest risk on the live-EFS steps, which cannot be run from a sandbox and where a plausible-sounding narration is easy to produce.

**Rule: every "Verify" claim is accompanied by the actual command and its actual output, pasted.** For live-EFS steps, the `read_state` before and after, verbatim. **"I ran it and it passed" is not a verification; it is a claim about a verification.** If a step cannot be run, say so and mark it blocked.

### 10.3 🔴 Comment-as-proof

Confirmed live in your codebase (§1.2): a comment asserting *"recorded as a property, not a hope — the test proves it"* where no such test exists. This is the AI-authored-documentation failure mode exactly: the comment describes the *intent* at the moment of writing, and nothing ever reconciles it with reality.

**Rule: a comment that claims a test exists must name the test.** And add a cheap fitness check: grep source comments for `test.ts` references and assert the named file contains a matching `it(`. Ten lines, catches a whole class.

### 10.4 🔴 Normalising vendor data

`trim()`, `toLowerCase()`, `toUpperCase()`, "cleaning up" a value on the way to the wire. This has **already cost you an incident** — H1, where a mis-cased status write returned an identical void success and was silently discarded.

**Rule: on the write path, vendor values are echoed byte-for-byte.** Any normalisation is a deliberate, named, tested adapter (like `matchStatusCasing`) — never an incidental `.trim()`. Note `serializeElement` already trims on echo; that is a latent instance of this bug, not a precedent.

### 10.5 🔴 Reimplementing instead of reusing

Writing a second XML serializer, a second redaction function, a second retry loop, a second session cache. Your own code already warns about this: *"a second serializer for experiments would be a second place to get the echo wrong — the exact class of bug Phase 0 exists to diagnose."*

**Rule: before writing a helper, grep for one.** Specifically banned without explicit approval: a second XML builder, a second `redactCardXml`, a second PAN mask, a second SOAP client, a second idempotency-key generator.

### 10.6 Tests that assert on the mock

The most common way AI-written tests are green and worthless: stub the thing under test, assert the stub was called with what you passed it. §2 of this audit is the same disease in production code — an expectation derived from the input it is checking.

**Rule: assert on the wire bytes, not on intermediate objects.** Your existing suite already does this well (`s.bodies[1]`); keep it. For any new guard, state explicitly *what the second, independent route is* — and if you cannot name it, the guard is a tautology.

### 10.7 Test names that promise more than the test delivers

Your convention — every `it` names the defect it prevents — is genuinely excellent and rare. It also creates a specific hazard: **a name is not a test**, and a well-named shallow test reads as coverage.

**Rule: point `pnpm mutation:check` at new modules during the F1 window.** It exists and is not in CI. A near-zero mutation score on the descriptor bindings *is* the finding — it converts "the tests pass" from vacuous to measured.

### 10.8 Over-abstraction ahead of evidence

The live risk in this plan. §5 shows the registry was fitted to five operations that were designed together, then assumed to generalise to twelve families it does not fit.

**Rule: the abstraction may only accommodate cases that exist in code today.** A descriptor field added "for S7" with no S7 implementation is speculative and gets deleted. Conversely, when an operation does not fit, that is data — extend the taxonomy explicitly, do not contort the operation.

### 10.9 Silent scope drift

Fixing unrelated things while in a file, renaming for consistency, "improving" a comment, reformatting. Every one of those makes the diff unreviewable and hides the real change.

**Rule: one step, one commit, and the diff contains nothing the step describes.** A tidy-up is its own commit.

### 10.10 Deleting institutional memory

Docblocks in this codebase carry incident history — the H1 casing finding, `0177`'s migration-numbering explanation, `check-file-size.mjs`'s account of its own failure, `cardWriteLimit.ts`'s explanation of why the limiter is called last. An AI refactoring for concision deletes these first, because they look like noise.

**Rule: never delete or rewrite a comment that references an incident, a date, an audit finding, or a ticket.** If code moves, the comment moves with it.

### 10.11 Plausible-but-wrong vendor knowledge

Inventing a SOAP field, an operation name, or a semantic that sounds right. `setCardv2` vs `setCardV2` is the live example — the guide says one thing, the WSDL says another, and the wrong one fails with an opaque Axis2 error.

**Rule: every vendor field, operation name and enum value cites the WSDL or the guide, by line.** The WSDL is not yet in the repo — **put it there in F0** (`docs/efs/CardManagementWS.wsdl`), with a retrieval date. It is the cheapest single risk reduction available.

### 10.12 Confusing "it ran" with "it worked"

The whole H1 lesson, and worth stating as a rule because it is the specific thing that makes EFS integration hard.

**Rule: a successful response is never evidence of a correct write. Only a re-read is.** Already Appendix C rule 6 — keep it at the top.

---

## 11. Enterprise-grade gaps the plan does not address at all

| # | Gap | What is missing |
|---|---|---|
| 11.1 | **Observability** | No metrics, no alerting. At minimum: mutation outcome rates by intent (succeeded / failed / drift / **unverified**), **`echo_unfaithful` count — which should be identically zero, so any occurrence pages**, session-breaker opens, promotion state changes, and mirror sweep completion. Today a rising unverified rate is invisible until someone opens the page |
| 11.2 | **Incident response** | No runbook. "A bad write landed on 40 cards" has no procedure. Needs: a bulk read to assess blast radius, the revert path (S8, and currently blocked on S1 modelling every field), and the WEX portal as the documented manual fallback. Write this **before** the first production promotion, not after the first incident |
| 11.3 | **Separation of duties** | `approved_by` exists in `0177` and nothing writes it. One person plans, applies, proves and promotes. For a control that can stop 199 trucks fuelling, that is thin. The `planCardMutation`/`applyCardMutation` seam is already built — this is cheap |
| 11.4 | **Disaster recovery** | Mirror corruption has no recovery procedure beyond waiting for a sweep. What restores `efs_cards` if a bad migration or a partial roster corrupts it? |
| 11.5 | **Change management** | Who is authorised to promote a capability to production, and is one person sufficient? Not defined |
| 11.6 | **Secrets rotation runbook** | F0.4 fixes session invalidation. There is no documented *procedure* for rotating the SOAP password or the client certificate — the sequence, who does it, how it is verified |
| 11.7 | **Vendor drift detection** | Nothing tells you EFS changed its schema. The mirror's unknown-element log (S1) is the right mechanism; make sure something *reads* it |
| 11.8 | **The unverified-outcome procedure** | The UI shows "sent, not confirmed." No documented action for the operator, and §8 shows the QA harness will produce these too |

---

## 12. What changes in the plan

Ordered by when it must happen.

### Before any code

1. **Answer the `lint:filesize` question** — why is `main` red, and is that gate in the required CI set? Every step depends on it.
2. **Decide the descriptor shape** — `verify(ctx)` not `landed(doc, body)`; explicit `target` discriminant; split `preflightStepUp`/`planStepUp`; `redactResponse` hook; three artifacts across api/shared/web with a cross-registry fitness test. (§5, §6, §9.3, §9.6)
3. **Decide the key model** — `intent` is the audit key, `key` is the capability key, many-to-one. Drop the bijection claim. (§9.12)
4. **Decide the approver-scope backfill rule** once, up front. (§7.7)

### Into F0

5. **Fix `routeAuth.test.ts`'s regex.** One line, and it is the precondition for the whole fitness strategy. (§1.1)
6. **F0.1b — the `replaceAll` preservation assertion.** ~2 days. Same change as making removal explicit, which F0.1 already requires. **Blocks S3.** (§2)
7. **Make `editsLanded` exact for `replaceAll` and `appendRecord`.** Count-only and empty-branch are both wrong for Phase C. (§2)
8. **Add `capability_key` and a redacted `request_body jsonb` to the ledger**, in the same migration window as the widened `status` CHECK. Then §1.4's fix is real. (§1.4, §9.12)
9. **Check the WSDL into the repo.** Cheapest risk reduction available. (§10.11)
10. **Wire `check-rls.mjs` into the standing gates**, or stop citing it. (§7.2)

### Into F1

11. **Invert the F1.2 gate** to *"faithful iff the only tests that changed are the route-enumeration fixtures, converted from literals to registry iteration"* — plus a wiring-table test asserting the full tuple per capability, plus characterisation tests written on `main` **first**, plus `mutation:check` pointed at `apps/api/src/efs/`. (§1.3, §7.4, §9.7, §9.8)
12. **Fitness test widened:** three CHECK constraints parsed from the **whole** migration directory; bucket **equality** against the mounted path, not existence. (§7.4, §7.6)
13. **Resolve F1.1's ambiguity** — relative-to-response or absolute-to-`WS_CARD_SEQUENCE` — and fix `serializeRecord`'s intra-record ordering at the same time. (§9.4, §9.5)

### Into §3 (the proof model)

14. **Three states, `unobserved` blocks.** Scan raw wire text. Descriptors declare emittable value sets. (§3)
15. **Split OEG-2 into 2a (local, read-only, run on all 199 production cards) and 2b (write, QA-only, per edit-shape).** State plainly that 2b is never obtainable for production. (§4)
16. **OEG-3 requires before-state ≠ target-state**, or the run is void. (§4)
17. **Re-plan the QA card assignment by required starting state and policy**, reserve empty-collection cards, give the harness a cap exemption, and write the "outcomed `sent`" procedure. (§8)

### Corrections to record

18. The registry pays down **two** filesize violations, not four. `cardControlContract.ts` will **grow**. (§6)
19. F1.3 is a 6-line *dispatch* change and a substantial *verification* change. (§5.2)
20. Delete the "short TTL cache" sentence from F1.7 — it would make the kill switch slower. (§9.9)
21. `lint:boundaries` not covering `apps/api` is doc-sourced, **not verified**. Confirm on the real tree before relying on it. (§6)

### New sections to write

22. **Observability and alerting** (§11.1) — before the first production promotion.
23. **Incident runbook** (§11.2) — before the first production promotion.
24. **Separation of duties** (§11.3) — `approved_by` is already in the schema.
25. **The AI guardrails in §10** — into the execution session's standing rules, not a doc.

---

## 13. What survives the audit intact

Worth saying, because the list above is long.

- **The echo-from-response-DOM design** is right, and for scalar fields and untouched collections the guard is genuinely strong. The defect is scoped to replaced collections.
- **The orchestration** — ledger before dispatch, always re-read, second look, four honest outcomes including "we don't know," never retry a write, DB-enforced one-pending-per-card — is better than most integrations of this kind and should not be touched.
- **The injectable `fetchImpl` threaded through every call in an operation**, not just the first, is what makes sequence testing real. Keep it.
- **The named-for-the-defect test convention** is the best thing in the suite.
- **`RETENTION_FORBIDDEN` enforced by an assertion** rather than a comment is the right model for every fitness test in this plan.
- **The vertical slicing** is right. The registry instinct is right. **The taxonomy is wrong and the proof model overclaims — both are fixable now, cheaply.**
