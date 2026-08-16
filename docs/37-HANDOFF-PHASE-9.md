# Handoff — FuelGuard EFS card control, Phase 9

**Date:** 2026-08-16 night · **Written for:** the next Claude Code session
**Repo:** `miroslav-jokovic/fuel-guard` (**PUBLIC**) · **Owner:** Miki (product manager, sole decision-maker)
**Phase 8:** 🔶 8.1 ✅ merged · 8.2 partial (2 of 3 proven) · 8.3, 8.4 not started
**Migrations applied through 0199** · **17 `ci.yml` gates**

Supersedes `docs/36-HANDOFF-PHASE-8.md`, which stays as the Phase 8 record.
Read this, then `docs/28-EFS-EXECUTION-PLAN.md` §0 and §1, then Phase 9.

---

## 1. Phase 9 is BLOCKED on fixtures Miki must create by hand. Read this before planning anything

Phase 9 is "Driver assignment & prompts". Its scope, measured on the real accounts in Phase 7
(`docs/25` Q1), is one row:

> **40 prompt types available · 8 in use · 2 this product may edit.**

Production uses `DRID NAME TRIP TRLR UNIT CNTN DLIC DLST`. `EFS_EDITABLE_INFO_IDS` is `["DRID","UNIT"]`
— a list **this codebase chose**, not one the vendor gave us. Step 9.1 replaces it with the runtime
intersection of `getPromptTypes` and `EFS_INFO_LABELS`. That is the whole point of the step.

**But two of Phase 9's seven steps cannot be verified on QA as it stands:**

| Step | Needs | QA reality |
|---|---|---|
| **9.4** | a card with `infoSource=CARD` and one with `POLICY` | **All 35 QA cards are `BOTH`.** No candidate for either |
| **9.6** live check | a card with an EMPTY `<infos>` | ✅ `2b7b97df…` ••••7690 is reserved for exactly this |

`docs/28` §14's role table has said this since Step 0.13 and it is **finding F**, still open:
five fixtures need creating in the WEX portal. Two of them are Phase 9's.

**Do not improvise around this.** Step 9.4 exists because a card-level prompt write on a
`POLICY`-source card is a **silent no-op reported as success** today. A step whose entire subject is
"this write silently does nothing" cannot be signed off against an account where the condition
does not occur. Build it, unit-test it, and record the live check as owed — the way Phase 7 recorded
Q6 and Phase 8 recorded `card_unlock`.

### ⚠ Verify Step 9.5 before you do it. Its premise looks stale

9.5 says: *"Decompose `promptsEdits` before it exceeds the 200-line function cap."*

Measured 2026-08-16: `promptsEdits` (`apps/api/src/services/efsCardEdits.ts:220`) is **~82 lines
against a 200-line cap**. `lint:funcsize` reports the two functions actually near the budget as
`createApp` (194) and `syncIdleFoundation` (180) — neither is Phase 9's.

So 9.5 is preventive, not corrective, and 9.2 (seven validation types, no array cap) is what would
grow it. **Measure first, then decide whether the step is still buying anything.** This is not
hypothetical caution — see §4.1.

---

## 2. What Phase 8 left on the table, and it is small but real

**Do these before starting 9.1** — they are Miki's terminal, not yours, and they close a phase.

| # | Owed | Detail |
|---|---|---|
| 1 | **`card_unlock` has never been proved** | Voided **three times** across two sessions (`7cedf66c`, `73e2186b`, and one earlier). Every void was correct — OEG-3 refuses to call a no-op a success — and every one hit a card already ACTIVE |
| 2 | **H14's fix is unexercised live** | Every proof so far started from ACTIVE, so every revert routed to `card_unlock`, which carries **no status field**. `oeg5RevertLanded: true` twice proves the ROUTING, not the CASING |
| 3 | ⚠ **`EFS_CARD_CONTROL_PROBE_ENABLED` is TRUE on `@fleetguard/api`** | Standing rule 15. A real-card write path is open on a live service until it is unset and redeployed |
| 4 | **8.3 config scan, 8.4 production promotion** | Not started |

**One run closes 1 and 2:** `prove card_unlock` against `14df9dc9…` **••••7675**, which rests at
INACTIVE. It gives the capability its first proof AND reverts through `statusRevert`'s
`INACTIVE → card_deactivate` branch — which before Phase 8 was `card_lock` with `{status:"INACTIVE"}`,
refused by that capability's own schema, leaving the card unlocked.

> **The CLI prompts for a CARD NUMBER, not a last-four.** Both failed attempts were pointed at
> ••••7671 because that PAN was to hand. ••••7675's PAN is in Miki's out-of-repo QA list (rule 13).

**Still unreachable:** the `HOLD → card_lock {status:"Hold"}` revert — the only one that still carries
a status. It needs a card resting at Hold, which QA does not have. Until then `canonicalEfsStatus` in
`statusRevert.ts` is proved by unit test and by mutation, and **not** by a live run. Say so; do not
let a future summary round it up.

---

## 3. Where things actually run — settled, stop re-deriving it

A remote container has **NO route** to the vendor, Supabase or Railway. Verified every session:
`env | grep -c "^EFS_\|^SUPABASE_"` → `0`. `promptHidden()` in `scripts/efs.mjs` **dies on
`!process.stdin.isTTY`** (line 69), so even a container with full network could not run the CLI.
Do not ask for a firewall change; ask Miki to run the command.

### Railway — the names, finally written down

The CLI shows the project as **`serene-elegance`**. The services are:

| Service | Domain |
|---|---|
| `@fleetguard/api` | `fleetguardapi-production.up.railway.app` |
| `@fleetguard/web` | `fleetguardweb-production.up.railway.app` |

**`fleetguardapi` is a DOMAIN prefix, not a service name** — `railway variables --service fleetguardapi`
returns *"Service not found"*. That cost a confused command on 2026-08-16.

Set on 2026-08-16: `EFS_CARD_SYNC_MAX_DETAIL=500` (API), `EFS_ROUTES_ENABLED=false` (web — **finding
H closed**, owed since Phase 5), `EFS_CARD_CONTROL_PROBE_ENABLED=true` (API — **must be unset**).

> Both EFS variables were previously **unset**, not misconfigured. Finding I's feared `200` was the
> code default in `env.ts`, never an explicit pin. It is now explicit at 500 against a 197-card fleet.

### The operator CLI

```
node scripts/efs.mjs prove <capability> --expect-org qa
node scripts/efs.mjs promote <capability> --proof <uuid> --reason "why"
node scripts/efs.mjs scan | inventory | sync | job [kind] | echo-scan
```

`--expect-org qa|production|<uuid>` — **USE IT ON EVERY COMMAND.** It resolves the org from the
SERVER and refuses before reading anything or writing a byte.

Streams are separated: human output → **stderr**, JSON → **stdout**, so `inventory > file.json`
produces clean JSON. `pnpm lint:cli-streams` keeps it true by RUNNING the CLI, because
`process.stdout.write` is a different spelling from `console.log`.

⚠ **Never let a token reach the chat.** One did on 2026-08-16 and had to be rotated.

---

## 4. Standing instructions from Miki — every one earned

1. **Push back.** *"in future push back on my ideas if you think they are not good."*
2. **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that immediately, because if we dont do it we can forget."*
3. **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type safe and enterprise grade."*
4. **You decide the HOW.** He decides SCOPE, and anything touching his WEX account or production secrets.
5. **PANs never enter the repo.** Masked last four only (••••7671). Rule 13.
6. **Run the commands yourself.** Git, tests, gates, PRs, merges are yours. Only the vendor CLI is his — TTY and token.
7. **Verify the plan before implementing it.** *"don't trust it blindly before implementing any step verify our currant situation and counsel it."*
8. **When he says run the commands and finish it, that includes merging.** Wait for CI green, then merge — do not ask again.

⚠ A decision-log row attributed to **"Claude (PM)"** is a RECOMMENDATION, not a decision, wherever it
contradicts one of Miki's. Decision B1 removed `reason`; a session logged its own override as
authority and a required *Why* field shipped in front of the man who had deleted it four days earlier.

---

## 5. The method — what this session actually proved works

### 4.1 Verify the plan's premise against the CODE before implementing. It has now been stale twice

**Phase 8.1** justified itself with *"today retiring a held card requires unlocking first, momentarily
re-enabling fuel purchases."* **Phase 6.5 had closed that** — the same day the handoff quoting it was
written. A five-minute probe (`statusRows("HOLD")`) showed the step's own Verify already passing
against `main`.

The step was still worth doing, for a reason the plan did not state: the **audit trail**. That is the
shape to expect — not "the step is wrong", but "the step's stated reason is spent and a better one is
underneath it". Find the better one, or say the step is done.

**Phase 9's 9.5 looks like the same thing** (§1). Measure it.

### 4.2 The codebase can overrule you. Read the migrations next to what you are changing

I decided `card_deactivate` should reuse the `lock` scope — no new power, no migration — and wrote
down the reasoning. Then migration **0190**'s closing note turned up:

> *"The first genuinely new scope arrives with `card_deactivate` in Phase 8.1 … Phase 8.1 must widen
> it, in the same migration that adds the capability and its grant statement."*

A prior migration had reserved the exact decision I was making. **Before designing anything that
touches a CHECK constraint, grep the migrations for the thing you are about to change.**

### 4.3 A green gate is evidence for ONE claim. Check which branch actually ran

Two proofs returned `oeg5RevertLanded: true` and it was tempting to call H14's fix confirmed live. It
is not: both runs started from ACTIVE, so both reverts took the `card_unlock` branch, which carries no
status. The fix lives in a branch neither run reached.

**When a live run goes green, ask which code path it exercised — not whether it passed.**

### 4.4 A mutation that SURVIVES means withdraw the claim, not keep the test

I wrote a test asserting the drawer's frozen capability protects against a mid-flight draft change.
Mutating the guard left it **green**. `confirm()` enters `run()` synchronously, so the window does not
exist. The freeze stayed (it is half of what the operator authorised) but the test was rewritten to
assert something true, and the comment now says plainly that no reachable gap exists.

A test you cannot make fail is a claim you have not earned.

### 4.5 Validating a NEW migration on a scratch database finds defects in OLD ones

Running 0199 in PGlite and inserting rows it should refuse found that **0173's non-empty scopes CHECK
has never held**: `array_length('{}',1)` is NULL, `NULL >= 1` is NULL, and a CHECK only rejects on
FALSE. Fixed with `cardinality` in the constraint 0199 was already rewriting (`docs/22` **H15**).

Assert the constraint by **inserting what it should reject**, not by reading it.

### 4.6 Verify a guard by BREAKING it, and count what goes red

Every guard added this phase was mutated: `Inactive` back through `card_lock` → **7 red** · typed
last-four removed → **2** · guide casing → **2** · `===` for `efsStatusEquals` → **1** · verbatim
revert casing → **6** · `statusIsRevertible` unconditional → **3**.

### 4.7 The rest, carried forward and still true

- **Run it, don't reason about it.** Reproduce before you fix.
- **A successful response is never evidence of a correct write. Only a re-read is** (rule 11).
- **A test that passes against both the bug and the fix is worthless.** Every assertion of absence needs a positive control beside it.
- **Derive; never hand-list** — except where the hand-list IS the pin two independent derivations check (`CAPABILITIES_WITH_STEP_UP_GATE`, `EXPECTED_KEYS`).
- **Never weaken a gate to make it green** (rule 1). If a gate blocks you — stop and report.
- **Two gates failing together may have ONE cause** (docs/35 §4.5).
- Before opening a PR, re-read the diff as an adversary: `as any`, `@ts-ignore`, `.skip(`, `.only(`, `eslint-disable`, `toBeTruthy(`; count deleted `expect(` against added.

---

## 6. What Phase 9 inherits — state, not history

### 6.1 The capability architecture: three artifacts, one contract

```
packages/shared/src/efs/capabilities/*.contract.ts     key, intent, route, scope, bucket, schema, ui
apps/api/src/efs/capabilities/*.behaviour.ts           mutation, verify, governance, proof
apps/web/src/features/fuelCards/capabilities/*.view.ts confirmation, diff, stepUp
```

`defineContract` / `defineBehaviour` / `defineView` pin one `z.infer` across all three.
`registry.test.ts` on both sides holds them together — `lint:boundaries` stops `apps/api` importing
`apps/web`, so no single test sees all three.

**Seven capabilities now.** Phase 8 added `card_deactivate`; `EXPECTED_KEYS` in
`apps/api/src/efs/registry.test.ts` is the pin — update it when you add one.

**Each of the three writable statuses now has exactly ONE capability, ONE scope, ONE audit action:**

| Status | Capability | Scope | Body carries a status? |
|---|---|---|---|
| `Active` | `card_unlock` | `unlock` | no |
| `Inactive` | `card_deactivate` | `deactivate` | **no** |
| `Hold` | `card_lock` | `lock` | yes — `{status:"Hold"}` |

Do not collapse these. Two routes to one status with two audit actions is audit **P0-3**.

### 6.2 The prompts surface as it stands — Phase 9's actual starting point

| Thing | Where | Today |
|---|---|---|
| Editable IDs | `efsCardCatalog.ts:235` | `["DRID","UNIT"]` — a constant **9.1 replaces** |
| Validation types | `efsCardCatalog.ts:159` | all seven declared; the schema accepts **two** |
| `DYNAMIC` pairing | `EFS_DYNAMIC_INFO_IDS` | `["CNTN","PPIN","DRID"]` (p36, p136) — declared, unenforced |
| Edits builder | `efsCardEdits.ts:220` `promptsEdits` | ~82 lines / 200 cap |
| Operations | `cardOperations.ts` | `promptAdd` and `prompts` — Add exists (Phase 6.5); **Remove is 9.6's** |
| Step-up | `stepUp.ts` `promptRemovalNeedsStepUp` | EVERY removal, not only `DRID` |

`replaceAll` means the array in the request **IS** the card's prompts afterwards (guide p137). An add
must send every existing record back alongside the new one — sending only the new one deletes the
rest, which is the deletion the characterisation suite exists to catch.

### 6.3 Production account facts, measured

| | production | QA |
|---|---|---|
| cards | 197 live (+2 tombstoned) | 35 |
| status | ACTIVE 129 · INACTIVE 38 · HOLD 32 | ACTIVE 33 · INACTIVE 2 |
| prompt types has / uses / editable | 40 / 8 / 2 | 41 / 3 / 2 |
| `infoSource` | — | **BOTH on all 35** |
| document shape | `nested:header` | `nested:header` |

**28 of 35 QA cards have no card-level prompts at all**, consistent with `infoSource: BOTH` and the
prompts living on the policy.

### 6.4 UI house patterns, and the traps

| Need | Use | Trap |
|---|---|---|
| Row/section actions | `KebabMenu` + `<BaseButton class="kebab-item">` | `lint:ui-adoption` counts raw `<button>`/`<input>` in `pages/`+`features/` with **ZERO tolerance**, by regex over file TEXT — naming the element in a comment trips it |
| Any text input | `AppInput` from `@fuelguard/ui` | a raw `<input>` fails `lint:ui-adoption`; found the hard way in Phase 8 |
| Table toolbar / table | `FilterBar` · `DataTable` + `TablePagination` in `#footer` | — |
| Drawer | `SlideOver` (`size="lg"`) | it is in `apps/web/src/components/`, not `packages/ui` |
| Tabs | hand-rolled `role="tablist"` of `BaseButton`s | there is no Tabs component; copy `CompliancePage.vue` |
| Empty state | `DataTable`'s `empty-text` | there is no `EmptyState` and no `ConfirmDialog`. Do not invent them |

⚠ **`CardOperationDrawer.vue` is at ~500/500 lines.** Phase 8 had to extract three modules
(`TypeToConfirm.vue`, `operationBlocker.ts`, `useOperationDispatch.ts`) to land. **Budget an
extraction into any Phase 9 UI work** — `lint:filesize` fails unconditionally when a file is over,
which can then mask a mutation probe (docs/35 §4.5).

### 6.5 RLS traps

`efs_card_mutations` has RLS enabled with **NO POLICY** — a browser query returns an empty list, not
an error. The API (service role) is its only reader. `audit_logs` **is** client-readable (admin+auditor).

---

## 7. Gates

**Re-derive, never copy:** `grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml`

```bash
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
pnpm install --frozen-lockfile && pnpm --filter @fuelguard/shared build:rn
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm lint:secrets            # AFTER committing — it scans `git archive HEAD`
# The four gates ci.yml does NOT run. Green CI is necessary, not sufficient.
pnpm lint:comment-claims && pnpm lint:wsdl && pnpm lint:codegen
node scripts/mutation-check.mjs   # 18/18
```

⚠ Without that `export`, three `apps/web` suites fail with `supabaseUrl is required`. It reads as a
real regression in card-control code and is not one.

⚠ `pnpm format:check` is **not a gate**. 1,177 files fail it on `main`.

**Matrix counts must hold:** `rls` **381** · `hazmat_rls` **38** · `load-lifecycle` **61** ·
`duty-sessions` **25** · `efs-card-control-triggers` **17**. A count that *drops* is a finding.

**gitleaks is not installed in a fresh container.** Install it, never skip the gate:
```bash
curl -sSL -o /tmp/gl.tar.gz https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/gitleaks_8.28.0_linux_x64.tar.gz \
  && cd /tmp && tar xzf gl.tar.gz gitleaks && mkdir -p ~/.local/bin && mv gitleaks ~/.local/bin/ \
  && export PATH="$HOME/.local/bin:$PATH"
```

**`check:card-binding` runs on Miki's Mac only** — it reads the live database and this repo is PUBLIC.

**`mutation-check.yml` cannot run on a PR by design** (weekly · `workflow_dispatch` · pushes to `main`
touching a watched path). Run it by hand and record the score in the PR body, as every phase has.
**Dispatching it is not available to this session's GitHub token (403).** If you add files a mutation
mutates or detects with, walk `mutation-check.mjs`'s `file:`/`detect:` entries against the trigger-path
list — that walk is what PR #74 came from. All fourteen were covered as of 2026-08-16.

**Migrations reach Supabase by MERGING**, not by hand: `migrate.yml` auto-applies on push to `main`
touching `supabase/migrations/**`, gated by `require-ci-green`. 0199 applied that way at 21:07Z on
`46ee6cf`; the ledger reported `0199 | 0199 | 0199`. **Never dispatch `migrate.yml` by hand.**
Validate against a scratch database first — that is how H15 was found.

---

## 8. Open findings carried into Phase 9

| # | Finding | Where |
|---|---|---|
| **F** | ⚠ **BLOCKS 9.4.** No QA card has `infoSource=CARD` or `POLICY` — all 35 are `BOTH`. Also no card at Hold, only one with limits, no time restrictions. **Five fixtures, USER DECISION** | §14, `docs/25` |
| **A** | Phase 11 BLOCKED: production policy 2 sets DSL 0 and ULSD 0. "No cap" or "no fuel"? `formatLimit` renders `0 gal` today | `docs/25` Q5 |
| **B** | Phase 12 has nothing to manage: `carrierInfo.locationGroups` is `false` on both orgs; the 18 groups are vendor-global and non-editable | `docs/25` Q8 |
| **C** | Credit headroom must not render `totalAvailable` — it is 0 against $83,437.42 of real credit | `docs/25` Q7, 7.4 |
| **D** | Q6 unanswered on production — `getPolicyRefreshingLimits` `rate_limited` twice. Fifteen paced calls in sequence trips this vendor's limiter | `docs/25` |
| **E** | 7.8's QA badge drill never run | 7.8 |
| **G** | 40 production cards unlinked — a DATA ceiling: 29 lack a unit prompt, 5 have no `fuel_cards` row | 7.7, H13 |
| **J** | 7 product groups have no label: `ACCE CWAS HOTL HYDR PARK TCHN TWAS` | `docs/25` |
| **K** | ⚠ **`EFS_CARD_CONTROL_PROBE_ENABLED` is TRUE on `@fleetguard/api`** — rule 15 outstanding | §2 |
| **L** | `card_unlock` unproved after three voids; H14's casing fix unexercised live | `docs/22` H16 |

**Closed this session:** **H** (`EFS_ROUTES_ENABLED=false` on the web service) and **I**
(`EFS_CARD_SYNC_MAX_DETAIL` was unset, now explicit at 500).

---

## 9. Useful commands

```bash
# Session start
cd <repo> && git log --oneline -5 && git branch --show-current && git status --short
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
pnpm install --frozen-lockfile
env | grep -c "^EFS_\|^SUPABASE_"                # 0 means no live work is possible from here

# Before touching UI
node scripts/ui-system-inventory.mjs --summary
node scripts/check-file-size.mjs                 # 500-line cap is a CI gate
node scripts/check-function-size.mjs             # 200-line cap — run this BEFORE doing Step 9.5

# The matrices
for m in rls hazmat_rls load-lifecycle duty-sessions efs-card-control-triggers; do
  node supabase/tests/$m.test.mjs | tail -1
done

# LIVE — Miki's Mac only, always with --expect-org
node scripts/efs.mjs prove card_unlock --expect-org qa     # ••••7675's PAN, NOT ••••7671
node scripts/efs.mjs scan --expect-org production
node scripts/efs.mjs sync --expect-org production && node scripts/efs.mjs job efs_card_sync
```

**Rule 14:** never leave a QA card dirty — every live run ends with a revert and a proving re-read.
**Rule 15:** unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy after any session that needed it.
