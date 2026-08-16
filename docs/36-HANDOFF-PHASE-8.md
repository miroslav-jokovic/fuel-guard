# Handoff — FuelGuard EFS card control, Phase 8

**Date:** 2026-08-16 · **Written for:** the next Claude Code session
**Repo:** `miroslav-jokovic/fuel-guard` (PUBLIC) · **Owner:** Miki (product manager, sole decision-maker)
**Phase 7:** ✅ CLOSED · **Migrations applied through 0198** · **17 `ci.yml` gates**

Supersedes `docs/35-HANDOFF-PHASE-7.md`, which stays as the Phase 7 record.
Read this, then `docs/28-EFS-EXECUTION-PLAN.md` §0 and §1, then Phase 8.

---

## 1. Phase 8 is the FIRST PRODUCTION WRITE. Everything below is shaped by that

Phases 1–7 read. Phase 8 changes a customer's fuel cards, on the production org, for the first time.
Four steps:

| Step | What | Where it runs |
|---|---|---|
| 8.1 | New capability `card_deactivate` — Deactivate available on Active **and** Hold | offline |
| 8.2 | Prove `card_lock`, `card_unlock`, `card_deactivate` on **QA** | live, QA writes |
| 8.3 | Config scan against **production** for all three | live, read-only |
| 8.4 | **Promote to production** | live, and the first real write authority |

**8.1 is fully buildable offline. 8.2–8.4 need Miki's Mac** (see §2). Do 8.1 first, completely, then
hand him a single command list.

### Why 8.1 exists, in the plan's own words

> *"Add **Deactivate**, available on Active **and** Hold — today retiring a held card requires
> unlocking first, momentarily re-enabling fuel purchases."*

That window is the whole point. Read it twice before designing anything: the current path makes a
stolen card **live again** for the duration of two API calls. `card_deactivate` must reach `Inactive`
from `Hold` **without passing through `Active`**.

### ⚠ The P0 you must not undo

`card_lock` may write **Hold and Inactive only**. `card_unlock` is the **only** path to `Active`.
That is audit **P0-3**: `Active` in the lock schema was an unlock reachable through the lock route, so
a lock-only approver could reactivate a Fraud-held card while the audit row said `card.locked`.

`card_deactivate` is a **third** capability in that family. Before you write a line, decide and write
down: which scope approves it, and can it reach any status other than `Inactive`? The answer to the
second is no. `cardOperations.ts` already dispatches by ticked value (`capabilityFor`) — that is the
mechanism, do not build a second one.

---

## 2. Where things actually run — settled, stop re-deriving it

**A remote container has NO route to the vendor, Supabase or Railway.** Verified every session:
`env | grep -c "^EFS_\|^SUPABASE_"` → 0, `curl https://fleetguardapi-production.up.railway.app` → 000.

**Live work runs from Miki's Mac** — local Postgres, Railway CLI, `apps/api/.env`, a terminal
(`docs/32` §123: *"this session he told me to run it and I did, twice"*). `promptHidden()` in
`scripts/efs.mjs` dies on `!process.stdin.isTTY`, so **even a container with full network could not
run it**. Do not ask for a firewall change; ask Miki to run the command.

> Cited by symbol, not by line: this said `efs.mjs:68` and the check had already moved to 69 —
> shifted by *this phase's own* stdout fix, within a day of being written. **Cite live code by
> symbol; a line number into a file that is still changing rots silently and reads as verified.**
> The `§N` citations into `docs/29`/`31`/`32` are line numbers too, but those are frozen handoffs —
> they are fine, leave them alone.

### The operator CLI, and what this phase added to it

```bash
node scripts/efs.mjs prove <capability> --expect-org qa
node scripts/efs.mjs promote <capability> --proof <uuid> --reason "why"
node scripts/efs.mjs scan | inventory | sync | job [kind] | echo-scan
```

**`--expect-org qa|production|<uuid>` — USE IT ON EVERY COMMAND.** Added 2026-08-16 after three
consecutive runs used a QA token while one was redirected into a file named `…-production.json`. It
resolves the org from the SERVER and **refuses before reading anything or writing a byte**. A banner
alone was not enough — it told him afterwards.

**Streams are separated: human-facing output → stderr, JSON result → stdout.** So
`efs.mjs inventory --expect-org qa > file.json` produces clean JSON. Before 2026-08-16 the token
prompt went to stdout, and a redirected command sat waiting on stdin for a credential it appeared
never to have asked for — five minutes of "it's stuck". `pnpm lint:cli-streams` is the gate that
keeps this true; it RUNS the CLI rather than grepping it, because `process.stdout.write` is a
different spelling from `console.log`.

**A production token comes from being signed into the PRODUCTION app.** The browser-console snippet
copies the token for whichever tab is signed in.

⚠ **Never let a token reach the chat.** One did on 2026-08-16 and had to be rotated. An admin token is
an hour of full org access.

---

## 3. Standing instructions from Miki — unchanged, and every one has been earned

1. **Push back.** *"in future push back on my ideas if you think they are not good."*
2. **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that
   immediately, because if we dont do it we can forget."*
3. **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type
   safe and enterprise grade."*
4. **You decide the HOW. He decides SCOPE**, and anything touching his WEX account or production secrets.
5. **PANs never enter the repo.** Masked last four only (••••7671). Rule 13.
6. **When he says run the commands and finish it, that includes merging.** Wait for CI green, then
   merge — do not ask again.
7. **⚠ A decision-log row attributed to "Claude (PM)" is a RECOMMENDATION, not a decision**, wherever
   it contradicts one of Miki's. Decision B1 removed `reason`; a session logged its own override as
   authority and a required `Why *` field shipped in front of the man who had deleted it four days
   earlier. **When the plan says a decision is settled, believe the plan over your own reasoning.**

### 3.1 Two he added during Phase 7, in his words

8. **Run the commands yourself.** *"Please run all commands, and also propelry analyze things before
   you declare something as blocking."* I had been handing him `git add`/`commit`/`push` chores I
   could run myself. **Git, tests, gates, PRs, merges are yours.** Only the vendor CLI is his, and
   only because of the TTY and the token.
9. **Verify the plan before implementing it.** *"don't trust it blindly before implementing any step
   verify our currant situation and counsel it."* This is the single highest-value instruction in
   this document — see §4.

---

## 4. The method that made Phase 7 worth doing, and the evidence for it

**Read the plan. Then verify its claims against the code and the checked-in WSDL BEFORE implementing.**
Phase 7 did that and found **five plan errors and three live surprises**, every one of which would
otherwise have shipped as green, reviewable code.

| Found | Would have shipped as |
|---|---|
| 3 of 13 operations do not return `<result>` | Following `getPolicy` "exactly" → three operations parsed as permanently empty, indistinguishable from a card with no refreshing limits |
| `getPolicyRefreshingLimits` takes `policy`, not `policyNumber` | An Axis2 shape fault, no useful message |
| `getLocationGroups` needs `cardNum`/`policyNum` | An account walk calling an operation that cannot answer an account question |
| 7.2's 28-request budget unmeetable with unbounded loops | A budget the Verify asserts and the code silently exceeds |
| 7.3 names 5 unmodelled fields; the WSDL declares **6** | `numericMatchValue` — the THIRD place a prompt keeps its value, in a function whose docblock said two, after that defect shipped twice already |

**And three the LIVE runs found that no amount of reading would have:**

- **Location groups are `false` on both orgs.** Phase 12 has no management surface to build.
- **Two production policy limits are `0`** — `DSL 0`, `ULSD 0` — with no way to tell "no cap" from
  "no fuel". Phase 11's limits UI is blocked on a WEX answer.
- **Production `totalAvailable: 0` against `creditAvailable: $83,437.42`.** A headroom widget would
  have told an operator a solvent fleet has nothing.

> **`docs/25` is the artefact. Eleven of twelve questions answered with quoted evidence.** Read it
> before Phases 9–12 and treat its three ⚠ blocks as instructions to stop.

### 4.1 Verify a guard by BREAKING it, and count what goes red

Every guard in Phase 7 was mutated. Reading `<result>` for the refreshing limits → 2 red.
`policyNumber` for `policy` → 2. A fixture field the WSDL never declares → 1. Unbounding 7.2's loops
→ budget red at 46 requests. Removing the blocklist cap → red at 7,948 rows.

**And a prediction is usually wrong about the MECHANISM even when right about the number.** Before
the production sweep I named four things its stats would show; all four held, which is what made the
run evidence rather than a formality. Do that: say what you expect *before* the command runs.

### 4.2 A test that passes against both the bug and the fix is worthless

`expect(errored).toBeTruthy()` was satisfied by both the bare string and the structured record —
replaced with three assertions on `source`, `code` and `at`. An assertion of absence needs a positive
control beside it.

### 4.3 Derive; never hand-list — and where a hand-list IS right

`MODELLED_CARD_FIELDS` is a hand-list, which lesson 4.4 normally forbids. It is the exception that
rule names: **a PIN two independent derivations check.** The WSDL test asserts every declared field is
pinned; `unmodelledCardFields()` asserts every field a real document carries is pinned. Only the
second finds what the WSDL does not say; only the first finds what no card happened to carry.

### 4.4 Real data finds defects that no test fixture will

Production policy 1 blocks **7,948 locations**. `locationRows` shipped that morning with no cap —
one row per entry. Nothing in the test suite would ever have produced 7,948 of anything.
**When live data arrives, re-read the code you wrote against it.**

### 4.5 Two gates failing together may have ONE cause

`lint:filesize` went red at 555 lines **and** `mutation-check` dropped to 17/18 with
`waiver-growth-unchecked` SURVIVED. Not a coincidence: an over-budget file makes the file-size gate
fail *unconditionally*, so that mutation's probe could no longer tell a working no-growth guard from
a dead one. **A survived mutation can be a symptom, not a testing problem.**

### 4.6 The rest, carried forward and still true

- **Run it, don't reason about it.** Reproduce before you fix.
- **A successful response is never evidence of a correct write. Only a re-read is.** (Rule 11)
- **A mirror row only says what EFS said at `detail_synced_at`.**
- **Never weaken a gate to make it green** (rule 1). If a gate blocks you — stop and report.
- **A step's prescribed change is a claim about the system, not a fact about it.**
- **Rule 9: never delete a comment referencing an incident, date, audit finding or ticket.**
- **Before opening a PR, re-read the diff as an adversary**: `as any`, `@ts-ignore`, `.skip(`,
  `.only(`, `eslint-disable`, `toBeTruthy(`; count deleted `expect(` against added.

---

## 5. What Phase 8 inherits — state, not history

### 5.1 The capability architecture: three artifacts, one contract

```
packages/shared/src/efs/capabilities/*.contract.ts   key, route, scope, bucket, schema, ui
apps/api/src/efs/capabilities/*.behaviour.ts         mutation, verify, governance, proof
apps/web/src/features/fuelCards/capabilities/*.view.ts   confirmation, diff, stepUp
```

`defineContract` / `defineBehaviour` / `defineView` pin one `z.infer` across all three.
`registry.test.ts` on both sides holds them together — `lint:boundaries` stops `apps/api` importing
`apps/web`, so no single test sees all three. **`card_deactivate` needs all three files plus a row in
`cardOperations.ts`.**

Operations ≠ capabilities: five operations over six capabilities, and status spans two.

### 5.2 What the production account actually is — read this before scoping anything

| | production | QA |
|---|---|---|
| cards | 197 live (+2 tombstoned) | 35 |
| status vocabulary | `ACTIVE` 129 · `INACTIVE` 38 · **`HOLD` 32** | `ACTIVE` 33 · `INACTIVE` 2 |
| prompt types: has / uses / editable | 40 / 8 / **2** | 41 / 3 / 2 |
| document shape | `nested:header` | `nested:header` |
| `overrideAllLocations` | `false` ×199 | `false` ×35 |
| location groups enabled | **false** | **false** |
| time restrictions | none | none |

**32 production cards are at `HOLD`** — so 8.1's "deactivate from Hold" has 32 real subjects, and
`card_lock`'s config-scan verdict is `match` on production (it is `unobserved` on QA only because no
QA card rests at Hold — that is a fixture gap, NOT a capability gap; `efs:prove card_lock` was green
on 2026-08-15, proof `40b88b75`).

### 5.3 Mirror behaviour Phase 7 changed

- **`sync_error` is `{code, source, at}`** (migration 0198), cleared ONLY by a pass holding the whole
  document. The roster pass records its own failures and never erases the detail pass's.
- **Tombstoning has a ratio guard** — max 20% of the live mirror per sweep, floor 5. Refuses and
  signals rather than marking fewer.
- **`EFS_CARD_SYNC_MAX_DETAIL` default is 1000** and `mirror_detail_budget_short` fires at `error`
  when it is below the fleet. ⚠ **If Railway still pins it at 200, the margin over 197 cards is
  three.** Worth a grep.
- **`card_never_read`** — a roster-only card (`card_version: ""`) is refused with an honest message
  instead of a zod string-length error.
- Last production sweep: job `79a40862`, 2026-08-16 18:13:36Z, `197/197 detailed, 0 failed`.

### 5.4 UI house patterns, and the traps

| Need | Use | Trap |
|---|---|---|
| Row/section actions | `KebabMenu` + `<BaseButton class="kebab-item">` | `lint:ui-adoption` counts raw `<button>` in `pages/`+`features/` with ZERO tolerance — **and it is a plain regex over file TEXT, so naming the element in a comment trips it** |
| Table toolbar | `FilterBar` | — |
| Table | `DataTable` + `TablePagination` in `#footer` | — |
| Drawer | `SlideOver` (`size="lg"`) | it is in `apps/web/src/components/`, not `packages/ui` |
| Tabs | hand-rolled `role="tablist"` of `BaseButton`s | there is no Tabs component; copy `CompliancePage.vue` |
| Empty state | `DataTable`'s `empty-text` | there is no `EmptyState` and no `ConfirmDialog`. Do not invent them |

### 5.5 RLS traps

`efs_card_mutations` has RLS enabled with **NO POLICY** — a browser query returns an empty list, not
an error. The API (service role) is its only reader. `audit_logs` IS client-readable (admin+auditor).

---

## 6. Gates, and the two added this phase

Re-derive, never copy: `grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml`

**17 gates in `ci.yml`** (21 steps, four of which are setup — Corepack, gitleaks, install, the RN
shared build). New this phase: **`lint:cli-streams`** (efs.mjs stdout discipline), which took it from
sixteen. `lint:wsdl` now checks **24** operation names.

⚠ Several gates are **NOT in `ci.yml`** and must be run by hand — `lint:comment-claims`, `lint:wsdl`,
`lint:codegen`, `mutation:check`, and `check:card-binding`. `check:card-binding` is out of CI on
purpose (it reads the live database and this repository is public); it needs `apps/api/.env`, so it
runs on Miki's Mac and nowhere else. Green CI is therefore necessary, not sufficient.

```bash
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
pnpm install --frozen-lockfile && pnpm --filter @fuelguard/shared build:rn
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm lint:secrets            # AFTER committing — it scans `git archive HEAD`

# The four gates ci.yml does NOT run. Green CI is necessary, not sufficient.
pnpm lint:comment-claims && pnpm lint:wsdl && pnpm lint:codegen
node scripts/mutation-check.mjs   # 18/18
```

⚠ **Without that `export`, three `apps/web` suites fail with `supabaseUrl is required`** — a fresh
container has no `.env` and CI supplies those two values in `ci.yml`'s job `env:`. It reads as a real
regression in card-control code (`cardOperationFailure`, `useEfsCards`) and is not one.

⚠ **`pnpm format:check` is not a gate and must not be treated as one.** 1,177 files fail it on
`main`, every prose doc among them; markdown in this repo has never been Prettier-formatted.

- **Matrix counts must hold: `rls` 381 · `hazmat_rls` 38 · `load-lifecycle` 61 · `duty-sessions` 25 ·
  `efs-card-control-triggers` 17.** A count that drops is a finding.
- **`gitleaks` is not installed in a fresh container.** Install it, never skip the gate:
  `curl -sSL -o /tmp/gl.tar.gz https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/gitleaks_8.28.0_linux_x64.tar.gz && cd /tmp && tar xzf gl.tar.gz gitleaks && mkdir -p ~/.local/bin && mv gitleaks ~/.local/bin/ && export PATH="$HOME/.local/bin:$PATH"`
- **`mutation-check.mjs` is not in `ci.yml`** — it has its own workflow, `mutation-check.yml`,
  running weekly (Mondays 06:00 UTC), on `workflow_dispatch`, and on pushes to `main` touching a
  listed path. **Run it by hand anyway**, because a green PR says nothing about it: `Mutation check`
  did not run on PR #73's merge commit at all.
  > **Check the trigger paths against the harness, not against your intuition.** Walking every
  > `file:` and `detect:` in `mutation-check.mjs` against that path list on 2026-08-16 found
  > `scripts/check-file-size.mjs` and `scripts/check-waiver-growth.mjs` uncovered — the two files
  > the `waiver-growth-unchecked` mutation mutates and detects with. Editing the files that mutation
  > guards did not re-run the harness proving the guard works. Both added.
  >
  > The same walk killed a plausible claim: **no mutation targets `apps/web`**, so the absence of a
  > web path is correct, not a hole. A gap you reason your way to is a guess; run the comparison.
- **`pnpm install` first.** A fresh container has no `node_modules` and `pnpm test` fails misleadingly.
- CI takes ~5 minutes. Do not schedule a 25-minute check-in for it.

---

## 7. Open findings carried into Phase 8

| # | Finding | Where |
|---|---|---|
| A | **Phase 11 BLOCKED**: production policy 2 sets `DSL 0` and `ULSD 0`. "No cap" or "no fuel"? Opposite meanings; `formatLimit` renders `0 gal` today | `docs/25` Q5 |
| B | **Phase 12 has nothing to manage**: `carrierInfo.locationGroups` is `false` on both orgs; the 18 groups are vendor-global, all rule-based and non-editable | `docs/25` Q8 |
| C | **Credit headroom must not render `totalAvailable`** — it is `0` against $83,437.42 of real credit. Also needs a vendor call per page view (audit P1-1); do it via the sweep | `docs/25` Q7, 7.4 |
| D | Q6 unanswered on production — `getPolicyRefreshingLimits` `rate_limited` twice. **Fifteen paced calls in sequence trips this vendor's limiter** | `docs/25` |
| E | 7.8's QA badge drill never run — grant on QA, read the badge, confirm the age | 7.8 |
| F | Phases 9–12 need WEX fixtures Miki must create by hand: **no card at Hold on QA**, no `infoSource=CARD` or `POLICY`, no time restrictions anywhere, only one QA card with limits | §14, `docs/25` |
| G | 40 production cards unlinked — a DATA ceiling: 29 lack a unit prompt, 5 have no `fuel_cards` row. The linker resolved one more on the 2026-08-16 sweep as data improved | 7.7, H13 |
| H | Two Railway settings owed since Phase 5: `EFS_ROUTES_ENABLED=false` on **fleetguardweb**; Step 5.5's `cancel-in-progress` verify (two pushes to `main` inside a minute) | 5.5, 5.10 |
| I | `EFS_CARD_SYNC_MAX_DETAIL` may still be pinned at 200 on Railway — three cards of margin over a 197-card fleet | 7.5 |
| J | 7 product groups have no label: `ACCE CWAS HOTL HYDR PARK TCHN TWAS` — a limit on one renders as the raw code | `docs/25` |

---

## 8. Useful commands

```bash
# Session start
cd <repo> && git log --oneline -5 && git branch --show-current && git status --short
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
pnpm install --frozen-lockfile
env | grep -c "^EFS_\|^SUPABASE_"                # 0 means no live work is possible from here
curl -sS "$HTTPS_PROXY/__agentproxy/status"

# Before touching UI
node scripts/ui-system-inventory.mjs --summary
node scripts/check-file-size.mjs                 # 500-line cap is a CI gate

# The matrices
for m in rls hazmat_rls load-lifecycle duty-sessions efs-card-control-triggers; do
  node supabase/tests/$m.test.mjs | tail -1
done

# LIVE — Miki's Mac only, and always with --expect-org
node scripts/efs.mjs prove card_lock --expect-org qa
node scripts/efs.mjs promote card_lock --proof <uuid> --reason "OEG green on QA"
node scripts/efs.mjs scan --expect-org production
node scripts/efs.mjs sync --expect-org production && node scripts/efs.mjs job efs_card_sync
```

**Rule 15: unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy after any session that needed it.**
**Rule 14: never leave a QA card dirty — every live run ends with a revert and a proving re-read.**
