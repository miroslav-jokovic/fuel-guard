# Handoff — FuelGuard EFS card control, Phase 6

**Date:** 2026-08-16 · **Written for:** the next Claude Code session
**Repo:** `miroslav-jokovic/fuel-guard` (**PUBLIC**) · **Owner:** Miki (product manager, sole decision-maker)
**`main` at handoff:** `c08f3ef` · **Migrations applied to Supabase:** through **0197**

Supersedes `docs/33-HANDOFF-2026-08-16.md`, which stays as the Phase 5 record. Read this, then
`docs/28-EFS-EXECUTION-PLAN.md` §0 and §1, then only Phase 6.

---

## 1. Do Phase 6 next. It is the largest unbuilt thing and the part Miki sees

**Phase 5 is ✅ CLOSED** (PRs #62, #63, #64) with two residuals named in §6, not ticked away.

| Do this | Why it is first |
|---|---|
| **Phase 6 — Drawer shell** | Its precondition (Phase 3 ✅) holds, it needs **no vendor access, no WEX fixtures and no production risk**, and it is the only remaining phase a session with no live credentials can complete end to end. It is also the part Miki actually looks at, and Problem 3 from the original brief — *one button and one drawer per operation* — is still unbuilt |

**Why not the alternatives.** Phase 7's 7.8 is small but needs live EFS. Phase 8 is the first
production promotion and wants Phase 5's residuals settled first. Phases 9–12 are blocked on **WEX
fixtures Miki must create by hand** (`docs/28` §14 — five QA cards do not exist: one at Hold, one
`infoSource=CARD`, one `POLICY`, a second with limits, one with a time restriction).

---

## 2. ⚠️ Two blockers the plan does not mention. Read before writing any code

I surveyed the actual tree rather than trusting Phase 6's description. Two of its seven invariants
cannot be built as written.

### 2.1 Invariant 5 is not implementable as specified

> *"**Step-up predicted** via `preflightStepUp`, not discovered"*

**`preflightStepUp` is server-side and the web cannot import it.** It is a field on
`CapabilityBehaviour` (`apps/api/src/efs/types.ts:145`), invoked in `apps/api/src/efs/registry.ts:111`
during `accept()` — i.e. **during the POST that performs the write**, not before it. There is no
preflight endpoint: `FUEL_CARD_ROUTE_TABLE` has no such route.

Today the drawer **discovers** it, exactly as the invariant forbids —
`CardControlDrawer.vue:279`:

```ts
if (api?.code === "step_up_required") { stepUpFor.value = action; … }
```

Three ways out. **Pick deliberately and write down why**, because two of them are traps:

| option | verdict |
|---|---|
| Mirror the rule in the web view | ⛔ **A second implementation of a security rule.** Standing rule 5. The two copies disagree the first time `overrideGrant`'s threshold moves, and the failure is silent — a drawer that promises no step-up and then gets one |
| Add a preflight endpoint (`POST /preflight/:capability`) | Works, but it is a vendor-budget decision too: classify it in `FUEL_CARD_ROUTE_TABLE`, and `opensSoap: false` since it touches no credentials. Costs a round trip per keystroke unless debounced |
| **Move `preflightStepUp` into the shared contract** | **Recommended.** It is a pure function of the request body — no I/O, no credentials, no card. `packages/shared/src/efs/` is already browser-safe and already holds the contracts. Both the API behaviour and the web view then read ONE definition, which is the property the invariant is actually asking for |

The third is the smallest change that makes the invariant true rather than approximated. It is also
the only one where "predicted" and "enforced" cannot drift apart.

### 2.2 The five capability views are dead code — and consuming them IS Phase 6

`apps/web/src/features/fuelCards/capabilities/` holds `cardLock.view.ts`, `cardUnlock.view.ts`,
`overrideGrant.view.ts`, `overrideClear.view.ts`, `promptsSet.view.ts` and a `registry.ts`.
**Nothing imports any of them.** `grep -rn "capabilities/registry" apps/web/src` returns nothing.

Their own header says so, and the note is now stale:

> *"Nothing consumes these yet. Step 3.6 moves the per-intent confirmation builders out of
> `cardControlModel.ts` and into views; until then that file remains the source of the five
> confirmations the drawer renders."*

Phase 3 closed and `cardControlModel.ts` is still that source. So **Phase 6 is the step that makes
Phase 3's view layer real**, and the risk is the obvious one: build `CardOperationDrawer.vue` against
`cardControlModel.ts` because it is what the old drawer uses, and the views stay dead for another
phase. **Wire the registry first, then render from it.**

Delete the stale sentence from `capabilities/types.ts` when it stops being true.

---

## 3. What the ground actually looks like

Everything Phase 6's "reuse only" list names **exists** — I checked each one. Two are not where the
plan implies:

| component | where it really is |
|---|---|
| `SlideOver` | `apps/web/src/components/SlideOver.vue` — **not** in `packages/ui` |
| `DataTable` | `apps/web/src/components/ui/DataTable.vue` — **not** `packages/ui`'s `AppTable` |
| `StepUpPrompt`, `KebabMenu` | `apps/web/src/components/` |
| `AppButton`, `AppFormField`, `AppInput`, `AppCombobox` | `packages/ui/src/components/` |
| `BADGE_BASE`, `toneClass` | `apps/web/src/lib/badges.ts` |
| `useToastStore` | `apps/web/src/stores/toast.ts` |
| `EfsLocationPicker` | `apps/web/src/features/fuelCards/` |

Confirmed absent, as the plan says: **no `ConfirmDialog`, no `EmptyState`.** Do not invent them.

### File-size budget — the real constraint on this phase

`lint:filesize` caps a file at 500 lines and **it is a CI gate**.

| file | lines | note |
|---|---|---|
| `cardControlModel.ts` | **489 / 500** | **11 lines of headroom on the file Phase 6 must change.** Moving confirmations OUT to the views is what buys room; adding to it first will fail CI |
| `CardControlDrawer.vue` | 424 / 500 | deleted in Step 6.4 |
| `CardControlDrawer.test.ts` | 404 | assertions must be re-homed, not dropped (6.4) |
| `FuelCardsPage.vue` | 330 / 500 | gets a `KebabMenu` column in 6.3 |
| `FuelCardDetailPage.vue` | 174 / 500 | gets the Actions card in 6.3 |

The ordering that works: **6.1 builds the new drawer against the views → confirmations move out of
`cardControlModel.ts` (it shrinks) → 6.2 migrates operations → 6.4 deletes the old drawer.** Doing
6.2 before the model shrinks runs straight into the budget.

### The UI gate to watch

`pnpm lint:ui-adoption` (`scripts/ui-system-inventory.mjs --check`) is a CI gate and has been **red on
`main` before** (`docs/28` §0.4 records four gates missing from a hand-copied list, one of them this
one). It counts raw-element usage against adopted `App*` components. A hand-rolled `<button>` in the
new drawer will trip it. Run `node scripts/ui-system-inventory.mjs --summary` before you start so you
know the baseline you are moving.

---

## 4. Standing instructions from Miki — these persist

- **Push back.** *"in future push back on my ideas if you think they are not good."*
- **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that
  immediately, because if we dont do it we can forget."*
- **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type
  safe and enterprise grade."*
- **You decide the how.** He decides scope and anything touching his WEX account or production secrets.
- **PANs never enter the repo.** Reference cards by masked last four (`••••7671`).

### On merging — corrected 2026-08-16, and this is the one that wasted the most time

`docs/32` said *"He runs merges... Do not merge unasked."* I over-applied that and kept asking after
Miki had said *"run all commands"*. He pushed back twice. **The real rule: when he says run the
commands and finish it, that includes merging.** Do it.

**One reason to wait is legitimate, and only one:** `migrate.yml` is gated by `require-ci-green`, so
merging a red commit silently blocks migrations from reaching Supabase and the failure then looks
like a deploy problem. Wait for CI, then merge — do not ask.

### How migrations actually reach Supabase

**Not by hand.** `.github/workflows/migrate.yml` runs `supabase db push` on any push to `main`
touching `supabase/migrations/**`, using repo secrets, gated on CI green. **Merging is what applies
them.** Verified end to end on `7c6cfac`: the job linked, pushed, and reported `0196` and `0197` in
the ledger.

Do not ask Miki for a database password. `docs/33` told him to run `db push` manually and that was
wrong.

---

## 5. Environment facts a Phase 6 session needs

- **A remote container has NO live access.** No `SUPABASE_*`, no `EFS_*`, and the network policy
  answers **403 to CONNECT** for `*.up.railway.app` AND `*.supabase.co`. Check with
  `curl -sS "$HTTPS_PROXY/__agentproxy/status"` before planning anything live. **Phase 6 needs none
  of it** — that is the main reason it is next.
- **`pnpm test` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`**, not just `pnpm build`.
  Without them `apps/web` fails three suites AND `pnpm -r` aborts before `apps/api` reports at all,
  so a run that looks like "3 web failures" is hiding the entire API suite. Use CI's values:
  ```bash
  export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
  ```
- **`gitleaks` is not installed** — `pnpm lint:secrets` fails with "not installed", an environment gap
  and not a finding. Install it and run the gate properly, **after committing** (it scans
  `git archive HEAD`):
  ```bash
  curl -sSL -o /tmp/gl.tar.gz https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/gitleaks_8.28.0_linux_x64.tar.gz
  cd /tmp && tar xzf gl.tar.gz gitleaks && mkdir -p ~/.local/bin && mv gitleaks ~/.local/bin/
  export PATH="$HOME/.local/bin:$PATH"
  ```
- **A full Postgres 16 is available** at `/usr/lib/postgresql/16/bin` (run `initdb` as the `postgres`
  user, not root). Rarely needed — **PGlite is the repo's own harness** and applies every migration
  verbatim; see §7.
- **QA and production are two orgs in ONE deployment.** QA `07fe4058-cc72-4a69-b3e9-29b4cf1c6a44`,
  production `86d6b3ea…`.
- **Test matrix must be 381 / 38 / 61 / 25 / 17.** Mutation: `node scripts/mutation-check.mjs` → **18/18**.
- **Re-derive the CI gates, never trust a list:**
  `grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml`

---

## 6. Open findings

### A. Phase 5's two residuals — closed as a phase, NOT as work

1. **The §1 ASSESS half of the containment walk was never timed.** §2 CONTAIN is measured at
   **172 ms** on QA (2026-08-16, card ••••7671) and the re-enable is clean. What nobody has timed is
   how long it takes to establish blast radius before deciding to contain.
2. **Three of five built signals have never fired.** `promotion_state_changed` fired twice for real;
   `mirror_sweep_completed` was triggered by a live sync (job `0c8d316a…`) but **its log line was
   never read back**, so it is believed rather than seen. The three `card_mutation_settled` outcomes
   — `succeeded`, `failed`, `sent` — have not fired at all. **`sent` is the one worth effort:** the
   most dangerous state in the system, and the hardest to stage, because the write must land while
   the re-read fails.

Recipes for both are in `docs/29-EFS-INCIDENT-RUNBOOK.md` §6.

### B. Two Railway settings still owed

- **`EFS_ROUTES_ENABLED=false` on `fleetguardweb`.** Nothing can detect this for you — the flag
  defaults `true`, so unset looks identical to a healthy API host. Until it is set, the web host
  serves fuel-card routes WEX's firewall refuses, and Step 5.10's routing refusal never fires where
  it was built to fire.
- **Step 5.5 is unproven.** `cancel-in-progress: false` is merged and one run completed, but a single
  push could never have been cancelled. The Verify is two pushes to `main` inside a minute.

### C. The unknown-vendor-element digest is not built

5.1's sixth signal. No *"elements the product understands"* set exists to subtract from — only
`CARD_COLLECTIONS` and `VOLATILE_FIELDS`, neither of which is that. "Unknown" would have to be
invented, and a digest full of false unknowns trains people to ignore it. The element inventory is a
prerequisite feature. **Recorded rather than guessed.**

### D. Confirmed on QA 2026-08-16 — this account never reports override scope

The config scan over 35 QA cards: `overrideAllLocations` reads `false` on **all 35** and `true` on
none, matching 234 production cards. `override_grant` stays correctly unpromotable, and whether
`true` is *rejected* or merely *never at rest* still needs a proof run on `override_grant`.

Also from that scan, all clean: `nested:header` shape, 35/35 parsed, 0 mismatches, `prompts_set`
matching exactly on `validationType` and `infoId`, `card_lock.status` `unobserved` only because **no
QA card sits at Hold** — the Step 0.13 fixture gap, not a defect.

### E. Carried forward unchanged from `docs/32` and `docs/33`

Production's deliberately untidy `card_lock = suspended` row (Phase 8 clears it through the
application) · 40 production cards unlinked, a data ceiling not a code one · `pan_suffix` has never
fired anywhere · override state has no staleness signal (Step 7.8) · OEG-2b unobtainable, carried as
a named residual risk · **5.8 blocked until Step 7.1 runs**.

---

## 7. How to work here — earned, not theoretical

**The unit suites cannot reach a database trigger.** `apps/api` runs against a Supabase *fake*. If
you add a trigger, constraint or `security definer` function, it needs a matrix in `supabase/tests/`
— they run real migrations in PGlite and are auto-discovered by `scripts/run-tests.mjs`. Before
`efs-card-control-triggers.test.mjs` existed, 0196 and 0197 were "validated" only in the sense that
the RLS matrix applied them without error. **Applying is not behaving.**

**Ask what the broken code would score before believing a green run.** That matrix caught a false
pass *in itself* first: it compared `String(updated_at)`, and `String(new Date())` renders at SECOND
resolution, so every write in the same second compared equal. Three cases failed spuriously — and
three would have **passed against a trigger that did nothing at all**.

**A constraint is only as safe as your list of who writes the table.** Migration 0197's first draft
forbade any row leaving `pending` without an approver. `efsCardUnresolved.ts` condemns abandoned rows
straight to `failed` and they have no approver; since `uq_efs_card_mutations_one_pending` lets a stuck
`pending` row block every further mutation on that card, that draft would have **wedged cards
permanently**. `ledger.ts` is documented as "the only writer of `efs_card_mutations`" and is not.

**A step's prescribed change is a claim about the system, not a fact about it.** Step 5.7's fix was
inert alone — a `before update` trigger from 0091 re-stamped the column regardless — and would have
shipped with four new tests passing. Step 5.9 was filed "low severity, high tidiness" and turned 62
tests red. **Read what is actually there.**

**A "keep this in sync" comment is not a mechanism.** `check-waiver-growth.mjs` hand-named its victim
file, went stale twice, and because it is the `detect` command for a mutation — and `mutation-check`
runs `detect` only against mutated source, never a clean baseline — a probe that always failed
reported CAUGHT forever. **Derive, do not hand-list.** `run-tests.mjs` discovering the matrices is the
pattern.

**Verify a guard by breaking it, and count what goes red.** A prediction about the Step 5.6 mutation
was wrong: it turns exactly two tests red, not three. Right about the shape, wrong about the
mechanism — the same failure as Step 7.7's tier prediction.

**The rest, still true.** Run it, don't reason about it · reproduce before you fix · a mirror row only
says what EFS said at `detail_synced_at` · before opening a PR, re-read the diff as an adversary
(`as any`, `@ts-ignore`, `.skip(`, `.only(`, `eslint-disable`, `toBeTruthy()`; count deleted `expect(`
against added) · **`lint:secrets` scans `git archive HEAD` — run it AFTER committing.**

---

## 8. Useful commands

```bash
# Session start
cd <repo> && git log --oneline -5 && git branch --show-current && git status --short
export VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key
curl -sS "$HTTPS_PROXY/__agentproxy/status"        # is anything live reachable at all?

# Phase 6's own baselines, before touching a .vue
node scripts/ui-system-inventory.mjs --summary      # the adoption number you are moving
node scripts/check-file-size.mjs                    # cardControlModel.ts is at 489/500

# Gates, in the order that matters — commit first, then lint:secrets
pnpm lint && pnpm typecheck && pnpm test && pnpm lint:secrets
node scripts/mutation-check.mjs                     # expect 18/18
```

The one matrix worth running alone while iterating on schema:

```bash
node supabase/tests/efs-card-control-triggers.test.mjs
```
