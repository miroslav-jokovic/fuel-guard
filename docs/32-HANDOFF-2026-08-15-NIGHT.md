# Handoff — FuelGuard EFS card control
**Date:** 2026-08-15, night · **Written for:** the next Claude Code session
**Repo:** `miroslav-jokovic/fuel-guard` (**PUBLIC**) · **Owner:** Miki (product manager, sole decision-maker)
**`main` at handoff:** `4a7ab4a` · **Migrations applied:** through **0195**

Supersedes `docs/31-HANDOFF-2026-08-15-EVENING.md`, which stays for its history. Read this, then
`docs/28-EFS-EXECUTION-PLAN.md` §0 and §1.

---

## 1. Do Phase 5 next, complete. Here is why

**Phases 2, 3 and 4 are ✅ closed.** Phase 4 closed with **every exit-gate item observed live rather
than argued**, which is the first time that has been true of any phase here.

| Do this | Why it is first |
|---|---|
| **Phase 5 — Operational readiness, end to end** | The plan states it plainly: *"Must land before Phase 8 (the first production promotion)."* Its precondition was Phase 4 ✅, which became true tonight. It is the only phase that is **completely unblocked** — no WEX fixtures, no vendor dependency, no production risk — and it contains real filed defects, not just process work |

### Why not the alternatives

- **Phase 6 (drawer shell)** is the largest unbuilt thing and the part Miki actually sees, and it is a
  legitimate choice if he wants visible progress. But it is UI over capabilities that already work,
  and the phases it unblocks (9–12) are blocked on **WEX fixtures Miki has to create by hand**. So
  building it now buys less than it looks like it does.
- **Phase 8 (first production promotion)** cannot start: production has no proof run, no config scan,
  no document shape, no settings row and no entitlement. The gate correctly refuses — watched live
  twice tonight. Phase 5 is its stated precondition.
- **Phase 0 / Phase 1** are 🔶 for reasons that need **Miki at the WEX portal**, not code.

### What Phase 5 actually contains (read the phase before starting; this is orientation only)

**5.1 metrics and alerts** · **5.2 incident runbook** (`docs/29-EFS-INCIDENT-RUNBOOK.md`, new — walk
containment on QA and record timings) · **5.3 separation of duties** — `approved_by` exists in
migration 0177 and *nothing writes it* · **5.4** the `fuelCardsControl.test.ts` intermittent, twice
observed and never captured — **always redirect the run to a log** · **5.5** `mutation-check`
self-cancellation · **5.6 the vendor rate limiter is keyed on IP, not on the org it protects** — the
fix is hoisting `requireAuth`, **NOT** decoding a JWT in a `keyGenerator` · **5.7** `updated_at`
carries two events · **5.8** `account_id` is unverified free text that `credentialIdentityHash`
already consumes · **5.9** `env.X ?? <literal>` on keys that already carry a zod default · **5.10**
`deploy-verify` proves one of two hosts · **5.11** done.

**5.6 is the one with teeth.** A rate limiter keyed on IP means one org can exhaust the vendor budget
another org depends on, on a shared service account whose vendor guide warns about polling volume.

---

## 2. Standing instructions from Miki — these persist

- **Push back.** *"in future push back on my ideas if you think they are not good."*
- **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that
  immediately, because if we dont do it we can forget."*
- **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type
  safe and enterprise grade."*
- **You decide the how.** He decides scope and anything touching his WEX account or production
  secrets.
- **He runs merges, or tells you to.** On 2026-08-15 he said *"you can run all commands"* and then
  said *"merge #N"* for every single PR. **Do not merge unasked.**
- **PANs never enter the repo.** Reference cards by masked last four (`••••7671`).

### ⚠️ His uncommitted work is in the tree — LEAVE IT

At handoff the working tree carries **25 files that are Miki's**, confirmed by him twice:

- 23 modified design-system files (`packages/ui/tokens.css`, `badges.ts`, a dozen `.vue`, `DESIGN-SYSTEM.md`)
- untracked `docs/equipment-worksheet.csv`, `docs/DASHBOARD-VISUAL-RECONSTRUCTION.md`,
  `docs/ENTERPRISE-UI-RECONSTRUCTION.md`

**Check `git status` for his files BEFORE any command that moves HEAD.** A previous session destroyed
36 lines of his work with `git reset --hard` inside a fallback chain. Branch from `main`, stage
explicit paths, never `git add -A`.

---

## 3. What tonight proved about how to work here

### The product was in better shape than the tools interrogating it

**Every live drill found a defect, and every one was in the harness, never the product.** The gate
refused correctly, the idempotency check refused correctly, the promotion gate correctly declined to
re-enable an unproven capability, optimistic concurrency held. Before assuming a surprising result
means a broken system, check whether the instrument is the thing that is broken.

### Two predictions were right about the NUMBER and wrong about the MECHANISM

- Step 7.7: the pre-build simulation said the **unit** tier would resolve ~100 of 143 unlinked cards.
  It resolved **0**. The **PAN** tier resolved **103**. The headline would have matched either way.
- The refusal fix: predicted **two** refusals, yields **three**.

Both would have passed a headline check. Only per-row evidence — `fuel_card_link.method`, recorded
precisely because a total cannot answer "how" — caught the first. **A matching number is not
confirmation.**

### A test that passes against both the bug and the fix is worthless

Step 4.7's first draft did exactly that: a scripted vendor answers instantly, so "the whole call" and
"the verify window" differed only by a pause both included. An artificial 400 ms on the **write**
separated them. **Ask what the broken code would score before believing a green run.**

### When you make a dangerous action safe, you make safe whatever you were picturing

The suspension drill's safety was designed around the **card** — a stale `expectedVersion`, so a
failed suspension is still refused by optimistic concurrency and no write can land. Correct, and it
held. It was the wrong noun: nothing checked the **org**, so a production token pointed it at
production. **Ask what else the action selects, not only what it does.**

### The rest, carried forward and still true

- **Run it, don't reason about it.** Every defect fixed tonight was found by running something.
- **Reproduce before you fix.** Every fix has a test that failed first.
- **Verify a guard by breaking it.** Delete the line, watch the *right* test go red, restore.
- **A mirror row only tells you what EFS said at `detail_synced_at`.**
- **Before opening a PR, re-read the diff as an adversary:** grep for `as any` / `@ts-ignore` /
  `.skip(` / `.only(` / `eslint-disable` / `toBeTruthy()`; count deleted `expect(` against added.
- **`lint:secrets` scans `git archive HEAD` — run it AFTER committing**, or it has told you nothing.

---

## 4. Environment facts you cannot infer from the code

### Migrations

**Miki authorises `supabase db push`; this session he told me to run it and I did, twice.** Schema
first, then merge the code that depends on it. Applied tonight: **0194** (the credential-binding CHECK
constraint) and **0195** (`efs_cards.fuel_card_link`).

### The operator CLI — `scripts/efs.mjs`

```bash
node scripts/efs.mjs scan | echo-scan | sync | job [kind]
node scripts/efs.mjs write-check [--read-only]
node scripts/efs.mjs prove <capability>
node scripts/efs.mjs promote <capability> --proof <uuid> --reason "why" | --suspend --reason "why"
node scripts/efs.mjs suspend-drill --card <uuid> --proof <uuid> --expect-org <uuid>
```

**Every secret is prompted for and hidden.** Tokens and card numbers are never flags. `FG_TOKEN` is
honoured ONLY with `--token-from-env`.

- **`echo-scan` pages to the end itself**, retries a batch on a transient socket error, prints a
  resume offset when it cannot, and **names the org it scanned**.
- **`suspend-drill` requires `--expect-org`** and refuses if the token's real org differs. That guard
  exists because its absence suspended the wrong company.
- **Batch size is bound by the route's 60-second wall clock, not `--limit`** — 28–34 cards per call on
  this account, so `--limit` above ~34 is inert.

### Railway

Two services; **only `@fleetguard/api` can reach EFS**. `EFS_CARD_CONTROL_PROBE_ENABLED` and
`EFS_ALLOW_PRODUCTION_PROBE` are both **unset at handoff, which is correct**. Ask Miki before using
the CLI, and `grep` rather than dumping variables.

### The rest

- **QA and production are two orgs in ONE deployment.** `07fe4058…` = QA, `86d6b3ea…` = production.
- **`JOB_EXECUTION_MODE` defaults to `inprocess`** — there is no worker draining a queue, so a job row
  inserted by hand is never consumed. The card-sync scheduler runs every **24h**.
- **There is deliberately no "Refresh from EFS" button** (audit B6).
- **Test matrix must be 381 / 38 / 61 / 25.** Mutation: `node scripts/mutation-check.mjs --only=efs-` → 7/7.
- **CI gates — re-derive, never trust a list:** `grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml`
- Local-only failure that is NOT a finding: `pnpm build` needs `VITE_SUPABASE_*`.

---

## 5. Where the work stands

| Phase | Status |
|---|---|
| **0** | 🔶 Step 0.13 observed; the answer is a **USER DECISION** — QA cannot fill three of §0.6's six roles |
| **1** | 🔶 five live checks never run (foreign card → 404, step-up → 403, wrong password → `auth`, endpoint change → `endpoint_changed`, the 409 replay) |
| **2** | ✅ **CLOSED** — echo scan 197/197 across the whole live fleet |
| **3** | ✅ **CLOSED** |
| **4** | ✅ **CLOSED — every gate item observed live** |
| **5** | ⬜ **← DO THIS NEXT, COMPLETE** |
| **6** | ⬜ the largest unbuilt thing, and the part Miki sees |
| **7** | 🔶 7.7 done and proven live; **7.8 open** |
| **8–14** | ⬜ |

### Tonight's results, for the record

| | |
|---|---|
| Cards linked (production, live) | **54 → 157 of 197** — fuel attribution 27% → 80% |
| `sync_error = ambiguous_fuel_card_link` | **139 → 0** |
| Suspension propagation (QA) | **481 ms**, the very next call |
| Production echo scan | **197 / 197, 0 failed**, one uninterrupted run |
| Production refusal | watched twice; inert both times |

---

## 6. Open findings

### A. ⚠️ Production carries one deliberately untidy row

`efs_capability_promotions`: production `card_lock = suspended`, created by the suspension drill
pointing at the wrong org (`docs/22` H10).

**It is being kept on purpose.** It refuses **harder** than the `not_promoted` state it replaced,
production has zero settings rows and zero mutation rows so card control was never on there, and its
`reason` explains itself. **Phase 8 clears it through the application, with an audit trail. Do not
delete it with service-role access.**

### B. The override model is narrower than the vendor's *(unchanged)*

`overrideAllLocations` reads `false` on all 234 mirrored cards and `true` on none — this account does
not report override scope at all. `override_grant` is correctly unpromotable. Whether `true` is
*rejected* or merely *never at rest* can only be answered by a proof run on `override_grant`.

### C. 40 production cards remain unlinked — a DATA ceiling, not a code one

**29 carry no `unit_prompt`** (no tier below the PAN can reach them) and **5 have no `fuel_cards`
counterpart at all**. Each row now names its own blocker in `fuel_card_link`. Working that list is a
data task for the fleet, not an engineering one.

### D. `pan_suffix` has never fired, anywhere

Unit-tested only. It is the tier that would carry linking if EFS ever changed its card-number length —
so it gets exercised for the first time at exactly the moment it matters.

### E. Override state has no staleness signal *(Step 7.8, open)*

`EFS_CARD_SYNC_HOURS` defaults to 24 and the badge renders the mirror. Production ••••7550 showed
`Override: 1 use left` for nine hours after EFS retired it.

### F. OEG-2b is unobtainable through the capability model

Left **null** and carried as a named residual risk rather than faked.

### G. Everything else, already numbered

Steps **5.4–5.10** (see §1), **7.5** (mirror fixes), **7.8**.

**Problem 3 from the original brief — one button and one drawer per operation — is still unbuilt.**
Phase 6.

---

## 7. The pattern to keep watching

**A check and the thing it checks, built from different sources of truth.** Nine instances now: the
echo guard, `editsLanded`, element order, the rate limiter, optimistic locking, the fraud step-up,
`intentLanded`, card identity — and now **the suspension drill's org**, which was not checked against
anything at all.

**And its sibling: one column, two meanings.** `sync_error` (linking vs syncing — **the linking half
is now fixed**), `updated_at`, `apply_latency_ms` (**fixed**), `drift`. When you find one, look for
the others.

**A third, earned tonight: a claim in a comment is not a measurement.** `promotionBlock`'s
"deliberately uncached, and that is the feature" was true and unmeasured for weeks. It is now 481 ms.
The plan's own "the check is scripted" was simply false. **Where a document asserts a fact about
behaviour, go and run it.**

---

## 8. Useful commands

Session start:

```bash
cd <repo> && git log --oneline -5 && git branch --show-current && git status --short
pnpm verify:live && node scripts/check-file-size.mjs
```

Deployed commit on both hosts:

```bash
for h in fleetguardweb-production fleetguardapi-production; do printf "%-26s " "$h"; curl -sS --max-time 20 "https://$h.up.railway.app/healthz" | jq -c '{status,commit}'; done
```

The Phase 2 gate, re-runnable by a stranger in one command:

```bash
pnpm check:card-binding
```

Gates, in the order that matters — **commit first, then `lint:secrets`**:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm lint:secrets
node scripts/mutation-check.mjs --only=efs-
```
