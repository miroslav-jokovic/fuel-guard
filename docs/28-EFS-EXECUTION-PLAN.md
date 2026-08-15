# EFS Card Control — Execution Plan

**This is the only document you need to execute. Solutions only.**

| Reference | When to read it |
|---|---|
| `docs/27-EFS-CAPABILITY-ARCHITECTURE.md` | Before Phase 3. It defines the types; this plan does not repeat them |
| `docs/23-…-FINDINGS-2026-08-12.md` | Only if a step's intent is unclear |
| `docs/26-…-PLAN-AUDIT.md` | Only if you want the evidence for why a step exists |
| `docs/22-EFS-CARD-CONTROL.md` | Append every live EFS finding here, in the H1 format |
| `docs/30-HANDOFF-2026-08-15.md` | **First, every session.** Ordering decision, standing instructions, environment facts, open findings |

---

## §0 — Session protocol

**Read this section first, every session.**

### 0.1 Start of session

```bash
cd <repo> && git log --oneline -5 && git branch --show-current
pnpm verify:live                        # deployed HEAD + migration vs GET /api/version
node scripts/check-file-size.mjs        # expect: see Phase 0 note
```

1. Read §0, §1 (Status), and **only** your phase's section.
2. Your phase = the **first row in §1 not marked ✅**.
3. Confirm that phase's **Preconditions**. If any fails, stop and report — do not improvise.
4. Execute steps **in order**. A step is done when its Verify passes.
5. **Stop at the first failed Verify.** Report; do not proceed or work around.

### 0.2 End of session

1. Update the §1 Status row (✅ done · 🔶 partial with step number · ⛔ blocked with reason).
2. Append to §14 Handoff Log: date, phase, steps completed, anything surprising.
3. Commit both edits to this file.

### 0.3 Branch and merge

- One branch per phase: `delivery-p<N>-<slug>`.
- One commit per step. The diff contains nothing the step describes.
- Merge to `main` only after the phase Exit Gate is green **and** the user approves.
- Run the gates in a **clean clone** before merging.

### 0.4 Standing gates — run before every commit

**Sourced from `.github/workflows/ci.yml`, in its order. Never take this list from another document** — an earlier version of this plan copied it from a handoff doc, omitted four gates, and one of the four (`lint:ui-adoption`) was red on `main` the entire time.

```bash
pnpm lint:secrets                          # ci.yml runs this FIRST, before install
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn
pnpm lint
pnpm lint:filesize
pnpm lint:funcsize
pnpm lint:migrations
pnpm lint:upserts
pnpm lint:tests
pnpm --filter @fuelguard/web lint:tokens   # ← was missing from the old list
pnpm lint:tokens-parity
pnpm lint:ui-contrast                      # ← was missing
pnpm lint:chart-colors                     # ← was missing
pnpm lint:ui-adoption                      # ← was missing, and RED
pnpm lint:boundaries
pnpm typecheck
pnpm test
pnpm build
```

Plus the three Phase 0 additions, once their `ci.yml` diff is applied: `lint:comment-claims`, `lint:rls`, `lint:wsdl`.

**Re-derive whenever `ci.yml` changes:**
```bash
grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml | sed 's/run: //'
```

`pnpm build` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; CI supplies them. A local failure naming those is an environment gap, not a defect — do not guess values.

Matrix counts must hold: `rls` **377** · `hazmat_rls` **38** · `load-lifecycle` **61** · `duty-sessions` **25**. A count that *drops* is a finding; a count that rises is fine — re-baseline it here.

Re-baselined `rls` 375 → 377 on 2026-08-13: migration `0189_fuel_price_days` added a table, and the tenant-isolation sweep generates a leak test and an anon-lockout test per table. Confirmed to come from `main` alone, not from any card-control branch, by running the matrix on `origin/main` at `9ecaaf7`.

> `pnpm build` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the environment. A build failure naming those is a local env gap, not a code defect.

**CI runs all twelve gates** (`.github/workflows/ci.yml`, on push to `main` and on every PR). `migrate.yml`, `driver-android.yml` and `driver-ota.yml` are each gated by a local `require-ci-green` composite action — **so while CI is red, no migration reaches the database and no driver build ships.** That is why Phase 0 exists.

### 0.5 Standing rules

1. **Never weaken a gate to make it green.** No new `GRANDFATHERED` entry, no raised pin, no `.skip`, no loosened regex, no widened schema to accept what failed, no deleted assertion. A gate change is its own commit with its own justification. If a gate blocks you — **stop and report**.
2. **Never fabricate a verification.** Paste the command and its actual output. For live-EFS steps, paste `read_state` before and after.
3. **A comment claiming a test must name the test.**
4. **Never normalise vendor data on the write path.** No incidental `trim()`, `toLowerCase()`, `toUpperCase()`. Normalisation is a named, tested adapter.
5. **Never reimplement what exists.** Banned without approval: a second XML builder, a second `redactCardXml`, a second PAN mask, a second SOAP client, a second idempotency-key generator.
6. **Assert on wire bytes, not intermediate objects.** For any new guard, name the second independent route. If you cannot, it is a tautology.
7. **The abstraction may only accommodate cases that exist in code today.** Delete speculative fields.
8. **One step, one commit.**
9. **Never delete a comment referencing an incident, date, audit finding or ticket.**
10. **Every vendor field, operation and enum cites the WSDL or the guide, by line.**
11. **A successful response is never evidence of a correct write. Only a re-read is.**
12. **Never edit an applied migration.** Allocate numbers at execution time.
13. **No QA card numbers in the repo.** Last-4 only.
14. **Never leave a QA card dirty.** Every live run ends with a revert and a proving re-read.
15. **Unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy** after any session that needed it.
16. **Every finding gets a fix or a numbered step — never a mention.** If something is wrong and it is small, fix it in the same task. If it is not small, it becomes a numbered step in a phase, with an owner, before the session ends. "Flagging it for later" is how it gets forgotten, and this plan has already produced two examples: a comment claiming a test that did not exist, and a gate list copied from a stale doc.

### 0.9 Audit protocol — run after every executor update, before merge

Never accept a summary. Read the diff.

| # | Check | Command / method |
|---|---|---|
| 1 | **Scope** — does the diff match the steps, and nothing else? | `git diff --stat <base>..<branch>` |
| 2 | **Gate integrity** — did any gate config change? | `git diff <base>..<branch> -- scripts/ .github/` · new `GRANDFATHERED` entry, raised pin, loosened regex, widened allowlist |
| 3 | **Weakening scan** | `git diff … \| grep -nE "^\+.*(\.skip\|\.only\|eslint-disable\|@ts-ignore\|@ts-expect-error\|as any\|as unknown as\|toBeTruthy\(\)\|expect\.anything\(\))"` — each hit must be justified in the PR body |
| 4 | **Deleted assertions** | `git diff … -- '*.test.ts' \| grep -cE "^-.*expect\("` — every removal must be replaced by something stronger, not dropped |
| 5 | **Type safety** | new `any`, `as` casts, non-null `!` on values not proven non-null, `catch {}` that swallows |
| 6 | **Fail-closed** — for every new guard: what happens on error, missing config, unparseable input? | Read the code. It must **refuse**, never skip |
| 7 | **Behaviour preservation** on refactors | Did any pre-existing test need editing? If yes, the refactor was not behaviour-preserving — justify or redo |
| 8 | **Security-critical read** | Read the actual new auth/guard/crypto code line by line. Never spot-check by summary |
| 9 | **Non-blocking findings** | Apply rule 16 — fix now, or numbered step now |

### 0.6 QA cards

13 cards. Store the list outside the repo. Roles — assign once in Phase 0, record in §14:

| Role | Count | Required starting state |
|---|---|---|
| Status | 2 | one Active, one Hold |
| Prompts | 3 | one `infoSource=CARD`, one `POLICY`, **one that must keep an EMPTY `<infos>`** |
| Override / limits | 3 | **one that must keep EMPTY `<limits>`**; two with limits recorded before Phase 10 |
| Access controls | 2 | one with time restrictions, one without |
| **Control** | **2** | **never written to**; one must be on the **same policy** as an experiment card |
| Spare | 1 | |

### 0.7 Corrections from the recon report

Claims carried in from earlier documents that the recon **refuted**. Do not act on the old versions.

| Old claim | Reality (`docs/EFS-RECON-REPORT.md`) |
|---|---|
| CI has no `needs:`/`workflow_run:` edges, so a broken merge still runs `supabase db push` | **False.** `migrate.yml`, `driver-android.yml`, `driver-ota.yml` are each gated by a local `require-ci-green` composite action. The `grep needs:` heuristic was the wrong test. The claim came from `docs/AUDIT-2026-08-09.md:65-71` and is stale |
| `mutation:check` is not in CI | **False.** `.github/workflows/mutation-check.yml` runs it weekly and on pushes touching migrations, tests, API services and the mutation script |
| There is no e2e testing | **False.** `smoke.yml` runs Playwright Chromium against production, gated on a completed `deploy-verify` run |
| `verify:live` is not wired to deploy | **Half true.** The script itself is not in CI, but `deploy-verify.yml` polls `/api/version` on every push to `main` until the deployed commit and schema are current. The check is covered |
| `.gitleaks.toml` is missing, so secret scanning is unwired | **Not a problem.** `lint:secrets` runs first in `ci.yml` with a pinned gitleaks 8.18.4 and **passes** — 32 MB scanned, no leaks |
| Matrix counts 179 / 16 / 54 / 20 | **Stale.** Real: **375 / 38 / 61 / 25**, all passing |
| Migration numbering gaps at 0172 / 0174 / 0175 | **Gaps are at 0090 and 0172.** 182 unique numbered migrations; `lint:migrations` passes |
| `lint:boundaries` coverage of `apps/api` was unverified | **Confirmed: it does not inspect `apps/api/src`.** The `apps/api/src/efs/` placement in `docs/27` is safe |
| `lint:funcsize` excluding routes was unverified | **Confirmed.** Moving logic out of a router subjects it to the 200-line cap — Phase 9 Step 9.5 stands |

Still open after recon: the deployed value of `EFS_CARD_CONTROL_PROBE_ENABLED` (Step 0.14).

---

## §1 — Status

| # | Phase | Status | Branch |
|---|---|---|---|
| 0 | Green the pipeline | 🔶 *(PRs #3, #5 merged; **Step 0.13 outstanding** — QA card roles unassigned, which blocks Phases 9 and 10. Step 0.15 done in #5; all sixteen `ci.yml` gates green on `main` at `12a86a8`)* | `delivery-p0-green` |
| 1 | Emergency fixes | 🔶 *(code merged through PR #11. Live checks still not run: foreign-card probe → 404, step-up → 403, wrong password → `auth`, endpoint change → `endpoint_changed`, the 409 replay. Status, prompts and override-clear confirmed live on QA 2026-08-14)* | `delivery-p1-emergency` |
| 2 | Echo engine correctness | ⛔ *(2.1–2.5 merged, PRs #13–#21; echo scan green 197/197. **Exit gate FAILS:** the live check was run 2026-08-15 and the one org with card control has `write_entitlement = 'confirmed'` with a null `probed_identity_hash`, which the code grandfathers — **Step 2.6**. The gate wording is amended, identically to Phase 3's)* | `delivery-p2-echo` |
| 3 | Capability architecture | ✅ *(3.1–3.11 merged; **exit gate CLOSED 2026-08-15** — all five operations verified live on `af1a8e5`, card returned byte-identical. The read behind 3.11 proved this account never reports override scope on ANY card, `docs/22` H3. 3.5a withdrawn — it is Step 4.2)* | merged to `main` |
| 4 | Harness & promotion | ⬜ | `delivery-p4-harness` |
| 5 | Operational readiness | ⬜ *(5.6–5.10 filed 2026-08-15 from `docs/30` §6.G and Phase 2's two-hosts finding. Two §6.G items were small enough to fix on the spot and are done)* | `delivery-p5-ops` |
| 6 | Drawer shell | ⬜ | `delivery-p6-drawer` |
| 7 | Account & policy visibility | ⬜ *(7.7 card identity and 7.8 override staleness filed 2026-08-15. **7.7 is worth pulling forward** — 182 of 234 production cards are unlinked, so fuel attribution runs on a minority of the fleet)* | `delivery-p7-visibility` |
| 8 | Card status *(first production promotion)* | ⬜ | `delivery-p8-status` |
| 9 | Driver assignment & prompts | ⬜ | `delivery-p9-prompts` |
| 10 | Override with amount | ⬜ | `delivery-p10-override` |
| 11 | Spend limits & velocity | ⬜ | `delivery-p11-limits` |
| 12 | Access controls | ⬜ | `delivery-p12-access` |
| 13 | Card lifecycle | ⬜ | `delivery-p13-lifecycle` |
| 14 | Advanced | ⬜ | `delivery-p14-advanced` |

---

## Phase 0 — Green the pipeline

**Baseline established by `docs/EFS-RECON-REPORT.md` (commit `5b28b20`, branch `recon/efs-baseline`).**

**CI is red on `main`, and has been since `61a05ca` (2026-08-12) — the card-control hardening commit.** It added `hasStepUpToken` and widened the `CardEdit` union without updating three test files. Because `migrate.yml`, `driver-android.yml` and `driver-ota.yml` are each gated by `require-ci-green`, **no migration has reached the database and no driver build has shipped since.** Nothing in this plan can proceed until 0.1–0.6 are done.

Failing: `lint` · `lint:filesize` · `lint:funcsize` · `typecheck` · `test`.
Passing: `lint:migrations` · `lint:boundaries` · `lint:tests` · `lint:upserts` · `lint:tokens-parity` · `lint:secrets`.
(`build` failed only on missing `VITE_*` env vars in the recon sandbox — not a defect.)

**Preconditions:** none.

### Step 0.1 — `requireFreshAuth.test.ts` — 6 of 6 failing
**Files:** `apps/api/src/middleware/requireFreshAuth.test.ts`.
**Cause:** `61a05ca` added `hasStepUpToken`, which calls `req.header(STEP_UP_TOKEN_HEADER)`. The test's fake request is `{ auth: {...} } as unknown as Request` with **no `header` method**, so every call throws `TypeError`. **The middleware is correct; the test doubles are stale.**
**Change:** give the fake request a `header: vi.fn().mockReturnValue(undefined)` and stub `getAppLocals`. Add the missing coverage while you are there: *"a valid step-up token passes without any iat"* · *"a token minted for a different org does not"*.
**Verify:** `pnpm --filter @fuelguard/api test src/middleware/requireFreshAuth.test.ts` — 6+ passing, 0 failing.

### Step 0.2 — `efsCardEdits.test.ts` — 3 typecheck errors
**Files:** `apps/api/src/services/efsCardEdits.test.ts` (~`:76-78`).
**Cause:** the test reads `[0]!.value` on `CardEdit[]`, but the union now includes `{ op: "setFieldNil"; name: string }`, which has no `value`.
**Change:** narrow before reading — a small helper such as `expectSetField(edits[0]).value` that asserts `op === "setField"` first. **Do not widen the type or cast it away.**
**Verify:** `pnpm typecheck` — `apps/api` clean.

### Step 0.3 — `CardControlDrawer.test.ts` — 1 failing
**Files:** `apps/web/src/features/fuelCards/CardControlDrawer.test.ts`.
**Cause:** *"does not dispatch a second time while the first confirm is in flight"* fails with `Button not found: Lock card. Present: Back | Locking…`. The confirmation replaces the body, so the second click must target the footer's busy confirm button, not the section button.
**Change:** update the test to reflect the confirm-flow. **Preserve what it is testing** — the re-entrancy guard. Do not delete or skip it.
**Verify:** `pnpm --filter @fuelguard/web test src/features/fuelCards/CardControlDrawer.test.ts` — 12 passing.

### Step 0.4 — `lint` — 3 errors *(not card control)*
**Files:** `apps/web/src/features/hazmat/calcModel.ts` (`:339`, `:340`), `scripts/samsara-vs-store-recon.mjs` (`:21`).
**Change:** two `no-control-regex` errors on `\x00`, and one unused `existsSync` import. If the `\x00` matches are intentional, use an inline eslint-disable **with a comment explaining why**; otherwise fix the regexes.
**Verify:** `pnpm lint` — 0 problems.

### Step 0.5 — `lint:funcsize` — 4 violations *(not card control)*
**Files:** `apps/api/src/services/idleRollup.ts#syncIdleRollup` (225) · `idleSync.ts#syncIdleEvents` (252, **grew past its 248 pin**) · `samsaraVehicleSync.ts#syncVehiclesFromSamsara` (221) · `scoring/backfill.ts#backfillOrg` (203).
**Change:** split each into an orchestrator plus stage helpers, the pattern the gate's own message names. `syncIdleEvents` grew past a pin — **refactor it; do not re-pin.**
**Verify:** `pnpm lint:funcsize` — 0 violations.

### Step 0.6 — `lint:filesize` — 8 over budget + 1 grown pin ⚠️ **USER DECISION**
**Current:** `cardControlModel.ts` 542 · `HazmatCalculatorForm.vue` 541 · `efsCardControl.ts` 540 · `cardControlContract.ts` 529 · `control.ts` 528 · `compute.ts` 518 · `experiments.ts` 517 · `idleRollup.ts` 504. Plus `samsara.ts` 686 against a 670 pin.

**DECIDED (2026-08-13).** Splitting a file in Phase 0 that Phase 3 restructures is two refactors of the same code and twice the risk. So: **split what no phase touches; pin what Phase 3 rewrites, time-boxed to Phase 3.**

| File | Action | Why |
|---|---|---|
| `apps/web/src/features/hazmat/HazmatCalculatorForm.vue` 541 | **SPLIT** | No phase touches it |
| `packages/hazmat-engine/src/placards/compute.ts` 518 | **SPLIT** | No phase touches it |
| `apps/api/src/services/idleRollup.ts` 504 | **SPLIT** | No phase touches it — and the split also clears its `lint:funcsize` violation (Step 0.5), so one refactor fixes both gates |
| `apps/api/src/routes/fuelCards/control.ts` 528 | **PIN → Phase 3** | Becomes a generated factory in Step 3.7 |
| `apps/api/src/services/efsCardControl.ts` 540 | **PIN → Phase 3** | Splits into five orchestrator phase modules in Step 3.4 |
| `packages/shared/src/cardControlContract.ts` 529 | **PIN → Phase 3** | Splits into per-capability contracts in Step 3.3–3.6 |
| `apps/web/src/features/fuelCards/cardControlModel.ts` 542 | **PIN → Phase 3** | Loses its per-intent confirmations to the view modules in Step 3.6 |
| `apps/api/src/routes/fuelCards/experiments.ts` 517 | **PIN → Phase 4** | Phase 1 Step 1.2 must *add* a guard here. **That guard goes in a shared helper imported by all three probe routers** — one function, not three copies — so this file must not grow. Superseded by the Phase 4 harness |
| `apps/api/src/lib/samsara.ts` 686 vs pin 670 | **CONDITIONAL** | Run `git log -p -L1,700:apps/api/src/lib/samsara.ts` over the growth. **Formatting or comments → re-pin at 686** (the previous re-pin was Prettier reflow, per the file's own note). **New logic → split or revert.** Do not re-pin logic growth |

**The five pins are self-liquidating.** Each carries a comment naming the phase that deletes it, and **Phase 3's exit gate requires all four Phase-3 pins to be gone.** If they survive Phase 3, that is a bug in this plan, not a new normal.

**Verify:** `pnpm lint:filesize` — 0 failures. Every added waiver names its removing phase. Record in §14.

### Step 0.7 — Fix the route-auth fitness regex
**Files:** `apps/api/src/routeAuth.test.ts` (~`:37`).
**Confirmed by recon:** the regex discovers **26** routers and `/api/fuel-cards` is **not** among them, because `app.ts:222` mounts six router factories on one path and `[^)]*?` cannot cross the first `)`.
**Change:** widen the regex to handle multiple factories per mount.
**Verify:** re-run the recon's D1 snippet — `fuel-cards discovered? true`. Then `pnpm --filter @fuelguard/api test src/routeAuth.test.ts`; all six card-control routers must pass the 401 assertion.

### Step 0.8 — Correct the false comment
**Files:** `apps/api/src/services/efsCardEdits.ts:149-152`.
**Confirmed by recon:** the comment claims *"`efsCardEdits.test.ts` proves it with a record carrying a nested child"* — zero matches for `nest`/`child` in that file.
**Change:** either **write the test** (preferred — the property is worth having) or correct the comment to say the property is asserted by design, not by test. Do not leave it claiming a proof that does not exist.
**Verify:** Step 0.9's check passes.

### Step 0.9 — Comment-claims fitness check
**Files:** `scripts/check-comment-claims.mjs` (new), `package.json`, `.github/workflows/ci.yml` *(HUMAN — protected)*.
**Change:** grep source comments for `*.test.ts` references; assert the named file contains a matching `it(`.
**Verify:** it fails on `efsCardEdits.ts:152` before Step 0.8 and passes after.

### Step 0.10 — Wire `check-rls.mjs`
**Files:** `package.json`, `.github/workflows/ci.yml` *(HUMAN)*.
**Confirmed by recon:** `grep -rn "check-rls" package.json .github/ scripts/` → **NO REFERENCES**. Phase 4 creates two tables whose RLS posture this is supposed to enforce.
**Verify:** `pnpm lint:rls` runs in CI and passes on the current schema.

### Step 0.11 — Check the WSDL into the repo
**Files:** `docs/efs/CardManagementWS.wsdl` (new), `scripts/check-wsdl-ops.mjs` (new), `package.json`.
**Change:** commit the WSDL with a retrieval-date header. Add a check that every `CardManagementEP_*` operation the code constructs exists in it.
**Verify:** passes; deliberately rename one op in code → it fails.

### Step 0.12 — Approver-scope backfill rule
**DECIDED (2026-08-13): explicit grant for every new capability. A legacy grant never implies a new scope.**

- The **existing four scopes** (`lock`, `unlock`, `override`, `prompts`) stay granted to existing approvers, so nothing that works today stops working. Phase 4 Step 4.2's backfill covers this.
- **Every new scope is granted deliberately.** Widening the `0173` CHECK constraint only *permits* a value; it never grants it.
- Rationale: an approver was given `override` for the capability that existed then. Auto-granting them `hand_enter` (disables anti-skimming) or `card_pin` (resets PINs) is privilege creep by default, and it defeats the point of per-capability promotion. The cost is one backfill statement per phase.

**Consequence for every later phase:** a phase that adds a scope must also add its grant statement, or the capability promotes and nobody can use it. Add that to the phase's exit gate.

### Step 0.13 — Assign QA card roles ⏭ **DEFERRED to immediately after Phase 1 Step 1.2**
**Files:** §14 (last-4 only).
**Change:** map the 13 cards to §0.6's roles from **observed** state.
**Why deferred:** this needs `EFS_CARD_CONTROL_PROBE_ENABLED=true`, and until Step 1.2 lands the org-ownership guard the probe routers accept any card number from the request body. Run it as the first act after 1.2 merges, then unset the flag and redeploy.
**Verify:** the §14 table is complete and every row cites the observed state. **Phase 9 and Phase 10 cannot start without it** — they need the reserved empty-`<infos>` and empty-`<limits>` cards.

### Step 0.14 — Confirm the probe flag in the deployed environment
**Change:** recon could not inspect Railway variables. Confirm `EFS_CARD_CONTROL_PROBE_ENABLED` is **not** `true` in any deployed environment. If it is, that is a live hazard — the probe routers take card numbers straight from the request body with no org check until Phase 1 Step 1.2.
**Verify:** value recorded in §14.

### Step 0.15 — `lint:ui-adoption` — 5 raw page/feature buttons ✅ **DONE (PR #5)**

**Phase 0's exit gate was measured against a 12-gate list. `ci.yml` runs 16.** `lint:ui-adoption` (`ci.yml:79`) is red and has been all along, so `require-ci-green` still blocks `migrate.yml` — **migration 0185 from Phase 1A cannot apply until this is fixed.**

`scripts/ui-system-inventory.mjs --check` fails on `rawButtonsInPagesAndFeatures = 5`:

| File | Count | Note |
|---|---|---|
| `apps/web/src/features/hazmat/HazmatCalculatorForm.vue` | 3 (`:169`, `:177`, `:248`) | unrelated to EFS |
| `apps/web/src/features/hazmat/HazmatProductLines.vue` | 1 (`:202`) | moved here by Phase 0's split; not new |
| `apps/web/src/features/fuelCards/ActiveOverridesPanel.vue` | 1 (`:57`) | **card control** — Phase 6 Step 6.3 edits this file anyway |

**Do:** convert each to the design-system primitive. Assess per case — `:248` and `:202` are inline text affordances ("Change", "use it") and may want a link primitive rather than `AppButton`; `ActiveOverridesPanel:57` is a row target. **There is no allowlist for raw buttons and adding one would be weakening** — the checker only exempts routed pages missing a `PageHeader`.

**Verify:** `pnpm lint:ui-adoption` green, plus `lint:ui-contrast`, `lint:chart-colors` and `pnpm --filter @fuelguard/web lint:tokens` still green. Existing web tests pass.

**Land it on `delivery-p0-green`** — greening the pipeline is Phase 0's job, and PR #3 should not merge red.

### ✅ Exit Gate — Phase 0
- [x] **All sixteen `ci.yml` gates green** — verified against `ci.yml`, not against a doc *(CI green on `main` at `12a86a8`)*
- [x] `requireFreshAuth.test.ts`, `efsCardEdits.test.ts`, `CardControlDrawer.test.ts` all green, with what they test preserved
- [x] `routeAuth.test.ts` discovers `/api/fuel-cards`
- [x] The false comment is corrected and the comment-claims check enforces it
- [x] `check-rls` wired; WSDL committed with its op check
- [x] Filesize decision recorded per file, with every waiver naming the phase that removes it
- [ ] Approver-scope rule decided ✅; **QA card roles assigned ⛔ Step 0.13**; probe flag confirmed unset ✅

---

## Phase 1 — Emergency fixes

**Goal:** stop the data loss; close the open doors.
**Preconditions:** Phase 0 ✅.

### Step 1.1 — Fix `reportValue` prompt deletion
**Files:**
- `packages/shared/src/cardControlContract.ts` — `promptInputSchema`, `setPromptsSchema`
- `apps/api/src/services/efsCardEdits.ts` — `promptsEdits`
- `apps/api/src/routes/fuelCards/control.ts` — the prompts handler's removal guard
- `apps/web/src/pages/FuelCardDetailPage.vue` — `cardPrompts` (~`:43-51`)
- `apps/web/src/features/fuelCards/CardControlDrawer.vue` — seed (~`:136-142`), submit (~`:225`)
- `apps/web/src/features/fuelCards/CardPromptsPanel.vue`

**Change:**
- `promptInputSchema` gains `reportValue: z.string().trim().max(EFS_MATCH_VALUE_MAX).nullable()`. Replace the single refine with two: `EXACT_MATCH` requires non-empty `matchValue`; `REPORT_ONLY` requires non-empty `reportValue`.
- Add explicit removal: `CardEdit`'s `replaceAll` gains `removals: readonly string[]`, and `setPromptsSchema` gains `removeInfoIds: z.array(z.string()).default([])`. **Removal is never inferred from an empty string.**
- `promptsEdits`: removal driven only by the explicit list; update path writes `reportValue` for `REPORT_ONLY` and `matchValue` for `EXACT_MATCH`, blanking the other; append path populates `reportValue` from input instead of hardcoding `""`.
- Route: require the explicit list for **any** removal, and step-up for any removal.
- Web: carry `reportValue` end to end; **delete the empty-string filter**; add an explicit "Remove this prompt" danger button; delete the `removals`/`removesDriverId` inference in the panel.

**Verify:**
- New fixture `apps/api/src/lib/__fixtures__/efs/getCardV2.reportOnly.xml` — a `UNIT` record with empty `matchValue`, `reportValue=T001`, `REPORT_ONLY`.
- `efsCardEdits.test.ts`: *"does not remove a REPORT_ONLY prompt when the operator changes nothing"* · *"writes reportValue, not matchValue, when switching EXACT_MATCH → REPORT_ONLY"* · *"appends a REPORT_ONLY prompt with its report value"*.
- Route test: *"refuses a prompt removal without the explicit list"* → 400.
- Web test: *"a no-op save on a REPORT_ONLY card sends the prompt back unchanged"*.
- **Live QA** (prompts card, `infoSource=CARD`): `read_state` → open drawer, change nothing, save → `read_state`. `infos` must be **byte-identical**.

### Step 1.2 — Probe org + production guards
**Files:** `apps/api/src/routes/fuelCards/probe.ts`, `writeProbe.ts`, `experiments.ts`; `apps/api/src/env.ts`.
**Change:** before any SOAP call, resolve `cardNumber` through the org-scoped mirror lookup used by `control.ts` (`efsCardMirror.ts` `loadCardByNumber`) → **404** if not in the caller's org. Add `EFS_ALLOW_PRODUCTION_PROBE` (default `false`); refuse when the resolved credentials' `environment === "production"` or the endpoint host is the production host, unless it is `"true"`.
**Verify:** tests for both refusals. **Deployed:** QA-org admin + a production card number → 404.

### Step 1.3 — Remove the step-up `iat` fallback
**Files:** `apps/api/src/middleware/requireFreshAuth.ts`.
**Change:** delete the `iat` branch from `requireFreshAuth` and `hasFreshAuth`; both reduce to `hasStepUpToken`. Keep `DEFAULT_STEP_UP_MAX_AGE_SEC` in the 403 payload.
**Before starting:** grep for non-browser callers of the five step-up routes. The web app is already migrated (`apps/web/src/lib/api.ts` spreads `stepUpHeader()` into every request).
**Verify:** Phase 0 Step 0.1 already repaired this test file and added token-path coverage. Now invert the `iat` cases: *"a fresh iat alone no longer satisfies step-up"* (was passing, must now fail closed) · *"a valid token does"* · *"an expired token does not"* · *"a token for a different org does not"*. **Deployed:** refresh the session token, retry a step-up action without the password → still **403**.

### Step 1.4 — Rotation invalidates sessions
**Files:** `apps/api/src/services/efsSoapCredentials.ts`, `apps/api/src/routes/integrations.ts`, `apps/api/src/lib/efsSoapSession.ts`.
**Change:** call `__resetEfsSessions(creds)` and `invalidatePolicy(orgId)` at the end of `upsertEfsSoapCredentials` and `disableEfsSoapCredentials`, and at the cert activate/rollback/retire sites — same placement as the existing `invalidateTlsAgents` calls (immediately after the state change, before `writeAudit`). Include a hash of the password and the active cert fingerprint in `sessionKey`.
**Verify:** *"a password change produces a different session key"* · *"upserting credentials clears the cached session"*. **Deployed:** rotate to a wrong password → the next read fails `auth`, not cached success.

### Step 1.5 — Endpoint / environment binding
**Files:** new migration; `apps/api/src/services/efsSoapCredentials.ts`, `apps/api/src/services/efsCardControlAccess.ts`, `apps/api/src/routes/fuelCards/writeProbe.ts`, `apps/api/src/routes/integrations.ts`, `apps/api/src/env.ts`, `packages/shared/src/cardControlContract.ts`.
**Change:**
- Migration (allocate the number): `efs_card_control_settings` gains `probed_endpoint_host text`, `probed_document_shape text`; `efs_card_mutations` gains `environment text`, `endpoint_host text`, `card_last4 text`.
- `upsertEfsSoapCredentials` takes `env`, validates `environment` against the endpoint host, and on any change to either resets `write_entitlement='unknown'` and `enabled=false` with an audit row.
- `loadCardControlAccess` refuses when the current endpoint host differs from `probed_endpoint_host`. Add `blockedBy: "endpoint_changed"` to `cardCapabilitiesSchema`.
- `writeProbe` persists `probed_endpoint_host` and `probed_document_shape`.
- `requireFreshAuth()` on `POST /efs-soap/enable` and `/disable`.
- `EFS_SOAP_ENVIRONMENT` default `production` → `sandbox`.
- Carry `environment`, `endpoint_host`, `card_last4` into the ledger row and audit meta.

**Verify:** `pnpm verify:live` → `schema.applied` is the new number, `drift: false`. Tests for each refusal. **Deployed:** change `endpoint_url` → card control blocked with `endpoint_changed`; re-probe restores.

### Step 1.6 — Redaction hardening
**Files:** `apps/api/src/lib/efsCardXml.ts` (`redactCardXml`, ~`:394-409`), `apps/api/src/services/efsCardMirror.ts` (~`:489`).
**Change:** widen the digit mask from `\b\d{12,25}\b` to `\b\d{10,25}\b`. **Add an alphanumeric-suffix rule** — `\b\d{10,25}[A-Z]{2,6}\b` — because `7083…111OVER` has no word boundary before `O` and is currently emitted in the clear inside fault messages. Add `fromCard` and `toCard` to the masked element-name list.
**Verify:** *"a 10-digit card number in a fault message is masked"* · *"a card number with an OVER suffix is masked in a fault message"* · *"transferCard's fromCard is masked"*. Update the payload scanner to look for 10+ digit runs.

### Step 1.7 — Seal the SOAP password
**Files:** new migration; `apps/api/src/services/efsSoapCredentials.ts`.
**Change:** seal `soap_password` with `secretBox`, AAD `(orgId, "efs_soap_password.v1")` — the same pattern as `efs_soap_client_key.v1`. Read path falls back to unsealed legacy rows. One-shot backfill.
**Verify:** *"a sealed password round-trips"* · *"an unsealed legacy row still reads"*. **Deployed:** a card read still works after backfill.

### Step 1.8 — Small independent fixes
**Files:** `apps/api/src/routes/fuelCards/control.ts`, `apps/api/src/lib/efsSoapSession.ts`, `apps/api/src/lib/efsCardWrite.ts`, `apps/api/src/services/efsCardControl.ts`, `apps/api/src/lib/audit.ts`, `apps/api/src/services/dataRetention.ts`.
**Change:**
- `Idempotency-Key` becomes **required** — 400 when absent.
- Add `/flying\s*j/i` to `FAULT_CODES`.
- Extend `firstScalar` / `classifySetCardResponse` to recognise `errorNumber`/`errorDesc` documents and classify them as failed, carrying the vendor's text into the ledger.
- Wire `EFS_CARD_WRITE_TIMEOUT_MS` as a real whole-orchestration deadline (an `AbortController` spanning read → write → verify).
- A failed `writeAudit` becomes a loud alert, not a silent `false`.
- Add `efs_card_mutations` to `RETENTION_FORBIDDEN`.

**Verify:** one test each, named for the defect.

### ✅ Exit Gate — Phase 1
- [ ] Live QA: no-op prompt save leaves `infos` byte-identical
- [ ] Live QA: probe with a foreign card → 404
- [ ] Live QA: refresh-token-only step-up attempt → 403
- [ ] Live QA: wrong password → next read fails `auth`
- [ ] Live QA: endpoint change → `endpoint_changed`
- [ ] `pnpm verify:live` clean
- [ ] Standing gates green; QA cards restored

---

## Phase 2 — Echo engine correctness

**Goal:** make the echo guard actually guard. **Phase 9 and Phase 10 are blocked on this.**
**Preconditions:** Phase 1 ✅ (Step 1.1 introduced `replaceAll.removals`, which Step 2.1 needs).

### ✅ Step 2.1 — `replaceAll` preservation assertion — DONE, PR #13 (`ab27058`)
**Files:** `apps/api/src/lib/efsCardEcho.ts` (`expectedCanonical` ~`:255-323`, `assertEchoFidelity` ~`:405-429`).
**Change:** the expectation for a replaced collection is currently built from the same `replace.records` array the request is built from, so the guard cannot detect a dropped record. Add an assertion computed from the **response DOM**: *every record present before is present after, unless its identity key appears in the edit's explicit `removals` list.* Identity key per collection — `infoId` for `infos`, `limitId` for `limits`, `day` for `timeRestrictions`.
**Verify:**
- *"a replaceAll that silently drops a record is refused"* → `echo_unfaithful`
- *"a replaceAll with an explicit removal is allowed"*
- **Replay the Phase 1 `reportValue` bug through the guard and assert it now throws.** This is the acceptance criterion.

**Also fix the nested-container sub-defect, confirmed independently during Phase 0 Step 0.8.** `recordFromElement` (`apps/api/src/services/efsCardEdits.ts:154`) flattens a nested container inside a record to its `textContent`, losing the path. Because both sides of the `replaceAll` comparison are built from that same flattened object, the guard cannot see the loss — the comment at `:149-151` now documents this as a known gap rather than the proven property it previously claimed.

A preservation assertion built on the response DOM does not fix this on its own: the structure is already gone by the time the edit exists. So Step 2.1 must **either** carry nested structure through `recordFromElement` **or** make it *refuse* an element containing a nested container, loudly, rather than silently flattening it. Refusing is acceptable and cheaper — no current EFS collection nests — but it must be a thrown error with a named test, not an assumption.

**Verify additionally:** *"a record containing a nested container is refused, not silently flattened"*.

> **As built (2026-08-14).** The assertion lives in a new `apps/api/src/lib/efsCardCollections.ts`, not in `efsCardEcho.ts` — that file was 429 lines against a hard 500 budget. It runs **after** the canonical diff rather than before, so the diff keeps giving the first and more specific answer for every failure it can explain; running it first made three existing sabotage tests pass for a new reason, which is coverage loss disguised as green.
>
> **The precondition above was wrong.** Step 1.1 did not introduce `replaceAll.removals` — the field did not exist. #13 added it, and wired `promptsEdits` to pass its existing `removedInfoIds` through.
>
> **Deviation from the Phase 2 exit gate:** two existing echo tests were *changed*, not left unchanged. Both performed a deliberate record drop through a bare `replaceAll` and now declare it (`["ODRD"]` for prompts, `["CADV"]` for the p194 override recipe). This is the intended contract change — an undeclared omission is now refused — but the gate's "every existing echo test passes unchanged" needs amending to say so rather than being quietly treated as met.
>
> Nested containers are **refused**, per the cheaper of the two options offered. The `[no-test-claim]` marker at `efsCardEdits.ts:149-151` is retired.

### ✅ Step 2.2 — `editsLanded` made exact — DONE, PR #14 (`77a861a`)
**Files:** `apps/api/src/lib/efsCardWrite.ts` (`editsLanded` ~`:254-285`).
**Change:** `replaceAll` currently compares record **counts**; compare identity **sets** instead. `appendRecord` is currently an empty branch that reports landed unconditionally; compare against the before-document.
**Verify:** *"a replaceAll that landed the wrong records does not report succeeded"* · *"an appendRecord that did not land is not reported as landed"*.

> **As built (2026-08-14).** `appendRecord` is checked by **presence** on the after-document, not against the before-document as written above: `editsLanded`'s whole reason for existing is that the `sent` reconciler has no before-document to diff against (`efsCardUnresolved.ts`). Presence cannot separate "our append landed" from "that identity was already there", but absence is conclusive, and the alternative — returning false — would strand every append row as permanently unresolved. Recorded here because the step text asked for something this code path cannot have.
>
> Record identity is now defined **once**, in `efsCardCollections.recordIdentity`, shared by the echo guard and the reconciler.

### Step 2.3 — Element sequence order
**Files:** `apps/api/src/lib/efsCardCanonical.ts`, `apps/api/src/lib/efsCardEcho.ts`.
**Change:**
- Add exported `elementOrder(root, exclude): string[]` to `efsCardCanonical.ts`. Move `diffCanonical` there from `efsCardEcho.ts:355` and export it.
- Add `WS_CARD_SEQUENCE = ["cardNumber","header","infos","limits","locationGroups","locations","timeRestrictions"]`, cited to the WSDL.
- The two append loops (~`:167-177`) **insert at the correct sequence position** instead of appending.
- `assertEchoFidelity` compares element order.
- **Decide and document:** order is compared **absolutely against `WS_CARD_SEQUENCE`**, not relative to the response — because `expectedCanonical` re-inserts a replaced collection last in Map order, and a relative comparison would fail on exactly the new-collection case this fix enables. State what happens when the vendor's own response is out of sequence (accept it on read; always emit in sequence on write).

**Verify:** *"introduces a new infos collection in sequence order, not at the end"* · *"introduces a new limits collection in sequence order"* · *"the guard rejects an out-of-sequence request"* · *"a zero-edit echo of every fixture is byte-order-stable"* (loop all fixtures) · all existing echo tests pass **unchanged**.

### Step 2.4 — Intra-record field order
**Files:** `apps/api/src/lib/efsCardEcho.ts` (`serializeRecord` ~`:69-74`), `apps/api/src/services/efsCardEdits.ts`.
**Change:** `serializeRecord` emits fields in `Object.entries` order — i.e. whatever order someone typed the object literal — while unedited records use document order. Emit in the type's declared sequence order instead. Add `WS_CARD_INFO_SEQUENCE` and `WS_CARD_LIMIT_SEQUENCE`, cited to the WSDL.
**Verify:** *"record fields are emitted in WSCardInfo sequence order regardless of object literal order"*.

### Step 2.5 — Production echo scan (read-only)
**Files:** `apps/api/src/routes/fuelCards/echoScan.ts` (new), `apps/api/src/app.ts`.
**Change:** `POST /api/fuel-cards/echo-scan` — admin, read-only, no probe flag. For every card in the org: read it, build a zero-edit request, run `assertEchoFidelity`, **never dispatch**. Report pass/fail per card with the diff on failure.
**Verify:** **Deployed:** run against the production org's 199 cards. Every card must pass. Any failure is a finding to record in `docs/22` before proceeding.

### Step 2.6 — The credential-identity binding is inert on the only org that has it *(2026-08-15)*
**Files:** `apps/api/src/services/efsCardControlAccess.ts`, plus one live re-probe.
**The live check was run, and the gate FAILS.** One row in `efs_card_control_settings`:

| org | enabled | `write_entitlement` | `probed_identity_hash` | `probed_at` |
|---|---|---|---|---|
| `07fe4058…` (QA/sandbox) | true | **confirmed** | **NULL** | 2026-08-11 23:57 |

The production org has no row at all, so card control is QA-only today — which means **the binding is null on 100% of the orgs it governs.**

**Why this is more than data hygiene.** `efsCardControlAccess.ts` compares the current credential identity against `probed_identity_hash` and returns `endpoint_changed` on a mismatch. When the stored hash is null it takes the grandfather branch instead: logs one warning per process and **allows the write**. So the guard that exists to stop a QA-confirmed entitlement being exercised against a repointed credential is, for the only org that has an entitlement, switched off. 0187 called that "temporarily grandfathered"; the temporary has outlived the migration.
**Change, and the order matters.** ① Re-probe the QA org so `writeProbe.ts` populates `probed_identity_hash` (needs `EFS_CARD_CONTROL_PROBE_ENABLED`, and standing rule 15 — unset it and redeploy afterwards). ② THEN delete the grandfather branch so a null hash denies with `endpoint_changed`. Doing ② first revokes QA card control and blocks the Phase 3 live re-run; doing ① alone leaves the loophole open for the next org that arrives with a pre-0187 row.
**Verify:** a settings row with a null `probed_identity_hash` and `write_entitlement = 'confirmed'` is DENIED, with a test that fails on today's code · the live query returns zero violating rows.

### ✅ Exit Gate — Phase 2
- [ ] **FAILS as of 2026-08-15** — org `07fe4058…` has `write_entitlement = 'confirmed'` with a null `probed_identity_hash`, and it is the only org with card control enabled. Fix is **Step 2.6**; the check itself is now scripted, not manual
- [x] The Phase 1 bug, replayed through the guard, throws `echo_unfaithful` — `efsCardEcho.test.ts`, 2026-08-14
- [x] All four order tests pass — delivered by Step 2.3 (#16), in `efsCardXml.test.ts`
- [x] **No test lost an assertion.** `git diff <base>..<head> -- '*.test.ts' | grep -cE '^-.*expect\('` is **0** across Phase 2's PRs *(amended 2026-08-15 — see below)*

  > **GATE AMENDED, identically to Phase 3's, and that is the point.** This line read *"every existing echo test passes unchanged"*. PR #13 deliberately changed two: both performed a record drop through a bare `replaceAll` and now declare it in `removals` (`["ODRD"]` for prompts, `["CADV"]` for the p194 override recipe). **That was the contract change the step existed to make** — a gate forbidding it forbids the step.
  >
  > Phase 3's twin was amended on 2026-08-14 to the deleted-assertion count, on the argument that a mechanical number cannot be argued with at 2am while a prose list of which files were "allowed" to change selects for contorting code around tests. `docs/30` §6.D observed that leaving Phase 2's unamended is worse than either choice, because two phases would then hold their twin gates to different standards and neither reading would be authoritative.
  >
  > Steps 2.3, 2.4 and 2.5 each passed every pre-existing test unchanged, so the amendment costs nothing in coverage; it only stops #13's intended change from being scored as a violation. **Same replacement, same reasoning, same phase-level strictness.** Miki delegated the wording on 2026-08-15.
- [x] **Echo scan green across the production account — 2026-08-14: 197 cards scanned, 197 passed, 0 failed.** Run in four batches of 50 against `fleetguardapi-production` at `34f7336`. The account returns **197**, not the 199 this plan assumed; the older number is stale, not a shortfall.

  What that clean sweep actually covers, given the guard grew during Phase 2: every card WEX holds
  round-trips with no record dropped (2.1), no field dropped (2.1), no `editsLanded` miscount (2.2)
  and no element out of `WSCardv2` sequence (2.3). The ten fixtures could never have made that claim —
  this is the first evidence about the REAL fleet.
- [x] Standing gates green — 2026-08-14, at `77a861a`

**Phase 2 code is complete** (2.1 #13 · 2.2 #14 · 2.3 #16 · 2.4 #17 · 2.5 #18/#19/#21) **and the echo scan is green.** Two gate items remain: the `probed_identity_hash` live check, and the wording of the "unchanged" clause above.

> ### Finding — `fleetguardweb` runs the API but cannot reach EFS (2026-08-14)
>
> The account has **two Railway services**, and this cost most of an afternoon to see:
>
> | Host | Serves | Reaches EFS |
> |---|---|---|
> | `fleetguardapi-production` | the API | yes — whitelisted, the pollers run here |
> | `fleetguardweb-production` | the SPA **and a full copy of the API** | **no** |
>
> An EFS call landing on the web host is refused at WEX's firewall — `NotAllowed`, guide p9, both
> `getCardSummariesV2` and v1. It looks like an outage and is an egress-IP whitelist miss. The browser
> never hits it because the SPA calls `VITE_API_URL`, which is the api host.
>
> Two things follow, neither yet fixed:
>
> 1. **`deploy-verify` only polls `API_URL`.** It reported success for `34f7336` while the web host was
>    still two commits behind. They deploy independently and one of them is unverified.
> 2. **The web host serves EFS routes it cannot fulfil.** Either stop routing them there or whitelist
>    its egress — the first is safer, since fewer whitelisted IPs is the stronger position with WEX.
>
> Ask WEX for nothing: no card was touched, and the block is at the card-LIST step.

---

## Phase 3 — Capability architecture

**Read `docs/27-EFS-CAPABILITY-ARCHITECTURE.md` before starting.** It defines every type; this phase implements it.
**Preconditions:** Phases 0–2 ✅.

### Step 3.1 — Characterisation tests, on `main`, before anything else
**Files:** `apps/api/src/routes/fuelCardsControl.characterisation.test.ts` (new).
**Change:** ~10 route-level tests using the recorded fixtures and `supabaseRecorder`, asserting the **dispatched XML bytes** for each of the five existing routes. Today nothing exercises route → spec, so "the tests still pass" proves nothing.
**Verify:** written and passing **on `main`, before Step 3.2**. Commit them first.

### Step 3.2 — Ledger migration
**Files:** new migration.
**Change:** `efs_card_mutations` gains `capability_key text`, `request_body jsonb` (redacted), `step_index int`; `status` CHECK widened with `'partial'`. `efs_card_control_approvers.scopes` CHECK widened per the Phase 0 Step 0.2 decision.
**Verify:** `pnpm verify:live` → new `schema.applied`, `drift: false`. `pnpm test:rls` — counts unchanged.

### Step 3.3 — Types
**Files:** `packages/shared/src/efs/types.ts`, `apps/api/src/efs/types.ts`, `apps/web/src/features/fuelCards/capabilities/types.ts` (all new).
**Change:** implement `Target`, `Mutation`, `VerifyPlan`, `Landing`, `Snapshot`, `Governance`, `defineContract`, `defineBehaviour`, `defineView`, and the shared `cardEchoVerify()` helper — exactly as specified in `docs/27` §3.
**Verify:** `pnpm typecheck`. Nothing consumes them yet; no behaviour change.

### Step 3.4 — Generalise the orchestrator
**Files:** `apps/api/src/services/efsCardControl.ts`, `apps/api/src/services/efsCardReconcile.ts`.
**Change:** per `docs/27` §5 —
- access check gains the capability promotion lookup (a no-op until Phase 4)
- `preflightStepUp` runs **before** `enforceCardWriteLimit`
- snapshot/verify calls replace the hardcoded `getCardV2` and `intentLanded`
- the version check is conditional on `target.kind === "card"`
- dispatch switches on `mutation.kind` instead of the `vendorOp` ternary
- `sequence` loops, writing `step_index`, settling `partial` on a step failure
- introduce `LedgerAdapter` with one implementation (`CardLedger`). **Do not build a second table.**

**Verify:** the characterisation suite passes **byte-identically**. `pnpm lint:funcsize` — every phase function under 200 lines.

### Step 3.5 — Pilot: migrate `card_lock`
**Files:** `packages/shared/src/efs/capabilities/cardLock.contract.ts`, `apps/api/src/efs/capabilities/cardLock.behaviour.ts`, `apps/web/src/features/fuelCards/capabilities/cardLock.view.ts`, plus the three registry index files and `apps/api/src/efs/router.ts`.
**Change:** one capability, end to end. The old spec and the new descriptor coexist; the router uses the descriptor for lock only.

**Carried over from Step 3.4.** Two route-layer items were listed under 3.4 and deferred. Their resolution differs, and the difference is worth reading before Phase 4:

- **~~3.5a — the capability promotion lookup~~ ⛔ WITHDRAWN 2026-08-14. It is Step 4.2, and always was.** The note that created it said to stub the Phase 4 table with "a lookup that fails closed on a missing row". That is wrong and would have been a production outage: there is no `efs_capability_promotions` table until Step 4.1, so a fail-closed lookup refuses **every lock, immediately**. Step 4.2 already specifies the real gate — `loadCardControlAccess` takes an optional capability, refuses unless `state === 'enabled'`, and **backfills the five existing capabilities as enabled** — and that backfill is precisely what makes the gate safe to introduce. Nothing is owed here. What 3.5 does contribute is that the generated router gives 4.2 **one** call site to add the capability argument to, instead of five hand-written ones.
- **3.5b — `preflightStepUp` before `enforceCardWriteLimit`** ✅ **done, in the same commit as 3.5.** The generated router answers `preflightStepUp` from the body before calling `prepare()`, which ends with the limiter. It could not be deferred: a router that reads the field and ignores it is the "declared and silently skipped" hazard the deferral note warned about.

**Verify:** characterisation tests for lock pass byte-identically — *and prove it is the new path*, by unmounting the generated router and watching only the lock case fail. **Live QA** (status card): lock and unlock still work. Plus, for 3.5b: a capability declaring `preflightStepUp` refuses *before* a rate-limit slot is spent — assert `bump_card_write_counter` did not fire, not just the status code, and verify by reversing the two gates.

> **DECIDED (2026-08-13) — `reason` becomes per-capability.** Decision B1 made `reason` optional API-wide, which is right for the 2am stolen-card path and wrong for discretionary writes. The contract is the natural home for the distinction. Each capability declares its own rule:
> - **optional** — `card_lock`, `card_unlock`, `card_deactivate` (the emergency path must not demand prose)
> - **required (3–200)** — `override_grant`, `override_limits`, `prompts_set` when it removes a prompt, `hand_enter`, `card_pin`, and every lifecycle capability
>
> The UI sends one either way (Phase 6 Step 6.2), so in practice the `Why` column fills. The fitness test asserts every capability declares a rule, so a new one cannot default into silence.

### Step 3.6 — Migrate the remaining four
**Files:** as above, per capability.
**Change:** one commit each — `card_unlock` ✅, `override_grant` ✅, `override_clear` ✅, `prompts_set` ✅. Route `prompts` through `run()` like the other four. Move the per-intent confirmation builders out of `cardControlModel.ts` into the views.
**Verify after each:** the characterisation suite passes byte-identically.

**DONE 2026-08-14. Both questions were settled as follows — kept because the reasoning is load-bearing for Step 4.2.**

- **`override_clear` — the mechanism is chosen at RUNTIME and `mutation` is static data.** `EFS_CARD_DELETE_OVERRIDE_ENABLED` picks the dedicated `deleteOverride` op over the three-edit echo, per request. A behaviour cannot be both. The shape `docs/27` already anticipates is **two contracts sharing one intent** — §7.2 says "many-to-one — `override_clear` is one intent with two mechanisms" — with only one mounted at a time, which means `MOUNTED_CAPABILITIES` becomes a function of `env`. That is also exactly the seam **Step 4.2** needs when it migrates this flag into a `delete_override` capability and lets promotion choose. **DECIDED: two contracts.** `mountedCapabilities(env)` is now the one place that picks, and mounting both throws rather than letting registration order decide. Step 4.2 replaces the env read with the promotion lookup.
  Whichever wins: the direct one **must** declare `vendorMovesFields: OVERRIDE_FIELDS`, or every clear reports its own success as unexplained drift (Step 3.4 found this by running it).
- **`prompts_set` — the removal refusal needs the COMPUTED removals, not the body.** `assertPromptRemovalAllowed` takes `promptsEdits(doc, prompts).removedInfoIds`, `allowRemoveDriverId` and the caller's fresh-auth state together. `precondition(snap, body)` can reach all three, since it runs after the fresh read and can recompute the plan from the snapshot — but that means `promptsEdits` runs twice per request, as it already does today for `auditMeta`. **DECIDED: recompute.** `promptsEdits` runs three times per request now (precondition, auditMeta, buildEdits) against a pure diff over an already-parsed document, no vendor call. A cache on the snapshot could go stale between the gate and the write, which is the more expensive mistake. `precondition` also gained `PlanCtx`, so one call to `assertPromptRemovalAllowed` still raises both of its refusal codes. It is also the route whose blast radius is highest: `replaceAll` means the array in the request IS the card's prompts afterwards, and the characterisation case for it exists precisely because a dropped `<infos>` record is a deleted driver assignment (guide p137).

### Step 3.7 — Delete the old path
**Files:** `apps/api/src/routes/fuelCards/control.ts`, `apps/api/src/services/efsCardControl.ts`.
**Change:** delete `CardMutationIntentSpec` and the five hand-written handlers. `control.ts` becomes a factory over the registry.
**Verify:** `pnpm lint:filesize` — `control.ts` and `cardControlModel.ts` drop below 500. (`cardControlContract.ts` will **grow** from the contract half; split or re-pin it deliberately, in its own commit.)

**DONE 2026-08-14.** `control.ts` is **deleted**, not shrunk — it had been one history READ since 3.6, and a file named `control` that controls nothing is a file somebody puts a handler back into. The route moved to `read.ts`, where a GET belongs and where the mount order already keeps it away from the write limiter's counter. `cardControlContract.ts` **shrank** rather than growing (511 → 355, split into `cardControlLedger.ts`), because the capability contracts went to `packages/shared/src/efs/capabilities/` instead of into it. All four Phase-3 waivers are now gone from `GRANDFATHERED`.

### Step 3.8 — Fitness test
**Files:** `apps/api/src/efs/registry.fitness.test.ts` (new).
**Change:** implement every assertion in `docs/27` §7.2, both directions, with the non-empty-discovery guard. Convert `fuelCardsControl.test.ts`'s hardcoded `WRITE_ROUTES` array to iterate the registry.
**Verify:** it catches a deliberately half-wired capability, a wrong write-bucket, and a missing CHECK value. **The `WRITE_ROUTES` conversion is the only pre-existing test allowed to change in this phase.**

**DONE 2026-08-14, and it earned its keep on the first run.** Built as `apps/api/src/efs/registry.test.ts` (extended, not a second file) plus `apps/web/src/features/fuelCards/capabilities/registry.test.ts` for the view side, since `apps/api` cannot import `apps/web`. All three breakages verified, each caught by the assertion meant for it.

**What it found:** `CARD_MUTATION_STATUSES` was missing `'partial'` — added to the ledger's CHECK by migration 0190 in Step 3.2 and written by the orchestrator since 3.4, so for three steps a status the database accepts had no label on the history screen. The CHECK readers parse the **whole** migration directory, last-one-wins, precisely because a single-file reader would still be asserting 0177's original five.

### Step 3.9 — Reconciler
**Files:** `apps/api/src/services/efsCardUnresolved.ts`.
**Change:** look up the descriptor by `capability_key` and call its `verify` with `request_body` — instead of skipping empty-edit rows and using a shared `getCardV2`.
**Verify:** *"an unverified deleteOverride is reconciled"* · *"an unverified direct op is reconciled through its own read op"*.

**DONE 2026-08-14.** `verify` gained `reconcile` — the same question asked later, AFTER-ONLY, because the ledger stores `before_document` as the typed view rather than the DOM `intentLanded` diffs against, and hours later the card has moved anyway. `reconcilePlanFor` searches **all** capabilities, not the mounted ones: a `delete_override` row must stay answerable after the flag flips. **`efsCardUnresolved.ts` had no test file at all**, which is how `if (edits.length === 0) continue` survived several readings — it looks like a guard against unjudgeable rows and was in fact a guard against the rows that most needed judging.

### Step 3.10 — Mutation testing
**Files:** `scripts/mutation-check.mjs` config.
**Change:** point `pnpm mutation:check` at `apps/api/src/efs/` for this phase.
**Verify:** run it. Record the score in §14. A near-zero score on the descriptor bindings means Step 3.1's tests are not biting — fix them before closing the phase.

**DONE 2026-08-14. Score: 18/18 caught, 7 of them new** (`--only=efs-` is 7/7). The harness is a curated list, not a generic mutator, so "pointing it at `apps/api/src/efs/`" meant writing the seven mutations — each mirroring a defect this workstream actually produced. None is caught by a compile error; each altered line leaves the code typechecking, so every catch is an assertion failing.

**Also found:** `mutation-check.yml`'s path filter listed `apps/api/src/services/**` and never learned about `apps/api/src/efs/`. Phase 3 moved every card write there, so a change to a behaviour or the orchestrator stopped triggering the harness that guards it — leaving only the Monday cron. Same class as the route-enumeration list `vendorRateLimit.test.ts` caught in 3.5.

### Step 3.11 — ⚠️ P0: an override grant that WORKS is recorded as failed
**Files:** `apps/api/src/efs/capabilities/overrideGrant.behaviour.ts`, possibly `apps/api/src/services/efsCardReconcile.ts`.
**Observed live on QA, 2026-08-14.** The badge reads `Override: 1 use left` — fed by `updateMirror` from the verifying re-read, so it is EFS's own answer — while the toast reads *"EFS accepted the request but the card is unchanged."* `intentLanded` returned false on a write that landed.

**Why P0.** Re-granting does not overwrite, it grants AGAIN, and the message tells the operator to retry. `efsCardControl.ts`'s own comment: *"the failure mode of a double-submitted override is a driver getting two free tanks."* The audit row also says `card.mutation_failed` for a successful write.

**Leading hypothesis.** Both recorded fixtures from this account show `overrideAllLocations=false`, including `getCardV2.overridden.xml`, which HAS an override armed. **We have never recorded this vendor returning `true`.** If EFS stores or returns `false` for an all-locations grant, `override` lands while one edited path differs and the whole mutation is condemned — the H1 casing incident's shape, one field out.

**Do the read BEFORE the fix.** `select id, status, efs_fault_code, drift, edits from efs_card_mutations where intent = 'override_grant' order by created_at desc limit 5;` — `drift->'unexplained'` names the field. While there: check whether ••••7550 has **two** grant rows, which would explain the §6.E stale override with no sync bug at all.

**THE WRONG FIX, named so nobody reaches for it:** widening `intentLanded`'s tolerance. That hides every genuine partial failure on every capability — it is weakening the guard that caught this. Rule 4 applies: normalisation is a named, tested adapter, never an incidental tolerance. Defensible options once the drift is known — an adapter for a vendor normalisation we can prove, or a `precondition` refusing an all-locations grant on an account that does not honour it.
**Verify:** a test that fails on today's code · **Live QA:** grant, re-read, and confirm the ledger says `succeeded`. Then clear, and re-read again.

#### ✅ DONE 2026-08-15 — and the read changed the answer

**The read the step specified could not be run as written.** `drift->'unexplained'` is null on every failed row: `finalizeFailed` does not write the `drift` column, only `finalizeLanded` does. The same fact was reconstructed from `edits` against `after_document` — `scripts/override-ledger-diagnose.mjs`, committed.

**What it said.** Three grants, all `all`-scope, `uses: 1`. `override` landed 0 → 1 every time; `overrideAllLocations` was sent `true` and read back `false` every time, and was the sole condemning path. Widened to the fleet: across **all 234 mirrored cards in both orgs**, `overrideAllLocations` is `false` 234 times and `true` **zero** times, and `locationOverride` is null 234 times. So the finding is broader than the hypothesis — **this account does not report override scope at all**, and a location-scoped grant is equally unverifiable. Full evidence: `docs/22`, entry H3.

**What shipped.** Not a tolerance. `intentLanded` keeps its strictness and gains `unlandedEditNames` (plus the after-only twin `unlandedEditNamesFromAfter`), so a capability can reason about a field without any other capability losing the guard. `overrideGrantBehaviour` maps the list: count not landing → `failed`, unchanged; mismatch confined to the two never-reported scope fields → **`indeterminate`**; anything else → `not_landed`. `judge` and `reconcile` overridden together, so the background sweep cannot condemn a cycle later what the live path declined to condemn.

**Consequence, stated rather than buried:** override grants now sit on the unresolved list until Phase 4.4 establishes whether the scope arms. That is the honest cost of not being able to verify them, and it converts to either a proven adapter or a `precondition` when 4.4 answers.

**Still open:** the live QA re-run (grant → re-read → expect `sent` + `card.mutation_unverified`, then clear → expect `succeeded`).

### ✅ Exit Gate — Phase 3
- [x] Characterisation suite passes byte-identically after every migration step
- [x] **No test lost an assertion.** `git diff <base>..<head> -- '*.test.ts' | grep -cE '^-.*expect\('` is **0**; 99 were added. Every test that changed did so because the thing it named was deleted or moved by this phase, and each change is named in the commit that made it *(amended 2026-08-14 — see below)*

> **GATE AMENDED, and why.** This line read *"the only pre-existing test that changed is `WRITE_ROUTES`"* (from `docs/27` §10). **That gate is unsatisfiable in this phase, and the contradiction is in the plan, not in the work:** Step 3.7's entire content is deleting `CardMutationIntentSpec`, and `efsCardControl.test.ts` and `efsCardWriteDeadline.test.ts` construct it. A gate cannot both require the deletion and forbid touching the tests that name the deleted thing.
>
> `docs/27` §10 argues the obvious gate — "no existing test may change" — is wrong because it **selects for the unsafe outcome**. The same argument applies one notch further out: a gate satisfiable only by contorting code around a test fails the same way from the other direction, and the pressure it creates is to leave a dead type alive so a test need not move.
>
> **The replacement is the property the original was reaching for, expressed as a number instead of a judgement.** Deleted-assertion count is mechanical, it is already §0.9 audit check 4, and it cannot be argued with at 2am. It is strictly harder to fudge than a prose list of which files were "allowed" to change.
>
> **What it does NOT relax:** the characterisation suite must still pass byte-identically (its own gate line, above), and standing rule 1 still forbids weakening a gate to make it green. This amendment tightens the check into something falsifiable; it does not lower it. Approved by Miki, 2026-08-14.
- [x] Fitness test catches all three deliberate breakages
- [x] `mutation:check` score on `apps/api/src/efs/` recorded and acceptable — **18/18, 7 new**
- [x] **All four Phase-3 waivers from Step 0.6 are DELETED from `GRANDFATHERED`** — `control.ts`, `efsCardControl.ts`, `cardControlContract.ts`, `cardControlModel.ts` all under 500 on their own (`efsCardControl.ts` ✅ removed in 3.4)
- [x] **Live QA: all five operations verified — 2026-08-15, on `af1a8e5`, the deploy carrying Step 3.11.** lock ✅ unlock ✅ prompts ✅ override-clear ✅ override-grant ✅

  | Check | Result |
  |---|---|
  | grant status | **`sent`** — was `failed` |
  | fault code | **`unverified`** — was `no_change` |
  | operator message | *"could not be confirmed"* — **no retry invited** |
  | audit | `card.mutation_unverified`, and **no** `card.mutation_failed` |
  | mirror after grant | `override_uses: 1` |
  | clear | **`succeeded`** |
  | mirror after clear | `override_uses: 0` |
  | **card_version after the revert** | **`15189d97…` — byte-identical to before the test** |

  Ledger rows `18c07a42…` (grant) and `b5a0f907…` (clear), QA card ••••7677. Rule 14 satisfied: the card ends exactly as it started, proved by the version hash rather than by a field-by-field eyeball.

  **Two things the run found that no offline test could.** ① The `sent` row landed with `after_document` NULL — `finalizeUnverified` was built for "the re-read failed", and Step 3.11 routed "read fine, cannot judge" into it, so the row an operator is told to investigate carried less evidence than the `failed` row it replaced. Fixed same session (`5222564`). ② The first clear was refused `mutation_in_flight` — **correct behaviour**, not a defect: `assertNoneInFlight` holds a `sent` row for `4×interactive_timeout + second_look + 15s` = **58 seconds**, and the harness ran the clear immediately. Worth knowing that grants now ALWAYS settle `sent`, so every grant→clear sequence meets that window where before it did not.
  > **What "works" now means for the grant, and it is deliberately not `succeeded`.** This account never reports override scope (`docs/22` H3), so a grant settles `sent` / `card.mutation_unverified`. The gate item is: the count lands, the ledger says `sent` and NOT `failed`, no message invites a retry, and the subsequent clear settles `succeeded`. A grant reporting `succeeded` after this change would mean the scope fields started echoing — a finding in its own right, not a pass.
- [x] Standing gates green

---

## Phase 4 — Harness & promotion

**Preconditions:** Phase 3 ✅.

### Step 4.1 — Promotion schema
**Files:** new migration.
**Change:** `efs_capability_proofs` (org, capability, the five OEG results, `apply_latency_ms`, `endpoint_host`, `document_shape`, `vocabulary jsonb`, redacted request/response XML, `run_by`, `run_at`) and `efs_capability_promotions` (`org_id` × `capability` → `state`, `proof_id`, `promoted_by`, `promoted_at`, `reason`, `suspended_reason`). Both RLS-enabled, no policies, service-role only, 0106-style comment. Add `observed_document_shape` and `observed_vocabulary jsonb` to `efs_card_control_settings`.
**Verify:** `pnpm verify:live`. `check-rls` passes (wired in Phase 0). RLS matrix proves neither table is tenant-reachable.

### Step 4.2 — The promotion gate
**Files:** `apps/api/src/services/efsCardControlAccess.ts`, `apps/api/src/env.ts`.
**Change:** `loadCardControlAccess` takes an optional capability and refuses unless `state === 'enabled'`. Add `blockedBy: "not_promoted"` and `"capability_suspended"`. **Backfill** the five existing capabilities as `enabled` with `reason: 'backfilled from Phase B write_entitlement'`.
> **This step absorbs the withdrawn 3.5a.** The backfill is not bookkeeping — it is the only thing that makes this gate safe to introduce. Order matters: the backfill must be in the SAME migration as the table, or every card operation is refused between 4.1 and the backfill. The capability argument now has exactly **one** call site to reach in the generated router (`apps/api/src/efs/router.ts`), plus the four hand-written handlers still in `control.ts` until Step 3.7. Migrate `EFS_CARD_DELETE_OVERRIDE_ENABLED` into the `delete_override` capability (keep the env var one release as an additional AND, then remove).
**Do not add a TTL cache** — live queries are why suspension is instant.
**Verify:** *"an unpromoted capability is refused"* · *"a suspended capability is refused even when write_entitlement is confirmed"* · *"the five existing capabilities are enabled after backfill"*. **Deployed:** every existing operation still works on QA; suspend one and confirm it refuses immediately.

### Step 4.3 — Local harness
**Files:** `apps/api/src/efs/harness/local.ts` (new).
**Change:** replay a fixture, run any capability's `buildEdits`, assert exact wire bytes. Runs in CI.
**Verify:** covers all five migrated capabilities.

### ✅ Step 4.4 — Config scanner (three-state) — DONE 2026-08-15
**Files:** `apps/api/src/efs/harness/configScan.ts`, `apps/api/src/routes/fuelCards/scan.ts`, `apps/api/src/scripts/runConfigScan.ts`.
**Change:** read **raw wire text, never `doc.card`** — the typed view destroys format information (`boolOrNull` collapses `false` and `0`; `locationOverride` collapses `"0"` and `"1"` to null; `leafText` collapses nil and empty). Emit JSON: per field → `{observedValues[], count, rawSpelling, nilCount, absentCount, presentEmptyCount}`. Compare against each contract's `emittableValues` and report **`match` / `mismatch` / `unobserved`**.
**Verify:** *"a field with no observed value reports unobserved, not match"*. Run against QA and production; commit the JSON.

**Spends no vendor calls.** The mirror already stores `last_response_xml_redacted` — the vendor's own bytes — for **234 of 234 cards** across both orgs. Re-reading the fleet live would cost 234 paced calls against a shared budget to answer a question about SPELLING, which does not go stale in a day. The route is therefore the one fuel-card route classified `opensSoap: false` that reads vendor data. Provenance (corpus size, rows with no stored document, freshness range) rides on every response, because `unobserved` from a complete corpus and `unobserved` from a partial one are different findings.

**Results — `docs/efs/config-scan-{sandbox,production}.json`, committed:**

| Field | sandbox (35 cards) | production (199 cards) |
|---|---|---|
| `card_lock.status` / `card_unlock.status` | **unobserved** / match | **match** |
| `override_{grant,clear}.overrideAllLocations` | **unobserved** | **unobserved** |
| `prompts_set.validationType` / `.infoId` | match | match |

**H3 confirmed mechanically, on production's 199 cards as well as QA's:** `overrideAllLocations` emits `false` and nothing else, on every card in both orgs. Step 3.11's `indeterminate` is now backed by an instrument rather than a hand-run query — and under Step 4.6's rule, **`override_grant` cannot be promoted**, which is the correct outcome.

#### Two findings from building it

**① `emittableValues` was about to make a safe capability unpromotable.** The first run reported `card_lock.status` as **mismatch** on both orgs: the account emits `ACTIVE`/`HOLD` and the contract declares `Active`/`Hold`. That verdict was *factually wrong about consequence* — `matchStatusCasing` has spelled status writes from the account's own fresh read since the 2026-08-12 incident, so the write lands. `cardLock.contract.ts` already said so in prose. It is now declared in the type: **`casingAdaptiveFields`**, per field and per capability, never a blanket tolerance (standing rule 4). The per-value verdict still records the casing difference; only the field-level judgement changes, because only the field-level judgement is a claim about what happens next.

**② ⚠️ A fleet-at-rest snapshot cannot observe a TRANSIENT value — this changes Step 4.6.** QA reports `card_lock.status` as `unobserved` because **no QA card is currently in HOLD**, and `Hold` is exactly the value `card_lock` exists to write. A card *was* locked to Hold on QA on 2026-08-14 and reverted per rule 14, so the value existed and the snapshot missed it by design. **`unobserved` therefore does not mean "the account rejects this value"** — for a state a card passes through rather than rests in, a scan can never say otherwise. See Step 4.6.


### Step 4.5 — Live prover
**Files:** `apps/api/src/efs/harness/prove.ts`, `apps/api/src/routes/fuelCards/prove.ts` (new).
**Change:** `POST /api/fuel-cards/prove/:capability` — admin, `requireFreshAuth`, `EFS_CARD_CONTROL_PROBE_ENABLED`, plus the Phase 1 org and production guards. Runs OEG-1/2b/3/4/5 from the behaviour's `proof` plan, reusing `writeProbeRealChange.ts`'s `runStep` and `VERIFY_DELAYS_MS`. Writes an `efs_capability_proofs` row. Sets `state='proving'` then `'proven'` or `'denied'` — **never `'enabled'`**.
- **OEG-3 requires before-state ≠ target-state**, asserted from the planning read, or the run is void.
- Give the harness an **org-cap exemption** recorded as such in the ledger — ~40 proofs × (apply + revert) exceeds the 50/hour cap and a 503 is indistinguishable from a vendor refusal.

**Verify:** *"records oeg4 false when the vendor's casing differs from ours"* · *"a failed revert marks the proof failed and says the card is still changed"* · *"a proof whose before-state equals the target is void"*. **Live QA:** `pnpm efs:prove card_lock --card <last4>` — all five green, latency recorded (~533ms baseline), card restored.

### Step 4.6 — Promotion endpoint + CLI
**Files:** `apps/api/src/routes/fuelCards/promote.ts`, `scripts/efs.mjs` (new), `package.json`.
**Change:** `POST /api/fuel-cards/promote/:capability` — admin, `requireFreshAuth`, body `{action, reason: 3..500, proofId}`. **Server-side, promotion to `enabled` is refused unless**: the proof's five OEG results are green, the proof's `document_shape` matches the target org's observed shape, and every `vocabularyField` is `match` (not `unobserved`) in the config scan. Suspension needs no proof.

> **⚠️ AMEND THIS RULE BEFORE BUILDING IT — Step 4.4 proved it unsatisfiable as written.** "Every `vocabularyField` must be `match` in the config scan" cannot be met for a value a card only passes THROUGH. QA reports `card_lock.status` `unobserved` because no QA card is in HOLD right now, and rule 14 guarantees none stays there — so `card_lock`, the safest capability in the product and one already verified live twice, could never be promoted on QA.
>
> **The scan and the prover answer different questions and the gate must accept both.** The scan asks *what does the fleet look like at rest*; Step 4.5's prover asks *what happens when we write this exact value and read it back* — which is strictly stronger evidence for precisely the transient case. The rule should be: every `vocabularyField` is `match` in the config scan **OR** the value was observed in the after-document of a green proof for this capability. `mismatch` still blocks unconditionally; `unobserved` with no proof still blocks. Decide the wording when 4.6 is built, but do not build the written version — it blocks the good outcome and would be "fixed" under pressure by weakening something. CLI: `pnpm efs:prove`, `pnpm efs:scan`, `pnpm efs:echo-scan`, `pnpm efs:promote`.
**Verify:** *"promotion is refused when the document shape differs"* · *"promotion is refused when a vocabulary field is unobserved"* · *"suspension needs no proof"*. **Deployed:** promote `card_lock` on QA; attempt production and record the outcome — **a block is the system working**.

### ✅ Exit Gate — Phase 4
- [ ] `pnpm efs:echo-scan` green on 199 production cards (re-run from Phase 2)
- [ ] `pnpm efs:scan` produces three-state JSON with `unobserved` counted; committed
- [ ] `pnpm efs:prove card_lock` green end to end; QA card restored
- [ ] Promotion refuses on shape mismatch and on `unobserved`
- [ ] Suspension refuses a live operation immediately; propagation time recorded in §14
- [ ] Standing gates green

---

## Phase 5 — Operational readiness

**Must land before Phase 8 (the first production promotion).**
**Preconditions:** Phase 4 ✅.

### Step 5.1 — Metrics and alerts
**Change:** emit and alert on — mutation outcomes by intent (succeeded / failed / drift / **unverified**) · **`echo_unfaithful` count, which must be identically zero, so any occurrence pages** · session breaker opens · promotion state changes · mirror sweep completion and any card without `detail_synced_at` · unknown vendor elements seen by the sweep (weekly digest).
**Verify:** trigger each signal deliberately in QA and confirm it fires.

### Step 5.2 — Incident runbook
**Files:** `docs/29-EFS-INCIDENT-RUNBOOK.md` (new).
**Change:** write the procedures for — **assess** (bulk read to determine blast radius) · **contain** (suspend the capability; instant, no redeploy) · **recover** (the revert path is Phase 14; until then the WEX portal, with exact steps) · **"a mutation outcomed `sent`"** (the state the QA harness will produce before production does).
**Verify:** walk the containment procedure end to end on QA and record the timings.

### Step 5.3 — Separation of duties
**Files:** `apps/api/src/services/efsCardControl.ts`, `apps/api/src/routes/…`.
**Change:** write `approved_by` — it exists in `0177` and nothing writes it. Use the existing `planCardMutation` / `applyCardMutation` seam. Define who may promote a capability to production.
**Verify:** *"a mutation records who approved it"*. The authority is recorded in §14.

### Step 5.4 — Chase the `fuelCardsControl.test.ts` intermittent
**Files:** `apps/api/src/routes/fuelCardsControl.test.ts`, `apps/api/src/app.ts` (`fuelCardVendorLimiter`).
**Observed 2026-08-14, once in eleven full `apps/api` runs, never in isolation.** Five cases in that file failed together, one of them *"refuses a mutation without an Idempotency-Key"* — **403 where 400 was expected**. The Idempotency-Key parse is the FIRST thing `prepare()` does, ahead of the kill switch, so a 403 means the request never reached `prepare()`. That points at a middleware answering first, not at card-control logic.

Confirmed **not** caused by Step 3.4: the diff touches no auth, no middleware and no limiter, and the failure did not recur in the ten subsequent full runs on the same branch.

**Change:** reproduce first — run `apps/api` under load or with the file order forced — then fix the cause. Two candidates worth ruling out in order: `fuelCardVendorLimiter` being reached across `createApp()` instances in one worker (the file's own docblock claims each app builds its own store — verify it), and `strictLimiter`'s IP keying colliding with another suite's server on 127.0.0.1. This is the same family as the `idleRollup.test.ts` finding in PR #12: a test that fails on a schedule nobody is watching turns CI red at random and teaches everyone to re-run it.
**Verify:** the failure reproduces on demand before any fix, and the fix is verified by reverting it alone.

> **2026-08-15 — a second sighting, and it was wasted.** A full `apps/api` run came back **3 files / 3 tests failed** while other work ran on the same machine; that run took 41s against a normal 11s, so it was under real contention. **The failing file names were not captured**, and eleven subsequent runs — three solo, eight under deliberate 2× CPU load — were all clean at 1155/1155. So: consistent with the 1-in-11 rate, consistent with contention as the trigger, and evidence of nothing else.
>
> **The instruction that follows from losing it:** never run this suite for a pass/fail summary alone. `pnpm exec vitest run > /tmp/run.log 2>&1` every time, so the one run in eleven that fails leaves the file names, the assertion, and the ordering behind. This step has now been observed twice and diagnosed zero times, entirely because the evidence was not kept.

### Step 5.5 — `mutation-check` cancels itself on a busy day, silently
**Files:** `.github/workflows/mutation-check.yml`.
**Found 2026-08-14 while wiring Step 3.10.** The workflow carries `concurrency: { group: mutation-check-${{ github.ref }}, cancel-in-progress: true }`. On `main` every push shares one group, so **a later merge cancels an in-flight mutation check** — and a cancelled run is not a failed run. It is silent. Seven merges landed on `main` that day; all completed only because the job takes ~60s and the merges were minutes apart.

That is the disease `scripts/mutation-check.mjs` opens by describing: *"a detection command that fails to START is a FAILURE, not a skip — 'the runner was missing so we passed' is how the driver app went 24 tests without executing any of them."* The script refuses to treat an unrunnable mutation as passed; the workflow around it will happily leave `main` with no completed run at all and nothing saying so.

**Change:** `cancel-in-progress: false`. Cancellation is right for a job whose only output is feedback on the newest commit (CI on a PR branch), and wrong for a job that is *verification of `main`* — there, every commit deserves its own answer. The job is ~60s against a 20-minute timeout, so serialising costs nothing worth counting.
**Verify:** push twice to `main` within a minute and confirm both runs complete. **This is a workflow edit**; the plan protects `ci.yml` by name and not this file, but it should be read as a CI change either way.

### Step 5.6 — The vendor rate limiter is keyed on IP, not on the account it protects
**Files:** `apps/api/src/app.ts` (`fuelCardVendorLimiter`, and the mount order around it).
**Carried in `docs/30` §6.G; numbered 2026-08-15.** `rateLimit({ windowMs: 15m, limit: 30, skip: skipFuelCardVendorRateLimit })` declares no `keyGenerator`, so express-rate-limit falls back to the caller's IP. The budget exists to protect **a shared vendor account**, and the vendor account is per-org — so two people in one office share 30 requests per quarter-hour across two different EFS accounts, and **QA testing spends production's allowance**. That is live today and it is spent on exactly the days we do live QA.
**The obstacle, named so the fix is not attempted casually.** The limiter mounts at `app.use("/api/fuel-cards", …)` while `requireAuth` runs *inside* each fuel-card router, so `req.auth` does not exist yet when the key would be computed. Do NOT decode the JWT in a `keyGenerator` — that is a second auth implementation (standing rule 5). Hoist `requireAuth` ahead of the limiter for this mount instead, which also means an unauthenticated request gets a 401 without spending vendor budget. First confirm **every** router under that mount is authenticated: `fuelCardSettingsRouter`, `fuelCardsRouter`, `fuelCardCapabilityRouter`, `fuelCardProbeRouter`, `fuelCardWriteProbeRouter`, `fuelCardExperimentsRouter`, `fuelCardEchoScanRouter`.
**Verify:** two orgs from one IP get independent budgets · one org from two IPs shares one · an unauthenticated request is refused without consuming a slot. **Note the interaction with Step 5.4**, which lists limiter keying as a candidate cause of the intermittent — do 5.6 first and re-measure.

### Step 5.7 — One timestamp column, two unrelated events
**Files:** `apps/api/src/services/efsSoapCredentials.ts` (`recordFeedSuccess`, `recordFeedFailure`, `upsertEfsSoapCredentials`).
**Carried in `docs/30` §6.G; numbered 2026-08-15.** Every poll bumps `efs_soap_credentials.updated_at`, and so does a credential rotation. The column cannot answer *"when was this credential last changed"* — the question asked after a security incident — because a poller overwrites the answer within the hour. Same disease as `sync_error` in §6.F: one column, two meanings, and the frequent writer wins.
**Change:** leave `updated_at` to configuration changes and let the feed columns (`*_last_polled_at`, `*_last_success_at`) carry poll timing, which they already do. `recordFeedSuccess` and `recordFeedFailure` stop patching `updated_at`.
**Verify:** a poll does not move `updated_at`; a credential rotation does.

### Step 5.8 — `account_id` looks like an account binding and is not one
**Files:** `packages/shared/src/…` (the settings contract), `apps/api/src/services/efsSoapCredentials.ts`.
**Carried in `docs/30` §6.G; numbered 2026-08-15.** Nullable, free-text, never validated against anything WEX returns, and it feeds `credentialIdentityHash`. A field that reads like "which EFS account is this" but is whatever someone typed will eventually be trusted by a guard — and one already hashes it, so a typo silently changes the identity a Step 2.6 binding would compare against.
**Change:** either validate it against an operation that returns the account (`getCarrierInfo`, Step 7.1) and refuse a mismatch, or rename it to what it is and remove it from the identity hash. **Decide with Step 7.1's real output** — the same instrument, so do not guess ahead of it.
**Verify:** whichever is chosen, a wrong `account_id` cannot silently produce a valid-looking identity.

### Step 5.9 — `env.X ?? <literal>` on keys that already carry a zod default
**Files:** ~10 call sites across `apps/api/src`.
**Carried in `docs/30` §6.G; numbered 2026-08-15.** The zod schema in `env.ts` already applies `.default()`, so the second literal is unreachable — until someone changes the schema default and the two disagree. Then the effective value depends on which file you read. Low severity, high tidiness, and exactly the kind of thing that is free now and confusing later.
**Change:** delete the `?? <literal>` where the schema supplies a default; where it does not, add the default to the schema so there is one source.
**Verify:** `grep -rnE "env\.[A-Z_]+ \?\?" apps/api/src` returns only keys with no schema default, and a fitness test asserts that.

### Step 5.10 — `deploy-verify` proves one of the two hosts
**Files:** `.github/workflows/deploy-verify.yml`, and the routing decision for `fleetguardweb`.
**Recorded in Phase 2's findings on 2026-08-14 as "neither yet fixed"; numbered 2026-08-15.** Two Railway services deploy independently: `fleetguardapi` (whitelisted, reaches EFS, pollers run there) and `fleetguardweb` (the SPA **plus a full copy of the API**, refused by WEX's firewall). `deploy-verify` polls only `API_URL`, so it reported success for `34f7336` while the web host was two commits behind — **a green deploy check on a half-deployed system.**
**Change:** poll both hosts, and stop routing EFS routes to the web host. Prefer removing the routes over whitelisting a second egress IP: fewer whitelisted addresses is the stronger position with WEX, and a route that cannot succeed should not exist rather than fail politely.
**Verify:** `deploy-verify` fails when either host is behind · an EFS route on the web host returns a routing refusal, not a vendor `NotAllowed`.

### ✅ Exit Gate — Phase 5
- [ ] Every signal in 5.1 fires when triggered
- [ ] Runbook written; containment walked on QA with timings recorded
- [ ] `approved_by` populated; promotion authority defined
- [ ] The `fuelCardsControl.test.ts` intermittent is reproduced and fixed, or shown to be impossible
- [ ] `mutation-check` no longer cancels its own runs on `main`

---

## Phase 6 — Drawer shell

**Preconditions:** Phase 3 ✅ (views exist).

### Step 6.1 — `CardOperationDrawer.vue`
**Files:** `apps/web/src/features/fuelCards/CardOperationDrawer.vue` (new).
**Change:** a wrapper over `SlideOver` (`size="lg"`) with six regions — header · intent summary · inputs · **what will change** · reason · footer — rendered from the contract's `ui` spec and the view module. Seven invariants:
1. **Snapshot on confirm** — freeze payload and diff when Confirm is pressed; dispatch sends the frozen object
2. **Pause reseeding while dirty** — a banner, never an overwrite
3. **Dirty guard** on ESC / scrim / ✕ / Cancel
4. **Result state stays in the drawer** — history link; on `sent`, the retry button is **disabled**
5. **Step-up predicted** via `preflightStepUp`, not discovered
6. **Disabled = explained** — every disabled button names the missing input or scope
7. **Environment badge + promotion state** in the header

Reuse only: `SlideOver`, `AppButton`, `AppFormField`, `AppInput`, `AppCombobox`, `DataTable`, `BADGE_BASE`/`toneClass`, `useToastStore`, `StepUpPrompt`, `KebabMenu`, `EfsLocationPicker`. There is **no `ConfirmDialog` and no `EmptyState`**.

**Lift verbatim** from `CardControlDrawer.vue`: per-intent idempotency keys, re-mint-on-settle with the `sent` exception, the re-entrancy guard, the card-identity reseed.

**Verify:** one test per invariant, each named for the defect it prevents.

### Step 6.2 — Migrate the operations
**Change:** one commit each — Lock · **Deactivate (new: available on Active *and* Hold)** · Unlock · Grant exception · **Remove exception (shown whenever uses > 0 *or* a scope field is armed)** · Edit prompts. Add the **"what will change" diff** to every operation. **Always send a `reason`** so the history `Why` column stops being blank. **`docs/22:434-435` is the stale side** — it still documents reason as required; the code is correct (decision B1, 2026-08-12). Fix the doc, not the schema.
**Verify:** per operation — diff content, confirmation copy, four result states. Live QA before/after `read_state`.

### Step 6.3 — Triggers
**Files:** `apps/web/src/pages/FuelCardDetailPage.vue`, `FuelCardsPage.vue`, `ActiveOverridesPanel.vue`, `CardEffectiveConfig.vue`.
**Change:** an Actions card on the detail page grouped *Card status* / *Fuel access* / *At the pump*, omitting out-of-scope operations and naming who to ask · a `KebabMenu` column on the list page · `Remove exception…` per row in the overrides panel · `Edit…` per row in effective-config.
**Verify:** *"a yard manager without the override scope sees no Grant exception button and is told who to ask"*. **Manual:** list → kebab → Lock card… → confirm, in two interactions.

### Step 6.4 — Retire the old drawer
**Files:** delete `CardControlDrawer.vue` and re-home its test assertions.
**Verify:** `pnpm lint:filesize`; accessibility pass — focus moves to the confirmation heading, ESC during step-up cancels the step-up not the drawer, `aria-labelledby` on every section.

### ✅ Exit Gate — Phase 6
- [ ] One test per invariant, all green
- [ ] Every operation shows a diff before confirming
- [ ] `reason` reaches the ledger; `Why` column populates
- [ ] Old drawer deleted
- [ ] Standing gates green

---

## Phase 7 — Account & policy visibility

**Read-only. Produces the scan JSON that scopes Phases 9–12.**
**Preconditions:** Phase 4 ✅ (scanner exists).

### Step 7.1 — Inventory read operations
**Files:** `apps/api/src/lib/efsAccountOps.ts`, `packages/shared/src/efsAccountContract.ts` (new).
**Change:** following the `getPolicy` template in `efsCardOps.ts` exactly — `getPromptTypes`, `getPolicyDescriptions`, `getProducts`, `getProductGroups`, `getContracts`, `getCreditLimits`, `getCardRefreshingLimits`, `getPolicyRefreshingLimits`, `getLocationGroupDescriptions`, `getLocationGroups`, `getSitePolicyDescriptions`, `getCarrierInfo`, `serverTime`.
**Verify:** one recorded fixture per op; assert the request wrapper and `clientId`, and that the parse matches.

### Step 7.2 — Inventory endpoint
**Files:** `apps/api/src/routes/fuelCards/inventory.ts` (new), `apps/api/src/app.ts`.
**Change:** `POST /api/fuel-cards/account-inventory` — admin, read-only, **no probe flag**. Sequence: `getCarrierInfo` → `getPromptTypes` → `getContracts` → per contract `getCreditLimits` → `getPolicyDescriptions` → per policy `getPolicy` + `getPolicyRefreshingLimits` → `getProductGroups` → `getProducts` → `getLocationGroupDescriptions` → `serverTime`. Optional `{sampleCards?}` (max 25, org-owned) adds `getCardv2` + `getCardRefreshingLimits`. Returns a structured, PAN-redacted inventory plus a `steps[]` array in the `/diagnose` shape.
**Verify:** route test under 28 requests. **Deployed:** green on QA and on production.

### Step 7.3 — Model every field production sends
**Files:** `packages/shared/src/efsWsSchemas.ts`, `apps/api/src/lib/efsCardXml.ts`.
**Change:** extend `wsCardSchema` with everything the scan finds unmodelled — known: `payrollAtm`, `payrollChk`, `payrollAch`, `payrollWire`, `payrollDebit`. Parse them.
**Verify:** new fixture `getCardV2.production.xml` (redacted, from a real production card). **The scan fails on an unmodelled field**; the mirror sweep only **logs** it.

### Step 7.4 — Surface what is parsed but dropped
**Files:** `apps/api/src/routes/fuelCards/read.ts`, `apps/web/src/features/fuelCards/cardControlModel.ts`, `useEfsCards.ts`, `CardEffectiveConfig.vue`.
**Change:** include `locationGroups`, blocked `locations`, `locationSource`, and the payroll flags in the `effective` payload. Render `autoRollMap` / `autoRollMax` with copy stating **`autoRollMax = 0` means no daily maximum, not unlimited**. Add refreshing limits (cached, graceful null) and credit headroom per contract. Add a policy parity view showing what each policy sets and the four `*Source` fields.
**Verify:** feed the scan JSON into the pure renderers (`promptRows`, `limitRows`, `timeRows`, `sourceSentence`, `activeOverrides`) and assert **every observed field is reachable by exactly one row and no row renders `undefined` or `—`**. This is the parity gate — mechanical, not eyeballed.

### Step 7.5 — Mirror fixes
**Files:** `apps/api/src/services/efsCardMirror.ts`, `apps/api/src/env.ts`.
**Change:** **split `sync_error`** — `linkFuelCards` runs LAST in `syncCards` and unconditionally overwrites the value both earlier passes set to null, so a linking outcome is displayed as *"Last refresh reported: ambiguous_fuel_card_link"* on a refresh that succeeded. One column, two unrelated meanings, and the UI reads the alarming one. A separate `link_status`, or a structured `{code, source, at}`. **Small enough to pull forward at any time.** · raise `EFS_CARD_SYNC_MAX_DETAIL` above the fleet count **and assert `budget > fleetSize` as an invariant** · add a **ratio guard on tombstoning** (today a partial roster of 40/199 stamps `absent_since` on 159 live cards) · surface `absent_since` in `EFS_CARD_LIST_COLS` · stop the roster-only `card_version: ""` case throwing a 409 that claims the card changed — show "not yet read from EFS".
**Verify:** *"a partial roster does not tombstone"* · *"a card first seen by the roster reports not-yet-read, not card_state_changed"*. **Deployed:** after one sweep, every production card has `detail_synced_at`.

### Step 7.6 — Produce the inventory
**Files:** `docs/25-EFS-ACCOUNT-INVENTORY.md` (generated from the scan JSON), scan JSON committed.
**Change:** run `pnpm efs:scan` against QA and production. The document must answer: which Info IDs the account has and uses · **whether odometer following is configured, on which field, with what accrual value** · **the account's exact vocabulary for every writable string field** · which limit IDs with what values · whether refreshing limits are set and where · real credit ceilings · whether location groups are in use · whether time restrictions are in use · what each policy sets · **production's document shape and whether it matches QA's** · any field production sends that we do not model.
**Verify:** every question answered with the raw evidence quoted and the source operation named. **This document scopes Phases 9–12 — if it contradicts an assumption there, stop and re-scope.**

### Step 7.7 — Card identity: last-4 is not one *(filed 2026-08-15, from the Step 3.11 read)*
**Files:** `apps/api/src/services/efsCardMirror.ts` (`linkFuelCards`), `apps/web/src/features/fuelCards/`.
**Why this is its own step and not part of 7.5.** 7.5 splits `sync_error` so a linking outcome stops being displayed as a refresh failure. That fixes the DISPLAY. It does not fix the linking, and the measurement says the linking is the larger problem: **50 last-4 groups hold more than one card**, 140 of 234 rows carry `ambiguous_fuel_card_link`, and **182 of 234 cards are unlinked** — so fuel attribution is running on a minority of the fleet. Last-4 `7550` alone resolves to four distinct cards on four different units. Evidence and counts: `docs/22`, entry *"Last-4 is not an identity on this fleet"*.
**Change:** link on an identity that is one — `card_ref_hmac` against the fuel-card record's own sealed number, falling back to (last-4 + unit) or (last-4 + driver) only where those are unique, and leaving genuinely ambiguous rows unlinked with a *reason* rather than an error. Every card-picking UI that shows `••••NNNN` alone must show the unit or driver beside it: on this fleet that string does not identify a card to a human either.
**Verify:** a fixture with two cards sharing a last-4 links each to the right fuel card, or links neither and says why — never the wrong one. Count of linked cards recorded before and after. **Live:** the `ambiguous_fuel_card_link` count on production drops, and any row still carrying it names which cards it could not tell apart.

### Step 7.8 — Override state has no staleness signal *(filed 2026-08-15, from the ••••7550 live read)*
**Files:** `apps/web/src/features/fuelCards/` (card detail + the override badge), `apps/api/src/routes/fuelCards/read.ts`.
**Why.** `EFS_CARD_SYNC_HOURS` defaults to 24, and the mirror is what the badge renders. Production card ••••7550 / unit 651 showed `Override: 1 use left` for **nine hours** after EFS had retired it — the override was consumed 38 minutes after the last sync, and nothing re-read the card until a manual refresh. The badge was not wrong when written; it was wrong when read, and nothing on the screen said which. Evidence: `docs/22` H4.
**The distinction that makes this worth a step.** A stale `status` is tolerable — the card page is not the authority on whether a card is locked, and a lock is idempotent. A stale `override` count is not: it is the number that says whether a driver can take another free tank, it decrements without us, and it is the one field on this card whose staleness has a dollar value.
**Change:** render `detail_synced_at` beside any override state, and treat a count older than one sync cycle as unknown rather than as zero-or-N — the UI must be able to say *"last read 9 hours ago"*. Offer refresh-on-view for the override panel specifically. Do NOT raise the global sync frequency to paper over it; that spends vendor budget on 234 cards to fix one field.
**Verify:** a mirror row older than `EFS_CARD_SYNC_HOURS` renders as stale in the pure renderer, with the age shown · a fresh row renders the count. **Live:** grant on QA, read the badge, confirm the age is displayed and correct.

### ✅ Exit Gate — Phase 7
- [ ] Every field in the production document is modelled; parity gate mechanical and green
- [ ] Card detail shows prompts, limits (with auto-roll), refreshing limits, time restrictions, location groups, blocklist, hand-entry, all four sources, policy origin
- [ ] Credit headroom per contract visible
- [ ] Every card has `detail_synced_at` after one sweep
- [ ] `docs/25` generated and reviewed by the user
- [ ] Standing gates green

---

## Phase 8 — Card status *(first production promotion)*

**Preconditions:** Phases 5, 6, 7 ✅.

| Step | Change | Verify |
|---|---|---|
| **8.1** | Add **Deactivate**, available on Active **and** Hold — today retiring a held card requires unlocking first, momentarily re-enabling fuel purchases. New capability `card_deactivate` (contract + behaviour + view), typed last-four confirmation, step-up | *"a held card can be deactivated without first being unlocked"* |
| **8.2** | Prove `card_lock`, `card_unlock`, `card_deactivate` on QA | `pnpm efs:prove <cap> --card <last4>` — all five OEG green each; record in `docs/22` |
| **8.3** | Config scan against production for all three | Three-state result recorded; `unobserved` on any `vocabularyField` blocks |
| **8.4** | Promote to production | Outcome recorded either way. **A block is the system working** — record the blocker and resolve it before forcing |

### ✅ Exit Gate — Phase 8
- [ ] Three capabilities proven on QA and recorded in `docs/22`
- [ ] Promotion attempted for production; outcome recorded
- [ ] QA cards restored; standing gates green

---

## Phase 9 — Driver assignment & prompts

**Blocked on Phase 2. Scoped by Phase 7's inventory (Info IDs, validation types, odometer configuration).**

| Step | Change | Verify |
|---|---|---|
| **9.1** | Expose `getPromptTypes` results, cached per org. Replace `EFS_EDITABLE_INFO_IDS` with a runtime-resolved set (intersection of `getPromptTypes` with `EFS_INFO_LABELS`), keeping the hardcoded pair as fallback | *"falls back to DRID/UNIT when getPromptTypes is unavailable"*. **Live QA:** the returned set matches the inventory exactly, **including casing** |
| **9.2** | `promptInputSchema.infoId` → `z.string()` validated against the resolved set at request time. `validationType` → `z.enum(EFS_VALIDATION_TYPES)` — **all seven** — with `DYNAMIC` → `{CNTN, PPIN, DRID}` enforced. Add `value` (required when `ACCRUAL_CHECK`). Add optional `lengthCheck` / `minimum` / `maximum`. Remove the 2-prompt array cap | Contract tests for each acceptance and each rejection |
| **9.3** | **Odometer following:** `promptsEdits` writes `value` for `ACCRUAL_CHECK` instead of hardcoding `"0"`. Display it as *"Driver enters the odometer; the pump rejects a reading more than N miles from the last one."* Add the accrual input | *"an ACCRUAL_CHECK prompt carries its accrual value onto the wire"* asserting the exact `<value>` bytes |
| **9.4** | Add the `infoSource` precondition — a card-level prompt write on a `POLICY`-source card is a silent no-op reported as success today. Surface as a disabled state with the reason | *"a prompt write on a POLICY-source card is refused, naming the source"* |
| **9.5** | **Decompose `promptsEdits` before it exceeds the 200-line function cap** — a per-validation-type table, not a switch | `pnpm lint:funcsize` |
| **9.6** | Per-prompt Edit / **Add** / **Remove** as three explicit actions. The confirmation lists every add, change and removal by name and value | *"can add a prompt the card does not have"* · *"cannot add one already on the card"*. **Live QA:** add a prompt to the reserved **empty-`<infos>`** card — this exercises Phase 2's sequence fix on a real document |
| **9.7** | Prove and promote | Full OEG recorded; promotion outcome recorded |

### ✅ Exit Gate — Phase 9
- [ ] Prompt IDs come from `getPromptTypes`, not a constant
- [ ] All seven validation types reachable; `DYNAMIC` constrained
- [ ] Odometer following settable with its accrual value and displayed correctly
- [ ] Add / edit / remove are three explicit actions
- [ ] QA cards back to their original prompts

---

## Phase 10 — Override with amount

**Blocked on Phase 2.**

| Step | Change | Verify |
|---|---|---|
| **10.1** | `grantOverrideSchema` gains optional `limits: z.array({limitId, limit: 0..EFS_LIMIT_MAX, hours: 0..999, minHours: 0..999}).max(10)`. `overrideGrantEdits` appends `{op:"replaceAll", name:"limits", records, removals: []}` when present. Require `scope.kind === "all"` and step-up whenever limits are present | *"a product-limit override sends the p194 limits array"* asserting the exact bytes for the guide's own example, **in sequence position** · *"…on a card with no existing limits places limits before locationGroups"* · *"…requires step-up"* · *"…requires scope=all"* |
| **10.2** | Fix override residue — "Remove exception" renders only when `overrideUses > 0`, so a card with an armed scope field and zero uses is unclearable. Show it whenever uses > 0 **or** a scope field is armed | *"a card with residue can be cleared"* |
| **10.3** | UI: product select from the account's limit IDs, amount with the **unit spelled out** (gallons for fuel and DEF, dollars otherwise via `formatLimit`), window hours, min hours. Confirmation names product, amount with unit, window, uses | *"the confirmation names the product, amount and unit"* · *"an amount above 9999 is rejected before submit"* |
| **10.4** | Prove on QA using the reserved **empty-`<limits>`** card | Full OEG. **Plus one confirming observation:** clear the override and re-read — the card's original limits must be restored |
| **10.5** | Promote | Outcome recorded |

### ✅ Exit Gate — Phase 10
- [ ] Product-limit override works end to end, proven live on QA
- [ ] Restore-on-clear confirmed by observation
- [ ] Sequence ordering holds on a card with no pre-existing limits
- [ ] QA cards restored

---

## Phase 11 — Spend limits & velocity

**First `direct` capability and first `sequence`.**

| Step | Change | Verify |
|---|---|---|
| **11.1** | Product-limits editor — the same `replaceAll` edit Phase 10 proved. Per-product `limit` / `hours` / `minHours` / `autoRollMax`; `limit ≤ 9999`; gallons-vs-dollars enforced in the UI | Full OEG. Verify `autoRollMax = 0` behaves as "no daily maximum" |
| **11.2** | `setCardRefreshingLimits` as a **`direct`** capability. Its `verify.snapshot` reads `getCardv2` **plus** `getCardRefreshingLimits`; `judge` compares the extra | *"an unlanded refreshing-limits write is not reported as succeeded"*. Full OEG |
| **11.3** | The `…OVER` recipe as a **`sequence`**: `[echo setCard, direct setCardRefreshingLimits(cardNumber + "OVER")]`. Uses the `step_index` and `partial` state from Phase 3. The UI names the step by its `label` when a half fails | **An explicit half-failure test:** what do the ledger and the UI say when step 0 lands and step 1 does not? Plus the documented manual recovery |
| **11.4** | Prove and promote each | Recorded in `docs/22` |

### ✅ Exit Gate — Phase 11
- [ ] All three proven on QA
- [ ] The half-failure path is tested and the recovery documented
- [ ] QA cards restored

---

## Phase 12 — Access controls

**Scoped by Phase 7 — build only what the account uses.**

| Step | Change | Verify |
|---|---|---|
| **12.1** | **`handEnter`** ALLOW / DISALLOW / POLICY — one enum write, the cheapest anti-skimming control. Danger confirm when moving **to** ALLOW; step-up on ALLOW | Full OEG. **OEG-4 is critical** — a vendor string field, exactly the H1 class. If the config scan reports `unobserved` for the writable values, promotion needs the production canary card |
| **12.2** | Time restrictions — `replaceAll` on `timeRestrictions`. Day is **1 = Sunday**; the date part of `beginTime`/`endTime` is meaningless | Full OEG; sanity-check against `serverTime` |
| **12.3** | Blocked locations — `locations` is a **blocklist** | Full OEG |
| **12.4** | Location groups — **only if Phase 7 says the account uses them.** These are `account`-target ops and need the second `LedgerAdapter` (`docs/27` §5.2) | If built: the adapter first, then the capabilities |

### ✅ Exit Gate — Phase 12
- [ ] Every capability the inventory found in use is editable
- [ ] Each proven and promoted, or blocked with a recorded reason
- [ ] Parity re-check against a fresh scan shows zero discrepancies

---

## Phase 13 — Card lifecycle

| Step | Change | Verify |
|---|---|---|
| **13.1** | `replaceLostOrStolenCard`, `reissueDamagedCard` — typed last-four confirmation, step-up required, *"the old card can never be reactivated"* stated plainly | Full OEG |
| **13.2** | `transferCard` — **`target: {kind:"cardPair"}`**. ⚠️ One ledger row protects one card, so a transfer can race a lock on the destination. **Design and test the mitigation before shipping** (a two-row protocol or an advisory lock) | The race is tested, not just noted |
| **13.3** | `setCardPin` — **`carriesSecret: true`, so `redactResponse` is mandatory**; its documented output *is* the PIN. Never rendered, never logged | *"the PIN does not appear in the ledger, the response, or any log"* |

### ✅ Exit Gate — Phase 13
- [ ] The `cardPair` race is mitigated and tested
- [ ] PIN redaction proven by an assertion over the stored row

---

## Phase 14 — Advanced

| Step | Change |
|---|---|
| **14.1** | **Capacity bridge** — size `ULSD` gallon limits from measured `sensor_capacity_gal`. **Guard the unit trap:** an EFS limit is per reset window (`hours`) and capped at 9999; tank capacity is a one-shot physical bound. Explicit tested conversion plus a headroom cushion |
| **14.2** | `managedFuelAction` — route-locked fueling. Bulk, `account` target. Needs the bulk design that `docs/27` §11 leaves open |
| **14.3** | **Revert** — `before_document` is stored for exactly this. Unblocked once Phase 7 Step 7.3 models every field |
| **14.4** | Per-minute rate limits into shared storage — before scaling past one API replica |

---

## §14 — Handoff log

*Append one entry per session. Never delete an entry.*

### QA card roles *(fill in Phase 0 Step 0.13 — last-4 only)*

| Last-4 | Role | Observed starting state | Policy |
|---|---|---|---|
| | | | |

### Decisions

| Date | Decision | Made by |
|---|---|---|
| 2026-08-13 | **`lint:filesize` IS in the required CI set** (`ci.yml`), and `main` was red. Resolved in Phase 0 | recon + Phase 0 |
| 2026-08-13 | **Step 0.6:** split what no phase touches; time-boxed pins for what Phase 3 rewrites. `samsara.ts` was **split**, not re-pinned — its growth was logic | Claude (PM) |
| 2026-08-13 | **Step 0.12 approver scopes: explicit grant always.** A legacy grant never implies a new scope. Existing four stay granted | Claude (PM) |
| 2026-08-13 | **`reason` becomes per-capability in Phase 3.** Optional for lock/unlock/deactivate; required for override, prompts-with-removal, hand-entry, PIN, lifecycle. B1 stands API-wide until then | Claude (PM) |
| 2026-08-15 | **Step 3.11 resolves to `indeterminate`, not a tolerance and not a refusal.** The count is judged strictly; the two scope fields this account never reports are not judged at all. Converts to an adapter or a precondition when Phase 4.4 answers | Miki (chose it), Claude (options) |
| 2026-08-15 | **Phase 2's exit gate amended identically to Phase 3's** — deleted-assertion count, not "every test passes unchanged". Two twin gates must hold one standard | Claude (PM), Miki delegated |
| 2026-08-15 | **Every §6.G carried finding gets a number or a fix this session.** Two fixed (`finalizeFailed` diagnosis, the poller unseal throw); the rest are Steps 5.6–5.10. Rule 16 is not satisfied by a handoff bullet | Claude (PM) |
| | Promotion authority *(needed before Phase 8)* | |

### Sessions

| Date | Phase | Steps completed | Notes / surprises |
|---|---|---|---|
| 2026-08-14 | 3 | **live QA — and it found a P0** | Four of five operations pass through the generated router: lock (Hold and Inactive), unlock, prompts on a card that has them, override clear. **Override grant lands and is recorded `failed`** — the badge shows the override because `updateMirror` is fed from the verifying re-read, while `intentLanded` condemns the write. Filed as **Step 3.11**, and it blocks Phase 4, whose Step 4.5 builds a live prover on the same `judge`. **Two findings sharpened by reading the WSDL:** `override` is `int` on `WSCardHeader`/`WSCardSummary` and `boolean` on every `WSTransaction*` — a card counter and a per-purchase flag, and we never read the transaction side; and `managedFuelAction` carries `qtyAllowed`/`effDt`/`locationId`, which is the semantics of the 50-gallon auto-closing override Miki granted in the portal, sitting unscoped in Phase 14.2. **`ambiguous_fuel_card_link` mechanism proven:** `linkFuelCards` runs last in `syncCards` and overwrites the `sync_error` both earlier passes set to null; a manual Refresh does not, so the message is from the sweep and the refresh succeeded. Filed into 7.5. **No UI to add a prompt to a card with none** — the API can (`appendRecord`), the drawer cannot; that is Step 9.6 and it needs a card from 0.13. **The lesson:** eleven steps of byte-level offline verification were structurally blind to all of this, because every test scripts its own after-document. |
| 2026-08-14 | 3 | **3.10** | **Mutation score 18/18, 7 new.** The seven are the phase's own defects, written down: dropped `vendorMovesFields`, dropped `reconcile`, `===` instead of `efsStatusEquals` on the fraud gate, the DRID opt-in bypassed, a mismatched write bucket, the preflight moved after the limiter, `partial` collapsed into `failed`. Each had been hand-verified when its fix landed; the harness is what stops that from being a thing somebody once did. **`mutation-check.yml`'s path filter never followed the code** out of `services/` into `efs/`, so pushes touching a behaviour stopped triggering it — only the Monday cron would have. Fixed, and it is a workflow edit, which should be read as one. **Phase 3's exit gate now has exactly one open item: the live QA.** |
| 2026-08-14 | 3 | **3.9** | The background sweep could never settle a `direct` op: it skipped every row with an empty edit list, and a dedicated vendor op writes no edits — so an unverified `deleteOverride` stayed "Unverified" forever with the answer one read away. **`efsCardUnresolved.ts` had no test file**, which is how a one-line skip survived being read repeatedly; it reads like a guard against rows that cannot be judged and is a guard against the rows that most need it. Fixed via an after-only `reconcile` on the verify plan, read through the capability's own `snapshot`. Now three-valued, so `indeterminate` leaves a row visible rather than settling it by default, and a `capability_key` this build does not declare is skipped rather than judged by somebody else's predicate. The audit row records `judgedBy`. |
| 2026-08-14 | 3 | **3.8** | The fitness test **found a real defect on its first run**: `CARD_MUTATION_STATUSES` never learned about `'partial'`, which 0190 added to the CHECK in Step 3.2 and the orchestrator has written since 3.4. It backs a `z.enum` the history view parses through, so a partial row was a status the database accepts and the drawer cannot name — three steps with the drift sitting there. Labelled "Partly applied", which names the shortfall rather than the failure. **`WRITE_ROUTES` converted** to derive paths from the registry — the one pre-existing test change docs/27 §10 allows — with bodies kept in a keyed map, since only a capability's schema knows what a valid one looks like, and a guard that fails if the map misses one. **The view pairing had to live web-side**; a contract with a behaviour and no view is a capability the API executes and the drawer cannot describe. |
| 2026-08-14 | 3 | **3.7** | `CardMutationIntentSpec`, `CardMutationVendorOp`, `resolveIntentSpec`, `executeCardMutation` and `control.ts` all deleted. **Two pre-existing test files changed and both got stronger**: `efsCardControl.test.ts` (21 cases) and `efsCardWriteDeadline.test.ts` were driving hand-written specs that RESEMBLED the production recipes, and now run against `cardLockBehaviour` and `deleteOverrideBehaviour` themselves — every assertion unchanged, but the matrix now fails if the shipped lock changes. **Found by running it: the characterisation suite was at 3.1s per case against vitest's 5s default and timed out in a full run.** The stub answers the verifying re-read with the same document, so four of five cases slept the full 3s `EFS_CARD_VERIFY_RETRY_MS` before deciding a landing this suite does not assert — 62% of the timeout budget, on the suite that gates every migration in this phase. Set to 0: 3.1s → 62ms per case, same bytes asserted. **All four Phase-3 waivers deleted.** |
| 2026-08-14 | 3 | **3.6 complete** | `override_clear` migrated as **two contracts sharing one intent** — the shape docs/27 §7.2 names — with `mountedCapabilities(env)` as the single place that picks, and mounting both refused outright rather than decided by registration order. That is the seam Step 4.2 needs. `prompts_set`'s removal refusal became a `precondition`, which gained `PlanCtx`: the rule needs the computed removals AND the opt-in AND fresh-auth, and it raises two different codes from them, so splitting it across two hooks would mean keeping one rule in step by hand. **Two guards this step moved had NO test between them** — the fraud step-up and the DRID removal — which is why it produced eight new cases before deleting anything, each verified by breaking the code it covers. **`control.ts` is 483 → 135 lines** and serves only the history read. |
| 2026-08-14 | 3 | **3.6 (2 of 4)** | `card_unlock` and `override_grant` migrated, characterisation byte-identical after each. **Both step-up hooks changed signature** from `boolean` to `string \| null` first, in its own commit: the two real gates say different things and a boolean forced a generic sentence built from the contract's verb. **The fraud step-up was asked twice and is now asked once** — the mirror-based early prompt is gone, `planStepUp` decides against the document EFS returns. `docs/27` §3.4 requires that, and the mirror is stale in both directions, but it IS a behaviour change and neither ask had a test. Wrote four; verified load-bearing by removing the gate and by swapping `efsStatusEquals` for `===`. **`CapabilityCardContext` gained a `locationLabel` resolver** so the override confirmation can keep naming the station rather than degrading to an id. **Stopped at 2 of 4 deliberately** — the remaining two each have a design question recorded under Step 3.6, and deciding them at the end of a long session is how the wrong one gets picked. |
| 2026-08-14 | 3 | **live QA — credited to 3.4, not 3.5** | Miki confirmed lock and unlock work on the QA card. **Both hosts were running `b15e909` at the time** (`/healthz`, checked before crediting it), which is Step 3.4 — 3.5 was still sitting in PR #28. So the run exercised the hand-written handler in `control.ts` driven by the NEW orchestrator: it is the live proof Step 3.4 was owed and had not had, and it covers the step loop, the ledger adapter and the snapshot/judge rewrite on a real card. It is **not** evidence for 3.5, whose generated router was not in that build. **Re-run lock and unlock once `514dc3e` is live** — that is the check Step 3.5 still owes, and the same two clicks answer it. Recording the distinction rather than the convenient reading: a green test against the wrong build is how a migration gets marked verified without ever having run. |
| 2026-08-15 | 3, 5 | **3.11 done** · `finalizeFailed` diagnosis · the `efsSoapIngest` unseal throw · Phase 2 gate wording amended · **Steps 2.6, 5.6–5.10, 7.7, 7.8 filed** | **The P0 was one field, and the read made it a bigger finding.** `overrideAllLocations` sent `true`, read back `false`, condemning a grant whose count landed. Across **all 234 mirrored cards in both orgs** that field reads `true` zero times and `locationOverride` is populated zero times — **this account does not report override scope at all**, so location-scoped grants are equally unverifiable and have simply never been run live (`docs/22` H3). Grants now settle `indeterminate`, and accumulate on the unresolved list until Phase 4.4 — stated as a cost, not hidden. **The plan's own decisive query did not work:** `drift` is null on failed rows because only `finalizeLanded` writes it; fixed, and a failed row now names its unlanded fields. **§6.E closed, and I got it wrong first:** ••••7550 is FOUR distinct cards, and the one with `override_uses = 1` was a stale mirror — the consuming transaction landed 38 minutes after the sync, which two timestamps could not distinguish from "EFS still says 1" (`docs/22` H4). The portal's 50-gallon grant **does** drive `WSCardHeader.override` and EFS retires it on use, contradicting the same day's earlier speculation. **The Phase 2 exit gate FAILS:** the one org with card control has `write_entitlement = 'confirmed'` and a null `probed_identity_hash`, and the code grandfathers it — the binding is inert on 100% of orgs it governs (Step 2.6). **Fleet identity is broken:** 50 last-4 groups hold more than one card, 182 of 234 cards unlinked (Step 7.7). **The lesson, again and from the other side:** yesterday offline verification was blind to vendor truth; today a mirror row was mistaken for vendor truth. A mirror only ever tells you what EFS said at `detail_synced_at`. |
| 2026-08-15 (later) | 3 | **Phase 3 exit gate CLOSED** · the `finalizeUnverified` evidence gap | The live re-run on `af1a8e5` did what it was supposed to: the grant that used to record `failed`/`no_change` now records `sent`/`unverified`, the audit says `card.mutation_unverified` and not `card.mutation_failed`, the mirror shows the count EFS actually holds, the clear settles `succeeded`, and **`card_version` returns to `15189d97…`, byte-identical to before the test** — rule 14 proved by hash rather than by eyeball. **And it found two things eleven steps of offline verification could not.** ① The first `sent` row this outcome ever produced in anger carried `after_document` NULL: `finalizeUnverified` was written for "the re-read failed", Step 3.11 routed "read fine, cannot judge" into the same finaliser, and the row an operator is *told to go and look at* ended up with less evidence than the `failed` row it replaced. Fixed in `5222564` — the same mistake as the morning's `finalizeFailed` gap, one outcome over, and the same rule: reusing a helper gets you all of its behaviours, not the one you wanted. ② The clear was refused `mutation_in_flight`, which is **correct** — `assertNoneInFlight` holds a `sent` row for 58s and the harness ran the clear immediately. I called it a defect before reading the guard; it is not one. Grants now always settle `sent`, so every grant→clear meets that window where before it did not. |
| 2026-08-14 | 3 | **3.5**, **3.5b** | The pilot works: `card_lock` is served from its descriptor and the characterisation suite is byte-identical. **Proved it is really the new path** by unmounting the generated router — only the lock case fails. **I withdrew my own 3.5a**: the note I wrote that morning said to stub Phase 4's promotion table with a lookup that fails closed on a missing row, and since the table does not exist until Step 4.1, that would have refused every lock in production. It is Step 4.2 and always was; 4.2's backfill is the thing that makes the gate safe, and it must share a migration with the table. **`defineBehaviour` and `defineView` never bound anything** — `CapabilityContract<never>` is a bound no real contract satisfies, and `TBody` was free, so the contract could not constrain the body. That is docs/27 §7.3's fourth claim; `types.test.ts` checked the other three and this was the one that did not hold. Fixed and asserted. **`vendorRateLimit.test.ts` caught the route move** — the one route-enumeration fixture docs/27 §10 permits to change; its failure was in the safe direction. **Two live checks still owed on 3.5:** lock and unlock on the QA card, which is the only thing that can prove the generated router works against real EFS. |
| 2026-08-14 | 3 | **3.4** | **The §1 table was stale by three phases** — it still read "Phase 0 🔶, Step 0.15 outstanding, Phases 1–3 not started" while PRs #5–#25 had merged. §0.1 routes the next session off that table, so it was sending sessions to finished work. Reconciled against the repo (`lint:ui-adoption` green locally, CI green on `main` at `12a86a8`), not against a summary. **3.4 landed with the characterisation suite byte-identical and no pre-existing test edited** — the exit criterion held. **Two items of 3.4 deliberately NOT done**, both route-layer and both impossible to write honestly yet: the promotion lookup (no Phase 4 table) and `preflightStepUp` before the limiter (no descriptor at the route). They are now numbered **3.5a / 3.5b**, with the standing hazard recorded: a capability declaring `preflightStepUp` is silently ignored until 3.5b. **`efsCardControl.ts` 507 → 85 lines, waiver DELETED** — the entry Phase 3's exit gate exists to remove. **Found by running it:** a sequence mixing an echo step with a direct one reports the direct step's footprint as unexplained drift unless the capability declares `vendorMovesFields` — the first two-step run came back `drift_detected` with everything working. **`lint:comment-claims` was red on `main`** (confirmed on `origin/main` at `12a86a8`) and is not yet in `ci.yml`, which is why CI did not see it; the comment named a test without quoting it. Fixed. **One unexplained intermittent:** five cases in `fuelCardsControl.test.ts` failed together once in eleven full runs, 403 where 400 was expected, never reproduced since and not in isolation — the diff touches no auth or limiter code. Numbered **Step 5.4** rather than waved away. |
| 2026-08-14 | 3 | **3.1**, **3.2**, **3.3** | Continues the row below. **Echo scan GREEN: 197/197, 0 failed** — Phase 2's headline gate item. Migration 0190 applied via migrate.yml, `/healthz` ok. **Two Railway services found, only `fleetguardapi` reaches EFS**; `fleetguardweb` runs a full API copy whose egress WEX blocks (`NotAllowed`, p9), and `deploy-verify` polls only one of them — see `docs/29`. Live QA: Miki confirmed status changes AND prompts changes work, which is §6 check 1. Two bugs found by him and one fixed: the REPORT_ONLY attribution read (#23), and an override that still shows after EFS consumed it (open, needs a live Refresh to tell vendor-truth from sync staleness). Step 3.2 deliberately did NOT widen the approver scopes CHECK — Phase 3 adds no new scope. |
| 2026-08-14 | 1, 2 | Phase 1 exit-gate prep; **2.1**, **2.2** | Single engineer, no separate reviewer. **PR #11 carried a second bug**: the 409 recovery latch was set and never cleared, so a reopen after a successful retry showed the pre-change document and guaranteed another 409. Two exits needed — closing, and any settled outcome, since `drift_detected`/`sent` settle without closing — each with a test that fails when only that exit is removed. **`idleRollup.test.ts` was failing 18 hours a day** (PR #12): two date anchors computed independently from `Date.now()` collapse onto the same UTC date from 06:00 UTC on. `main` was red; #11 went green only because its run landed at 03:5x. **Matrix `rls` re-baselined 375 → 377** (migration 0189), verified as coming from `main` alone. **Phase 2 is only 40% done** — the handoff document described 2.1 and 2.2 as the whole of Phase 2 and omitted 2.3–2.5. **Live QA:** Miki confirmed status change works; that exercises `setField` only, so it touches neither the 409 path nor anything #13 changed. A prompts save is the untested path and is now stricter. |
| 2026-08-13 | 0 | All except 0.13 | **CI had been red on `main` since `61a05ca` (2026-08-12)** — one commit's worth of stale test fixtures blocked every migration and driver build. Five correct stops by the executor; **three were errors in the task, not the code**: a missing step for the second typecheck error, an impossible verify on Step 9, and an over-tight commit scope. **Step 0.8 produced a real finding** — the nested-container flattening in `recordFromElement` is a second instance of the `replaceAll` tautology, folded into Phase 2 Step 2.1. Gate lists both improved: `samsara.ts` left the filesize waivers, `syncIdleEvents` left the funcsize waivers. Railway probe flag confirmed **unset**. |
