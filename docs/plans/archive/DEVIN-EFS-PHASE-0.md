# Devin task — EFS Phase 0: green the pipeline

## Context

CI has been red on `main` since `61a05ca` (2026-08-12). Because `migrate.yml`, `driver-android.yml` and `driver-ota.yml` are gated by the `require-ci-green` composite action, **no migration has reached the database and no driver build has shipped since that commit.** Your job is to make all twelve gates green and land a few hygiene fixes.

Baseline: `docs/EFS-RECON-REPORT.md`. Full plan: `docs/28-EFS-EXECUTION-PLAN.md` §Phase 0.

## Rules

1. **Branch:** `delivery-p0-green`, off current `main`. **One commit per step.** A commit's diff contains nothing its step describes.
2. **Never weaken a gate.** No `.skip`, no deleted assertion, no loosened regex, no widened type to swallow an error, no new waiver — **except the five pins in Step 6, which are pre-authorised with exact values and exact comments below.** Nothing else.
3. **Preserve what a test tests.** Steps 1–3 fix stale test *doubles*, not test *intent*. If a fix makes an assertion weaker, you have done it wrong.
4. **Stop and report** if a step's verify fails after a reasonable attempt, or if reality differs from what is described here. Do not improvise past it.
5. `.github/workflows/ci.yml` is protected. For steps that need a CI change, make the local change and put the exact `ci.yml` diff in the PR body for a human to apply.
6. Leave the pre-existing untracked `docs/2*.md` files and `fg2.tar.gz` alone.

## Verify as you go

After each step run the gate that step targets. Before the final push, run all twelve:

```bash
pnpm install --frozen-lockfile && pnpm --filter @fuelguard/shared build:rn
pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations \
  && pnpm lint:boundaries && pnpm lint:tests && pnpm lint:upserts \
  && pnpm lint:tokens-parity && pnpm lint:secrets && pnpm typecheck && pnpm test && pnpm build
```

Expected matrix counts: `rls` **375** · `hazmat_rls` **38** · `load-lifecycle` **61** · `duty-sessions` **25**.
`pnpm build` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — if you lack them, say so; that failure is environmental, not a defect.

---

## Step 1 — `requireFreshAuth.test.ts`: 6 of 6 failing

**File:** `apps/api/src/middleware/requireFreshAuth.test.ts`

`61a05ca` added `hasStepUpToken`, which calls `req.header(STEP_UP_TOKEN_HEADER)` and `getAppLocals(req).env`. The test's fake request is `{ auth: {...} } as unknown as Request` — **no `header` method** — so every call throws `TypeError`. The middleware is correct; the doubles are stale.

**Do:** give the fake request a `header` (returning `undefined` by default) and stub whatever `getAppLocals` needs. Keep all five existing `it` blocks and their assertions intact. Then **add** two cases that are currently missing:

- *"a valid step-up token passes with no iat at all"*
- *"a step-up token minted for a different org does not pass"*

**Verify:** `pnpm --filter @fuelguard/api test src/middleware/requireFreshAuth.test.ts` — 0 failing.

---

## Step 2 — `efsCardEdits.test.ts`: 3 typecheck errors

**File:** `apps/api/src/services/efsCardEdits.test.ts` (~`:76-78`)

The test reads `[0]!.value` on `CardEdit[]`, but the union now includes `{ op: "setFieldNil"; name: string }`, which has no `value`.

**Do:** narrow before reading. A small local helper is fine:

```ts
const setField = (e: CardEdit) => {
  if (e.op !== "setField") throw new Error(`expected setField, got ${e.op}`);
  return e;
};
// setField(lockEdits("Hold", "Active")[0]!).value
```

**Do not** cast, use `any`, or widen `CardEdit`. The narrowing must fail loudly if the edit shape changes.

> `CardEdit` is exported from `apps/api/src/lib/efsCardEcho.ts` and only *imported* by `efsCardEdits.ts`. Import it from its owner.

**Verify:** the three `CardEdit.value` errors are gone. `pnpm typecheck` will still fail on Step 2b until that lands — that is expected.

---

## Step 2b — `extract.test.ts`: 1 typecheck error *(not card control)*

**File:** `apps/api/src/services/hazmatExtraction/extract.test.ts` (~`:86`)

```
error TS2741: Property 'otherFreightAboard' is missing in type '{...}'
             but required in type '{...}'
```

**Cause:** `otherFreightAboard: z.boolean().nullable().default(null)` was added to the load schema at `packages/hazmat-engine/src/types.ts:90`. A zod `.default()` makes the field **optional on input but required on the inferred output type** — and this test builds a `LoadInput` as an object literal rather than parsing it, so TypeScript requires it.

**Do:** add `otherFreightAboard: null` to the `LoadInput` literal. `null` is the correct value — `compute.ts:380` documents it as *"asserted conservatively with both assumptions (pre-0.11 behavior)"*, which is the behaviour this test was written against, so the assertions still mean what they meant.

Check for other hand-built `LoadInput` literals while you are there; `tsc` reports every error at once, so if it only named this one, this one is all there is.

**Do not** make the field optional in the schema, and do not remove the `.default()`. The type is correct; the fixture is stale.

**Verify:** `pnpm typecheck` — **whole workspace clean.** Commit Steps 2 and 2b separately.

---

## Step 3 — `CardControlDrawer.test.ts`: 1 failing

**File:** `apps/web/src/features/fuelCards/CardControlDrawer.test.ts`

Failing: *"does not dispatch a second time while the first confirm is in flight"* — `Button not found: Lock card. Present: Back | Locking…`. The confirmation replaces the body, so after the first confirm the section button is gone and the footer shows `Back | Locking…`.

**Do:** target the footer's busy confirm button for the second click. **The test must still prove the re-entrancy guard** — that a second click while in flight does not produce a second `mutateAsync` call. If your fix stops asserting that, redo it.

**Verify:** `pnpm --filter @fuelguard/web test src/features/fuelCards/CardControlDrawer.test.ts` — 12 passing.

---

## Step 4 — `pnpm lint`: 3 errors

- `apps/web/src/features/hazmat/calcModel.ts:339,340` — `no-control-regex` on `\x00`
- `scripts/samsara-vs-store-recon.mjs:21` — `existsSync` imported and unused

**Do:** for the regexes, determine whether matching `\x00` is intentional. If yes, add an inline `eslint-disable-next-line no-control-regex` **with a comment saying why the null byte is matched deliberately**. If no, fix the regex. Remove the unused import.

**Verify:** `pnpm lint` — 0 problems.

---

## Step 5 — `pnpm lint:funcsize`: 4 violations

| Function | Lines | |
|---|---|---|
| `apps/api/src/services/idleRollup.ts#syncIdleRollup` | 225 | over budget |
| `apps/api/src/services/idleSync.ts#syncIdleEvents` | 252 | **grew past its 248 pin** |
| `apps/api/src/services/samsaraVehicleSync.ts#syncVehiclesFromSamsara` | 221 | over budget |
| `apps/api/src/services/scoring/backfill.ts#backfillOrg` | 203 | over budget |

**Do:** split each into an orchestrator plus stage helpers — the pattern the gate's own message names, and the one `scoreTransaction` already followed. **`syncIdleEvents` grew past a pin: refactor it, do not re-pin it.** Behaviour-preserving only; every existing test must pass unedited.

Do `idleRollup.ts` **first** — its split also brings the file under 500, which Step 6 depends on.

**Verify:** `pnpm lint:funcsize` — 0 violations. `pnpm test` — **no test your refactor touches needed editing, and no NEW failure appears.** A pre-existing failure elsewhere does not block this commit; report it and carry on.

---

## Step 5b — `fuelCardsControl.test.ts`: 1 stale contract assertion

**File:** `apps/api/src/routes/fuelCardsControl.test.ts` (~`:127`)

Failing: *"requires a reason on every write"* — expected 400, got 403.

**This is a stale test, not an ordering bug.** `reason` was deliberately made optional — `packages/shared/src/cardControlContract.ts:250-258` says so in its own docblock:

> *"OPTIONAL as of 2026-08-12 (product decision B1): the mutation stands on actor, intent, step-up flag and the before/after documents; the free-text why is welcome but no longer demanded. Kept as a field (defaulting to empty) so an org that wants reasons back gets a UI change, not an API change. min(3) applies only when a reason IS given."*

So a body with no reason is **valid**, validation passes, and the request reaches the kill switch in `prepare()`, which correctly returns 403 `card_control_disabled` in the test environment. The sibling test *"requires an expectedVersion on every write"* still passes — `cardVersionSchema` has no default — which proves the 400 path and the validation-before-gates ordering are both intact.

**Do:** replace the assertion with one that pins the **actual** contract. Rename it to something like *"accepts a missing reason, but refuses a malformed one (B1)"*, and assert:

1. **Missing reason, all five routes** → `403` with code `card_control_disabled`. Validation passed; the gate fired. *(Asserting `not.toBe(400)` would be weaker — be explicit, it documents the ordering.)*
2. **A 1-character reason, one route** → `400`. `min(3)` applies when a reason *is* given.
3. **A 201-character reason, one route** → `400`.

Cases 2 and 3 need only one route — `cardReasonSchema` is shared by all five, so proving it once proves it everywhere. That is **7 requests replacing 5**; update the `withServer()` request-count comment at the top of the describe block and keep the block **under 28** (the `/api/fuel-cards` limiter is 30 per 15 min).

This is strictly more coverage than the original and it pins B1 so it cannot silently regress.

**Do not** make `reason` required again. That is a product decision, it was made deliberately, and Phase 3 revisits it properly (see below).

**Verify:** `pnpm --filter @fuelguard/api test src/routes/fuelCardsControl.test.ts` — 35 passing. Then `pnpm test` — unit suites green.

---

## Step 6 — `pnpm lint:filesize`: 8 over budget + 1 grown pin

**This step contains the only pre-authorised waivers in Phase 0. Add exactly these, with exactly these comments. Do not add any others.**

### 6a — Split (no phase touches these)

- `apps/web/src/features/hazmat/HazmatCalculatorForm.vue` (541)
- `packages/hazmat-engine/src/placards/compute.ts` (518)
- `apps/api/src/services/idleRollup.ts` (504) — already handled if you did Step 5 first; confirm it is under 500

Use the `smartFueling/` / `recon/` module pattern the gate message names. Behaviour-preserving.

### 6b — Pin (Phase 3 and Phase 4 restructure these)

Add to `GRANDFATHERED` in `scripts/check-file-size.mjs`, verbatim:

```js
  // Pinned 2026-08-13 — EFS card-control plan (docs/28-EFS-EXECUTION-PLAN.md) Phase 0 Step 0.6.
  // Phase 3 (the capability registry) restructures all four: control.ts becomes a generated
  // factory, efsCardControl.ts splits into five orchestrator phase modules, cardControlContract.ts
  // splits into per-capability contracts, cardControlModel.ts loses its per-intent confirmations to
  // the view modules. Splitting them now and again in Phase 3 is two refactors of the same code.
  // PHASE 3'S EXIT GATE DELETES THESE FOUR ENTRIES. If they are still here after Phase 3, that is a
  // bug in the plan, not a new normal.
  "apps/api/src/routes/fuelCards/control.ts": 528,
  "apps/api/src/services/efsCardControl.ts": 540,
  "packages/shared/src/cardControlContract.ts": 529,
  "apps/web/src/features/fuelCards/cardControlModel.ts": 542,
  // Pinned 2026-08-13 for a different reason. Phase 1 Step 1.2 adds an org-ownership guard to the
  // probe routers; that guard lives in ONE shared helper imported by all three, so this file must
  // not grow. Removed when the Phase 4 harness supersedes the experiment router.
  "apps/api/src/routes/fuelCards/experiments.ts": 517,
```

Use the numbers **the script reports**, not `wc -l` — they differ by one.

### 6c — `samsara.ts` 686 vs pin 670 — conditional

Run `git log -p --follow apps/api/src/lib/samsara.ts` over the range that added the 16 lines and report what it is.

- **Formatting or comments only → re-pin at 686**, with a comment saying so and citing the commit. (The previous re-pin was Prettier reflow; the file's own note records it.)
- **New logic → do not re-pin.** Split the file or move the new logic into a module. Report which you did.

**Verify:** `pnpm lint:filesize` — 0 failures.

---

## Step 7 — Route-auth fitness regex

**File:** `apps/api/src/routeAuth.test.ts` (~`:37`)

The regex is `/app\.use\("(\/api\/[^"]+)"\s*,[^)]*?\w+Router\(\)\)/g`. `[^)]*?` cannot cross the `)` of the first `Router()`, so the six-factory mount at `app.ts:222` is invisible — 26 routers discovered, `/api/fuel-cards` not among them.

**Do:** widen it to match a mount with one *or more* router factories. Keep the non-empty-discovery guard and raise its threshold to match the new count.

**Verify:**

```bash
node -e '
const fs=require("fs");
const src=fs.readFileSync("apps/api/src/app.ts","utf8");
const t=fs.readFileSync("apps/api/src/routeAuth.test.ts","utf8");
const m=t.match(/const re = (\/.*\/[gimsuy]*);/);
const body=m[1].slice(1,m[1].lastIndexOf("/"));
const found=[...src.matchAll(new RegExp(body,"g"))].map(x=>x[1]);
console.log("count:",found.length,"| fuel-cards:",found.includes("/api/fuel-cards"));
'
# must print fuel-cards: true
```

Then `pnpm --filter @fuelguard/api test src/routeAuth.test.ts` — all six card-control routers pass the 401 assertion.

---

## Step 8 — Correct the false comment

**File:** `apps/api/src/services/efsCardEdits.ts:149-152`

The comment claims *"`efsCardEdits.test.ts` proves it with a record carrying a nested child."* There is no such test — zero matches for `nest` or `child` in that file.

**Do — preferred:** write the test. Feed `recordFromElement` an element containing a nested container, build a `replaceAll` from it, and assert `assertEchoFidelity` **throws** (the flattened request cannot match the expected canonical form). Then the comment is true.
**Fallback:** if the property does not actually hold, say so plainly in the comment and report it — that is a finding.

**Verify:** Step 9's check passes.

---

## Step 9 — Comment-claims fitness check *(spec corrected)*

**The original spec was too weak and its verify was impossible — you were right to stop.** "The named file exists and has at least one `it(`" is true of nearly every reference, so it could never have failed on `efsCardEdits.ts:152`. Here is the version that actually bites.

**Files:** `scripts/check-comment-claims.mjs` (new), `package.json` (`"lint:comment-claims"`), `ci.yml` diff in the PR body.

**The rule.** Scan comments in non-test source under `apps/*/src` and `packages/*/src`. For each comment that references a `*.test.ts` file:

- **If the comment makes a proof claim** — it contains any of `prove`, `proves`, `proven`, `asserted by`, `pinned by`, `recorded as a property`, `tripwire`, `verified in`, `go red`, `fails CI if` (case-insensitive) — then it **must also contain a double-quoted fragment**, and that fragment must appear inside an `it(`, `it.each(`, or `describe(` title in the referenced file.
- **If it makes no proof claim**, only assert the referenced file exists.

Report `file:line`, the referenced test file, and which rule failed.

This matches the convention already in the codebase: `apps/api/src/services/efsCardReconcile.ts:38` cites `"NOT land"`, and that fragment does appear in the referenced titles. That comment must pass.

### The three violations you found are three different things

Your run found `app.ts:214`, `efsCardEdits.ts:151`, `efsIngest.ts:275`. They need three different treatments, and the "commit only the checker" instruction was too tight — it is lifted for the files named below.

**1. `efsCardEdits.ts:151` — false positive. Fix the checker.**
Your corrected comment says *"This is a known gap, **not a proven** property"*. It **denies** a proof; my phrase list flagged the word `proven` regardless. That is a bug in my spec.

Add an explicit escape marker rather than guessing at negation: **if the comment contains the literal `[no-test-claim]`, require only that the referenced file exists.** Then add that marker to this comment. An explicit marker at the site beats a heuristic — a reader sees exactly why it is exempt, and it cannot drift.

**2. `app.ts:214` — a real uncited claim, and in scope. Fix the comment.**
*"routeAuth.test.ts discovers them from this line and fails CI if any one forgets it."* That claim was **false until your Step 7** — the regex did not discover this mount. Now that it is true, cite it: add a quoted fragment naming the relevant `it(`/`describe(` title from `routeAuth.test.ts`.

**3. `efsIngest.ts:275` — a real uncited claim, out of scope. Baseline it.**
*"Faithfulness contract with the manual path (verified in efsIngest.test.ts):"* is ingest code, unrelated to this work, and hunting a citable title there is scope creep. Follow the pattern this repo already uses for new gates — `check-file-size.mjs` and `check-function-size.mjs` both ship a pinned list of pre-existing violations:

```js
/**
 * Claims that predate this gate. The list may only SHRINK — cite the scenario, or add
 * [no-test-claim] if the comment does not actually assert a proof, then delete the entry.
 * Adding an entry instead of fixing one is a deliberate, reviewable act.
 */
const KNOWN_UNCITED = {
  "apps/api/src/services/efsIngest.ts": 275,
};
```

Fail if a listed entry moves to a different line or disappears, the same ratchet the sibling gates use.

**Verify — four runs. A fitness function that has never gone red is decoration.**

1. `pnpm lint:comment-claims` on the tree after the three fixes above → **passes**.
2. Remove `[no-test-claim]` from `efsCardEdits.ts:151` → **fails**, naming it. Restore.
3. Change `efsCardReconcile.ts:38`'s `"NOT land"` to `"NOT landed anywhere"` → **fails**, because no title contains that. Revert.
4. Delete the `efsIngest.ts` entry from `KNOWN_UNCITED` → **fails**, naming it. Restore.

Paste all four outputs. Commit: the checker, the `package.json` entry, and the two comment edits (`efsCardEdits.ts`, `app.ts`). Nothing else.

---

## Step 10 — Wire `check-rls.mjs`

**Files:** `package.json` (`"lint:rls": "node scripts/check-rls.mjs"`), `ci.yml` diff in the PR body.

`grep -rn "check-rls" package.json .github/ scripts/` currently returns nothing — the script exists and nothing runs it. Phase 4 creates two tables whose RLS posture it is meant to enforce.

**Verify:** `pnpm lint:rls` passes on the current schema. If it fails, **report the failures — do not fix schema in this phase.**

---

## Step 11 — WSDL into the repo

**Files:** `docs/efs/CardManagementWS.wsdl` (new), `scripts/check-wsdl-ops.mjs` (new), `package.json` (`"lint:wsdl"`), `ci.yml` diff in the PR body.

The WSDL is at `https://ws.partner.efsllc.com/axis2/services/CardManagementWS/?wsdl`. **Ask the user for the file if you cannot reach that host** — the egress IP is allowlisted and yours probably is not.

Commit it with a header comment recording the retrieval date and source URL. The check: every `CardManagementEP_<op>` string the code constructs must exist as an `<operation name="op">` in the WSDL.

**Verify:** passes. Temporarily rename one op in code → it fails.

---

## Step 12 — Railway: confirm the probe flag

Use the Railway CLI, as you have before. Report the value of these for **every** environment/service that runs `apps/api`:

`EFS_CARD_CONTROL_PROBE_ENABLED` · `EFS_CARD_CONTROL_ENABLED` · `EFS_SOAP_ENABLED` · `EFS_SOAP_ENVIRONMENT` · `EFS_SOAP_ENDPOINT_URL` (host only) · `EFS_CARD_DELETE_OVERRIDE_ENABLED` · `EFS_CARD_SYNC_MAX_DETAIL` · `EFS_CARD_MAX_MUTATIONS_PER_HOUR` · `EFS_SOAP_EGRESS_PROXY_URL` (set/unset only) · `NODE_ENV`

**Report values only. Change nothing.** Redact anything secret.

⚠️ **`EFS_CARD_CONTROL_PROBE_ENABLED=true` on any deployed environment is an urgent finding** — flag it at the top of your PR body. Until Phase 1 lands, the probe routers accept any card number from the request body with no org-ownership check.

---

## Deliverable

1. Push `delivery-p0-green` and open a PR against `main`.
2. PR body must contain, in this order:
   - **Any urgent finding** (Step 12's flag; a `lint:rls` failure; `samsara.ts` growth being logic not formatting)
   - **Gate table** — all twelve, before and after, with the matrix counts
   - **The exact `ci.yml` diff** to apply for Steps 9, 10, 11 (protected file)
   - **Step 6c decision** — what the samsara growth was, and what you did
   - **Step 12 environment table**
   - Anything that differed from this document
3. Do **not** merge.

## Out of scope — do not do these

- Removing the `iat` step-up fallback (Phase 1)
- Any change to `promptsEdits`, the echo engine, or `assertEchoFidelity` beyond Step 8's test
- Any migration
- Assigning QA card roles (needs the probe flag and Phase 1's guard first)
