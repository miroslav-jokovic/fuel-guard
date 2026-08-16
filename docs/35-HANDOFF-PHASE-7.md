# Handoff — FuelGuard EFS card control, Phase 7

**Date:** 2026-08-16 · **Written for:** the next Claude Code session
**Repo:** `miroslav-jokovic/fuel-guard` (PUBLIC) · **Owner:** Miki (product manager, sole decision-maker)
**`main` at handoff:** `f93221a` · **Migrations applied through 0197**

Supersedes `docs/34-HANDOFF-PHASE-6.md`, which stays as the Phase 6 record.
Read this, then `docs/28-EFS-EXECUTION-PLAN.md` §0 and §1, then Phase 7.

---

## 1. ⚠️ Read this before planning anything: **Phase 7 cannot be completed in this container**

Phase 7 is read-only, which makes it *sound* like the safe offline phase. It is not. Three of its
seven steps are **live-EFS steps**, and a remote container has no credentials and no route to them.

| Step | Needs live EFS? | Doable offline? |
|---|---|---|
| 7.1 Inventory read operations | **fixtures** — record from live, then offline | partly (see below) |
| 7.2 Inventory endpoint | **yes** — "Deployed: green on QA and on production" | build offline, cannot verify |
| 7.3 Model every field production sends | **yes** — needs a real production card document | no |
| 7.4 Surface what is parsed but dropped | **needs 7.6's scan JSON** | no |
| **7.5 Mirror fixes** | **NO** | ✅ **fully offline** |
| 7.6 Produce the inventory (`docs/25`) | **yes** — it IS the live scan | no |
| 7.7 Card identity | — | ✅ **DONE 2026-08-15, proven live** |
| 7.8 Override staleness signal | verify live; build offline | ✅ mostly |

**Verified this session, not assumed:** `env | grep -c "^EFS_\|^SUPABASE_"` → **0**, and
`curl https://example.supabase.co` → **000** (the network policy answers 403 to CONNECT for
`*.supabase.co` and `*.up.railway.app`). Check it yourself with
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` before planning anything live.

### So do this

**Start with 7.5 and 7.8.** They are the two steps that need no vendor call, 7.5 is explicitly marked
*"small enough to pull forward at any time"*, and 7.5 fixes a defect that is **currently lying to
operators on production**: `sync_error` shows *"Last refresh reported: ambiguous_fuel_card_link"* on
a refresh that succeeded.

> **7.5 is now SMALLER than the plan says.** Step 7.7 already took the linking half out of
> `sync_error` — migration 0195 added a separate `fuel_card_link` jsonb and the linker writes there.
> What remains is the *refresh* half plus four unrelated items: the `EFS_CARD_SYNC_MAX_DETAIL`
> invariant, the tombstoning ratio guard, `absent_since` in `EFS_CARD_LIST_COLS`, and the
> roster-only `card_version: ""` 409. Read 7.7's notes before starting 7.5 or you will redo work.

**Then stop and ask Miki** whether to build 7.1/7.2 blind (code without live verification) or wait
for a session with credentials. Do not quietly build three steps you cannot verify — this workstream
has been burned by exactly that shape (see §4).

---

## 2. Standing instructions from Miki — these persist across every session

These are his words, and they have all been tested by being ignored at least once.

1. **Push back.** *"in future push back on my ideas if you think they are not good."*
2. **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that
   immediately, because if we dont do it we can forget."*
3. **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type
   safe and enterprise grade."*
4. **You decide the HOW. He decides SCOPE**, and anything touching his WEX account or production
   secrets.
5. **PANs never enter the repo.** Reference cards by masked last four (••••7671). Rule 13.
6. **When he says run the commands and finish it, that includes merging.** Do not ask again. The one
   legitimate reason to wait is CI: `migrate.yml` is gated by `require-ci-green`, so merging red
   silently blocks migrations and the failure then looks like a deploy problem. **Wait for green,
   then merge — do not ask.**

### ⚠️ 2.1 The rule this session had to add, and it is the most important one here

> **A decision-log row attributed to "Claude (PM)" is a RECOMMENDATION, not a decision, wherever it
> contradicts one of Miki's. Scope is his.**

This is not abstract. Decision **B1 (2026-08-12, Miki)** removed the `reason` field. On **2026-08-13**
a session logged *"reason becomes per-capability … required for override, prompts-with-removal"*
against its own name, as authority. Step 6.2 then told the Phase 6 session plainly — *"docs/22 is the
stale side, the code is correct (decision B1). **Fix the doc, not the schema.**"* — and that session
did the exact inverse, writing the Claude-made rule into `docs/22` as product truth.

The result was a **required `Why *` field** shipped in front of the man who had deleted it four days
earlier. He found it by looking at the running app. The row is now struck through and marked
**VACATED** in §Decisions.

**When the plan tells you a decision is settled, believe the plan over your own reasoning about what
would be better.**

---

## 3. What is DONE, and the state you are inheriting

### Phase 6 — ✅ complete, plus three follow-on phases Miki opened after seeing it run

| | What | Where |
|---|---|---|
| **6** | Per-operation drawer; step-up rule moved to shared; per-capability promotion state + environment on the wire | PR #66 |
| **6.5** | `reason` removed from the LOGIC; status is one 3-item control; two sections with `⋮`; **prompts can be ADDED to a card that has none**; audit off the card page | PR #67 |
| **6.6** | Card changes as its own Audit Log tab, filtered by card and date | PR #68 |
| **6.7** | The audit Miki asked for — six findings, all fixed | `f93221a` |

### 3.1 The Phase 6 audit found no gaps left open. Here is what it looked for and what it found

Run these again if you touch this area; they are cheap and they each caught something.

| Check | Result |
|---|---|
| Stale imports of the deleted drawer/panels | clean — remaining hits are historical comments (**rule 9 protects those**) |
| **Dead exports (built, never consumed)** | **1 found** — see below |
| Filters/props with no caller | **2 found** — `cardId` on `/mutations`, `limits` on the drawer |
| Endpoints with no test | **1 found** — `/:id/history` |
| TODO/FIXME/assumption markers | none |
| Unclassified fuel-card routes | none (`vendorRateLimit.ts` enforces it) |
| Stale docblocks | 2 found |

> **The serious finding: Phase 6 recreated the exact defect it existed to fix.** Phase 6 existed
> because `capabilities/*.view.ts` was a registry nothing imported. Then Step 6.5.5 removed the
> history section from the card page saying *"CardMutationHistory.vue is kept — it is what that page
> will render"*, and 6.6 built `CardChangeLog.vue` instead. `CardMutationHistory.vue`, its
> `useCardMutations` hook and `GET /api/fuel-cards/:id/history` were all orphaned — **a component, a
> hook and an endpoint with no caller** — and deleting the endpoint broke no test, because it never
> had one.
>
> Closed by deep-linking the card page's `⋮` to `/settings/audit?tab=cards&cardId=<id>`, which also
> gave the `cardId` filter its first caller. **Watch for this shape.** "Keep it, something will use
> it later" is how it starts every time.

### 3.2 Two exit-gate items carried forward, deliberately not ticked

1. **The Step 6.3 visual check has never been run in a browser.** The link half is automated
   (`operationLink` / `operationFromQuery`, exercised end to end); the *visual* path needs a browser
   and a populated card list, which this container cannot provide. **Nobody has seen Phase 6 running
   except Miki**, and every screenshot he sent found something.
2. **`reason` reaching the ledger** — now moot; `reason` is gone. The ledger records time, person,
   action.

---

## 4. How to work here — earned, not theoretical

The first four are the ones this build keeps re-teaching. They are not style advice; each one has a
named incident behind it.

### 4.1 Verify a guard by BREAKING it, and count what goes red

Never ship a guard you have not seen fail. Every guard added in Phases 6–6.6 was mutated:

- dropping the view's step-up warning → exactly the web fitness assertion red
- dropping the behaviour's gate → exactly the API one red
- flattening the P0-3 capability pairing → exactly the status-routing test red
- moving `/mutations` after `/:id` → exactly two red

**And a prediction about which tests go red is usually wrong about the MECHANISM even when right
about the NUMBER** (Step 7.7: the unit tier was predicted to resolve ~100 links; it resolved 0 and
the PAN tier resolved 103 — same headline, completely different story).

### 4.2 A test that passes against both the bug and the fix is worthless

Ask what the BROKEN code would score before believing a green run.

- The trigger matrix compared `String(updated_at)`, and `String(new Date())` renders at **second**
  resolution — three cases failed spuriously and three would have passed against a trigger that did
  nothing.
- **This session:** *"says nothing on production"* asserted the ABSENCE of a badge. When the
  operation ids changed it began asserting that against a drawer rendering **nothing at all**. It now
  has a positive control. **An assertion of absence needs a positive control beside it.**
- `operationById(op.id)` finding `op` in the array it searches is a tautology. Rule 6: name the
  second independent route or admit it is one. It became builder→parser instead.

### 4.3 The fail-closed reflex can be the bug

`promotions[key] ?? "not_promoted"` looks like textbook fail-closed. An **enabled** capability's
entry IS `null`, so it refuses every capability anybody promoted — while all three existing refusal
tests stay green. **Check what your success value is before reaching for `??`.**

### 4.4 Derive; never hand-list

`check-waiver-growth.mjs` hand-named its victim file, went stale twice, and reported CAUGHT forever.
`run-tests.mjs` discovering the matrices is the pattern. This session: `promotedCapabilitiesTable`
derives from `CARD_CAPABILITY_KEYS`; the old bare fixture silently promoted **nothing** under a new
query and took two route suites red.

**Where a hand-list is unavoidable, make it a PIN that two independent derivations check against** —
`CAPABILITIES_WITH_STEP_UP_GATE` lives in shared, the API derives its set from behaviours, the web
derives its set from views, and neither side owns the list.

### 4.5 The rest, carried forward and still true

- **Run it, don't reason about it.** Reproduce before you fix.
- **A successful response is never evidence of a correct write. Only a re-read is.** (Rule 11)
- **A mirror row only says what EFS said at `detail_synced_at`.**
- **Never weaken a gate to make it green** (rule 1). No new waiver, no raised pin, no `.skip`, no
  loosened regex. If a gate blocks you — **stop and report**.
- **A step's prescribed change is a claim about the system, not a fact about it.** Step 5.7's fix was
  inert alone; Step 5.9 was filed "low severity, high tidiness" and turned 62 tests red.
- **A constraint is only as safe as your list of who writes the table.** 0197's first draft would
  have wedged cards permanently; `ledger.ts` is documented as "the only writer" and is not.
- **Before opening a PR, re-read the diff as an adversary:** `as any`, `@ts-ignore`, `.skip(`,
  `.only(`, `eslint-disable`, `toBeTruthy(`; count deleted `expect(` against added.
- **Rule 9: never delete a comment referencing an incident, date, audit finding or ticket.**

---

## 5. Patterns and conventions — so you do not have to rediscover them

### 5.1 UI — the house patterns, and the traps in them

| Need | Use | Trap |
|---|---|---|
| Row/section actions | `KebabMenu` + **`<BaseButton class="kebab-item">`** | **`DESIGN-SYSTEM-CONTRACT.md` used to say a bare `button` element. It is wrong** — `lint:ui-adoption` counts raw buttons in `pages/`+`features/` with **zero tolerance**. Corrected 2026-08-16 |
| Table toolbar | `FilterBar` (`v-model:search`, `#filters`, chips) | — |
| Table | `DataTable` + `TablePagination` in `#footer` | — |
| Dates | `DateRangeFilter` in `FilterBar`'s `#filters` | — |
| Drawer | `SlideOver` (`size="lg"`) | it is in `apps/web/src/components/`, **not** `packages/ui` |
| Tabs | **hand-rolled** `role="tablist"` strip of `BaseButton`s on `bg-surface-muted` | there is no Tabs component; copy `CompliancePage.vue:316` |
| Empty state | `DataTable`'s `empty-text` | there is **no** `EmptyState` and no `ConfirmDialog`. Do not invent them |

> **`lint:ui-adoption` is a plain regex over file TEXT.** Naming the element in a *comment* trips it.
> This cost a red gate this session.

### 5.2 The capability architecture — three artifacts, one contract

```
packages/shared/src/efs/capabilities/*.contract.ts   key, route, scope, bucket, schema, ui
apps/api/src/efs/capabilities/*.behaviour.ts         mutation, verify, governance, proof
apps/web/src/features/fuelCards/capabilities/*.view.ts   confirmation, diff, stepUp
```

`defineContract` / `defineBehaviour` / `defineView` pin one `z.infer` across all three.
`registry.test.ts` on **both** sides is what holds them together — `lint:boundaries` stops
`apps/api` importing `apps/web`, so no single test can see all three.

**Operations ≠ capabilities.** `apps/web/.../cardOperations.ts` is the UI-facing table: five
operations over six capabilities, and `status` spans **two** (`card_lock` for Hold/Inactive,
`card_unlock` for Active — audit **P0-3**; see §6.2).

### 5.3 Git and CI

- Branch: whatever the task names. **If its PR is already merged, reset onto `main` and keep the
  name** — never stack on merged history.
- `git push -u origin <branch>`; retry network failures 4× with backoff (2/4/8/16s).
- **CI on this repo takes ~4½ minutes** (one `build` check). Do not schedule a 25-minute check-in for
  it — that wasted five minutes this session and Miki noticed.
- **`lint:secrets` scans `git archive HEAD`** — run it **AFTER** committing or it tells you nothing.
- **gitleaks is not installed.** Install it, do not skip the gate:
  ```bash
  curl -sSL -o /tmp/gl.tar.gz https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/gitleaks_8.28.0_linux_x64.tar.gz
  cd /tmp && tar xzf gl.tar.gz gitleaks && mkdir -p ~/.local/bin && mv gitleaks ~/.local/bin/ && export PATH="$HOME/.local/bin:$PATH"
  ```
- **Re-derive the gate list, never trust a copy:**
  `grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml`

---

## 6. Environment facts you cannot infer from the code

### 6.1 Tests need Supabase env vars, or you get a misleading partial run

```bash
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
```
Without them `apps/web` fails three suites **and `pnpm -r` aborts before `apps/api` reports at all** —
so "3 web failures" is hiding the entire API suite.

**Matrix counts must hold: `rls` 381 · `hazmat_rls` 38 · `load-lifecycle` 61 · `duty-sessions` 25 ·
`efs-card-control-triggers` 17.** Mutation: `node scripts/mutation-check.mjs` → **18/18**.

> **`mutation-check.mjs` is NOT in `ci.yml`'s gate list.** It runs weekly and on pushes touching
> migrations, tests, API services and the script — so **a web-and-shared change slips under all four
> triggers**. This session moved a predicate and left `efs-fraud-stepup-exact-match` STALE at 17/18
> without noticing until later. **Run it by hand after any change to a rule.**

### 6.2 The card-status split is a security control, not a modelling choice

`card_lock` may write **Hold** and **Inactive** only. `card_unlock` is the only path to **Active**.
That is audit **P0-3**: `Active` in the lock schema was an unlock reachable through the lock route, so
a `lock`-only approver could reactivate a Fraud-held card while the audit row said `card.locked`.
**Any UI over card status must dispatch by the chosen value and gate Active on the `unlock` scope.**

### 6.3 RLS traps

- **`efs_card_mutations` has RLS enabled with NO POLICY.** A browser query returns an **empty list,
  not an error**. The API (service role) is its only reader. Copying `AuditPage.vue`'s
  direct-Supabase pattern here would have rendered as "no card has ever been changed".
- `audit_logs` IS client-readable (admin + auditor).

### 6.4 Migrations reach Supabase by merging, not by hand

`.github/workflows/migrate.yml` runs `supabase db push` on any push to `main` touching
`supabase/migrations/**`, gated on CI green. **Merging is what applies them.** Do not ask Miki for a
database password; `docs/33` told him to run it manually and that was wrong.

### 6.5 Two Railway settings still owed *(carried since Phase 5, still not done)*

- **`EFS_ROUTES_ENABLED=false` on `fleetguardweb`.** Nothing can detect this for you — the flag
  defaults true, so unset looks identical to a healthy API host.
- **Step 5.5 is unproven**: `cancel-in-progress: false` is merged but a single push could never have
  been cancelled. The verify is two pushes to `main` inside a minute.

### 6.6 QA and production are two orgs in ONE deployment

QA `07fe4058-cc72-4a69-b3e9-29b4cf1c6a44`, production `86d6b3ea…`.
**Never leave a QA card dirty** (rule 14): every live run ends with a revert and a proving re-read.
**Unset `EFS_CARD_CONTROL_PROBE_ENABLED` and redeploy** after any session that needed it (rule 15).

---

## 7. Open findings carried into Phase 7

| # | Finding | Where |
|---|---|---|
| A | **Phase 5 residuals:** the §1 ASSESS half of the containment walk was never timed; three of five built signals have never fired (`card_mutation_settled` × succeeded/failed/**sent**). `sent` is the most dangerous state and the hardest to stage | `docs/29` §6 |
| B | **The unknown-vendor-element digest is not built** (5.1's sixth signal). No "elements the product understands" set exists to subtract from. The element inventory is a prerequisite — **which is Phase 7 §7.3/7.6** | — |
| C | **This account never reports override scope.** `overrideAllLocations` false on all 35 QA and 234 production cards. `override_grant` stays correctly unpromotable | `docs/22` H2 |
| D | Production carries a deliberately untidy `card_lock = suspended` row (Phase 8 clears it through the application) | — |
| E | **40 production cards unlinked — a DATA ceiling, not a code one.** 29 lack a unit prompt, 5 have no `fuel_cards` counterpart | 7.7 |
| F | `pan_suffix` has never fired anywhere | 7.7 |
| G | **Phase 9–12 are blocked on WEX fixtures Miki must create by hand** — five QA cards do not exist: one at Hold, one `infoSource=CARD`, one `POLICY`, a second with limits, one with a time restriction | `docs/28` §14 |
| H | **The Settings Audit Log page cannot filter by card except via the deep link.** The `⋮` → "Change history…" link works; there is no card picker on the tab itself. Deliberate — a 200-card dropdown is worse than a search box — but say so if somebody asks | 6.7 |

---

## 8. Useful commands

```bash
# Session start
cd <repo> && git log --oneline -5 && git branch --show-current && git status --short
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
curl -sS "$HTTPS_PROXY/__agentproxy/status"      # is anything live reachable at all?
env | grep -c "^EFS_\|^SUPABASE_"                # 0 means no live work is possible

# Before touching UI
node scripts/ui-system-inventory.mjs --summary   # the adoption baseline you are moving
node scripts/check-file-size.mjs                 # 500-line cap is a CI gate

# Gates — commit FIRST, then lint:secrets
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm lint:secrets
node scripts/mutation-check.mjs                  # 18/18 — NOT in ci.yml, run it by hand

# The matrices
for m in rls hazmat_rls load-lifecycle duty-sessions efs-card-control-triggers; do
  node supabase/tests/$m.test.mjs | tail -1
done
```
