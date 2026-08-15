# Handoff — FuelGuard EFS card control
**Date:** 2026-08-15, evening · **Written for:** the next Claude Code session
**Repo:** `miroslav-jokovic/fuel-guard` (**PUBLIC**) · **Owner:** Miki (product manager, sole decision-maker)
**`main` at handoff:** `f204a92` · **Open PRs:** #49 (Miki's worksheet script)

Supersedes `docs/30-HANDOFF-2026-08-15.md`, which stays for its history — its §6 findings are still
the reference for anything it marked open. Read this, then `docs/28-EFS-EXECUTION-PLAN.md` §0 and §1.

---

## 1. Start here — the order, and why it is this order

**Phase 3 closed. Phase 4 is built end to end and has run against the real vendor. Phase 2 went
RED.** That last one is the reason the order below is not "carry on with Phase 5".

| # | Do this | Why it is here and not later |
|---|---|---|
| **1** | **Step 2.6 — the credential-identity binding is inert** | Phase 2's exit gate FAILS. The one org with card control has `write_entitlement = 'confirmed'` and a null `probed_identity_hash`, and `efsCardControlAccess.ts` **grandfathers** it: logs one warning, allows the write. The guard that stops a QA-confirmed entitlement being exercised against a repointed credential is switched off for 100% of the orgs it governs |
| **2** | **Close Phase 4's exit gate** — the production refusal, suspension propagation, the echo-scan re-run | All three are observational and none needs new code. The production refusal is the one that matters: **a block is the system working**, and nobody has watched it block |
| **3** | **Step 7.7 — card identity** | The largest *business* problem in the plan. 182 of 234 production cards are unlinked and 50 last-4 groups hold more than one card, so fuel attribution runs on a minority of the fleet |
| **4** | **Step 4.7, then Phase 5** | 4.7 is small and it makes every future proof's latency number meaningful |

### Two things deliberately NOT at the top

- **Do not promote anything on production.** No production org has a settings row, a proof, or a
  recorded document shape. The gate will refuse, which is correct — the point of running it is to
  *watch it refuse*, not to get past it.
- **Do not "fix" Phase 2 by deleting the grandfather clause first.** Order matters and is written
  into Step 2.6: re-probe QA so the hash is populated, THEN delete the clause. The reverse revokes
  QA card control and blocks everything else.

---

## 2. Standing instructions from Miki — these persist

- **Push back.** *"in future push back on my ideas if you think they are not good."* He means it.
  Today he asked for the password prompt to be removed; pushing back with the reason (it is a route
  guard, not a CLI choice) was the right call and he accepted the outcome.
- **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that
  immediately, because if we dont do it we can forget."*
- **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type
  safe and enterprise grade."*
- **You decide the how.** He decides scope and anything touching his WEX account or production
  secrets. On 2026-08-15 he said *"you are product manager so proceed with what is best"* — that is
  standing authority for engineering judgement, **not** for merging or for production config.
- **He runs merges, or tells you to.** He has said "merge #N" every time. Do not merge unasked.
- **PANs never enter the repo.** Reference cards by masked last four (`••••7671`).

### Working style
He merges fast and in sequence. Keep PRs single-purpose. Every PR body leads with the defect, names
any deviation from the plan, and says what you could NOT verify — that last section has repeatedly
been the most useful part.

---

## 3. How to work — read this before writing code

### The two lessons this build keeps re-teaching

**Offline verification cannot prove the vendor agrees.** Phase 3 was verified byte-for-byte and was
structurally blind to the override defect, because every test scripts its own after-document.

**And its mirror image, learned the hard way on 2026-08-15:** a stored row is not vendor truth
either. §6.E was mis-diagnosed for an hour because `detail_synced_at` post-dated `last_used_date`,
which felt like proof the mirror was current — until a transaction arrived 38 minutes after that
sync. **A mirror row only ever tells you what EFS said at `detail_synced_at`.**

### The rest, carried forward and still true

- **Run it, don't reason about it.** Every defect fixed in Phases 3 and 4 was found by running
  something.
- **Reproduce before you fix.** Every defect has a test that failed first.
- **Verify a guard by breaking it.** Delete the line, watch the right test go red, restore.
- **Reusing a helper gets you all of its behaviours, not the one you wanted.** Twice this session:
  `finalizeUnverified` was written for "the read failed" and Step 3.11 routed "read fine, cannot
  judge" into it, losing `after_document`; and the config scanner's `parseXml` THROWS rather than
  returning null, which would have aborted a whole scan on one bad row.
- **Before opening a PR, re-read the diff as an adversary:** grep for `as any` / `@ts-ignore` /
  `.skip(` / `.only(` / `eslint-disable` / `toBeTruthy()`; count deleted `expect(` against added.
- **`git add -A` is the wrong tool on this tree.** Stage explicit paths.

### ⚠️ Two git mistakes I made today. Do not repeat them.

- **`git reset --hard` inside a fallback chain.** I wrote
  `git reset --hard origin/main || git pull --ff-only` to "realign whichever way works". The
  fallback made it feel safe; the first branch ran and silently dropped 36 uncommitted lines of
  Miki's work. **Recovered only because an earlier stash had been APPLIED rather than popped.**
  Check `git status` for his files BEFORE any command that moves HEAD.
- **Repeating stale observations.** I told Miki three times there were "~15 uncommitted web files".
  They had been committed hours earlier as `b3f21b4`, exactly as my own stash note said to verify.
  Re-check before repeating a claim about the tree.

---

## 4. Environment facts you cannot infer from the code

### Migrations reach Supabase by `supabase db push`

**Miki runs it.** `migrate.yml` also applies migrations on merge to `main` gated by
`require-ci-green`, and **never dispatch that by hand** — but in practice this session he pushed
0193 himself before asking for the merge, which is the safe order: schema first, then the code that
depends on it.

Migrations added 2026-08-15: **0191** (proofs + promotions + `observed_*` on settings), **0192**
(`proof_run_id` on the mutation ledger), **0193** (backfill the five live capabilities as `enabled`).

### Railway — the CLI syntax that actually works on v5.23.3

Two services, and **only `@fleetguard/api` can reach EFS**:

```bash
railway status --json | jq -r '.services.edges[]?.node.name'
railway variables --service "@fleetguard/api" --kv | grep -E "^SOME_KEY="   # grep! never dump
railway variables --service "@fleetguard/api" --set "KEY=value"
railway variable  delete KEY --service "@fleetguard/api"     # singular "variable", no --yes
```

Setting or deleting a variable triggers a redeploy. **Ask Miki before using the CLI** — it injects
production secrets locally, and always `grep` rather than printing the whole variable list.

### The probe flag lifecycle (standing rule 15)

`EFS_CARD_CONTROL_PROBE_ENABLED` gates `/write-check` and `/prove`. It is **unset** at handoff, which
is its correct resting state. Enable it for a run, then delete it and let the redeploy land.
`EFS_ALLOW_PRODUCTION_PROBE` is a **separate** flag, also unset, and `assertProbeAllowed` fails
closed — so enabling the probe flag alone leaves production refused. Verify that before enabling.

### The operator CLI — `scripts/efs.mjs`

```bash
node scripts/efs.mjs scan                    # prompts: token
node scripts/efs.mjs prove card_lock         # prompts: token, password, card number
node scripts/efs.mjs promote card_lock --proof <uuid> --reason "why"
node scripts/efs.mjs promote card_lock --suspend --reason "why"
```

**Every secret is prompted for, hidden, and refuses to fall back to an echoing read.** Neither the
token nor a card number may be an argument — a flag lands in shell history and the process table.
`FG_TOKEN` is honoured ONLY with `--token-from-env`, because an implicitly-read stale export silently
shadowed the prompt and failed as "Invalid or expired token", which reads like a vendor problem.

### ⚠️ `lint:secrets` scans `git archive HEAD` — run it AFTER committing

Tracked content at HEAD, nothing else — deliberate, so the file set is identical locally and in CI.
The consequence cost a red CI run today: **running the gate sweep before committing scans a HEAD
without your new files and passes for that reason.** Recorded in §0.4.

### The rest

- **QA and production are two orgs in ONE deployment.** `07fe4058…` = sandbox/QA,
  `86d6b3ea…` = production (199 cards). Anything you ship reaches production.
- **The WSDL is checked in** at `docs/efs/CardManagementWS.wsdl` and is authoritative.
- **A local Postgres runs on this machine.** Validate a migration against a scratch DB before
  merging — that is how 0190, 0191 and 0192 were checked, including exercising every constraint
  rather than only that the DDL parses.
- **Test matrix must be 381 / 38 / 61 / 25.** Re-baselined from 377 on 2026-08-15: migration 0191
  adds two tables and the sweep generates a leak test and an anon-lockout test per table.
- **Mutation harness: `node scripts/mutation-check.mjs --only=efs-` → 7/7.**
- **CI gates — re-derive, never trust a list:**
  ```bash
  grep -oE "run: pnpm [a-z:@/ -]+" .github/workflows/ci.yml | sed 's/run: //'
  ```
- Local-only failure that is NOT a finding: `pnpm build` needs `VITE_SUPABASE_*`.

---

## 5. Where the work stands

| Phase | Status |
|---|---|
| **0** | 🔶 Step 0.13 (QA card roles) outstanding — blocks Phases 9 and 10. **Step 0.14 closed 2026-08-15** |
| **1** | 🔶 code merged; five live checks never run (foreign-card probe → 404, step-up → 403, wrong password → `auth`, endpoint change → `endpoint_changed`, the 409 replay) |
| **2** | ⛔ **exit gate FAILS — Step 2.6.** See §1 |
| **3** | ✅ **closed 2026-08-15.** All five operations verified live; card returned byte-identical by version hash |
| **4** | 🔶 **built end to end, proven and promoted live.** Exit gate has three observational items left plus Step 4.7 |
| **5–14** | ⬜ Steps 5.4–5.10, 7.5, 7.7, 7.8 filed with owners |

### What Phase 4 actually produced

Six steps, migrations 0191–0193, and a chain that runs: **config scanner** (raw wire text, no vendor
calls, `docs/efs/config-scan-*.json` committed) → **local harness** (replay any capability's bytes
offline) → **live prover** (OEG against a real card, through production's own orchestrator) →
**promotion gate** (refuses by default, lists every reason).

**Live results, 2026-08-15:** proof `40b88b75` on QA ••••7671 → `proven`; `card_lock` → `enabled`
citing it. Verified from the database: promotion row, one audit row with a uuid `entity_id`, both
residual risks in `meta`, two ledger rows carrying `proof_run_id`, card back to ACTIVE.

---

## 6. Open findings

### A. ⛔ Phase 2's exit gate fails — the credential binding is inert *(Step 2.6)*

One row in `efs_card_control_settings`: QA org, `enabled`, `write_entitlement = 'confirmed'`,
`probed_identity_hash` **NULL**, probed 2026-08-11 (before migration 0187 existed). Production has no
row at all — so that is **100% of the orgs card control governs**.

`efsCardControlAccess.ts` compares the current credential identity against the stored hash and
returns `endpoint_changed` on a mismatch. A null takes the grandfather branch: one warning, write
allowed. 0187 called it "temporarily grandfathered"; the temporary outlived the migration.

**Fix order is load-bearing** — re-probe QA first (needs the probe flag and a deploy), delete the
grandfather clause second.

### B. The override model is narrower than the vendor's *(unchanged — see `docs/30` §6.B)*

Still the scoping decision before Phases 10, 11 and 14.2. **Phase 4.4 gave it evidence:**
`overrideAllLocations` reads `false` on all 234 mirrored cards in both orgs and `true` on none, so
`override_grant` is correctly **unpromotable** and its `judge` correctly returns `indeterminate`.
What the config scanner cannot answer is whether `true` is *rejected* or merely *never at rest* —
only a proof run on `override_grant` can, and one has not been run.

### C. Card identity — last-4 is not one *(Step 7.7, the biggest business impact)*

50 last-4 groups hold more than one card; 140 rows carry `ambiguous_fuel_card_link`; **182 of 234
cards are unlinked**. Fuel attribution runs on a minority of the fleet. `••••7550` alone is four
distinct cards.

### D. Override state has no staleness signal *(Step 7.8)*

`EFS_CARD_SYNC_HOURS` defaults to 24 and the badge renders the mirror. Production ••••7550 showed
`Override: 1 use left` for nine hours after EFS retired it. Tolerable for `status`; not for the
number that says whether a driver can take another free tank.

### E. `apply_latency_ms` measures the wrong interval *(Step 4.7)*

The first live proof recorded **4562 ms** against a documented ~533 ms baseline. The harness times
the whole `executeCapability` call — planning read, write, first re-read, the 3-second second look,
second re-read. The arithmetic incidentally proves the first re-read MISSED and the second caught it.
Migration 0191 documents the column as "from dispatch to the first re-read that saw the change".

### F. OEG-2b is unobtainable through the capability model

"cardVersion unchanged after a NO-OP dispatch" needs a `setCardv2` with zero edits, and every
capability produces edits by construction. Left **null** and carried as a named residual risk rather
than faked. If it is ever wanted, it needs a dispatch primitive the registry deliberately does not
offer — decide whether that is worth having before building it.

### G. Everything else, already numbered

Steps **5.4** (test intermittent, twice observed and never captured — always redirect the run to a
log), **5.5** (`mutation-check` self-cancellation), **5.6** (vendor rate limiter keyed on IP, not
org — the fix is hoisting `requireAuth`, NOT decoding a JWT in a `keyGenerator`), **5.7**
(`updated_at` carries two events), **5.8** (`account_id` is unverified free text that
`credentialIdentityHash` already consumes), **5.9** (`env.X ?? literal`), **5.10** (`deploy-verify`
proves one of two hosts), **7.5** (mirror fixes).

**Problem 3 from the original brief — one button and one drawer per operation — is still unbuilt.**
Phase 6. It remains the largest unbuilt thing in this plan and the part Miki actually sees.

---

## 7. The pattern to keep watching

**A check and the thing it checks, built from different sources of truth.** Eight instances so far:
the echo guard, `editsLanded`, element order, the rate limiter, optimistic locking, the fraud
step-up, `intentLanded` on an override — and now **card identity**, which resolves *silently* rather
than permissively or pessimistically, which is why it sat in production unnoticed.

**And its sibling: one column, two meanings.** `sync_error` (linking vs syncing), `updated_at` (poll
vs rotation), `apply_latency_ms` (two different intervals), `drift` (nearly — the inverse fact was
deliberately kept OFF it). When you find one, look for the others.

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

Read the card-control database directly (read-only, follows the repo's diagnostic-script pattern):

```bash
node scripts/override-ledger-diagnose.mjs
```

Regenerate the config-scan artefacts from the mirror, no vendor calls:

```bash
pnpm --filter @fuelguard/api exec tsx src/scripts/runConfigScan.ts
```

Gates, in the order that matters — **commit first, then run `lint:secrets`**:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm lint:secrets
node scripts/mutation-check.mjs --only=efs-
```
