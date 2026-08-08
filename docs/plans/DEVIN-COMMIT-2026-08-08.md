# Devin — commit F-H1

**Everything else in this file's earlier version is already done.** Recorded here so nobody re-runs it:

- `wip/driver-design-system-2` (`fce5f2e`) and the four backend commits `18d8251`, `c2a84e1`,
  `8cffdf9`, `0099e7b` are on `main` and pushed.
- The gitignore rule for `apps/driver/modules/capture-native/android/.gradle/` was already on `main`
  as `c71160f`; the extra commit that version asked for was redundant.
- Migrations `0146`–`0148` applied. `GET /api/version` reports `commit f191dbc`, `schema.applied
  0148`, `state current`, `ok true`.

**One deviation to flag, not to undo.** `f191dbc` merged `wip/driver-design-system-2` into `main`;
the runbook said to push that branch and leave it unmerged, because it is in-progress work. It is
live now. Nothing is broken — the gate is green and the deploy is healthy — but Miki should know his
in-flight design rework is on `main` rather than parked on a branch. Do not revert it without asking.

---

## The one commit left — F-H1

Six files are uncommitted. All of them are F-H1.

```bash
cd ~/Projects/FuelGuard
git switch main && git pull --ff-only
git status --porcelain
```

Expect exactly these, and nothing else:

```
 M apps/api/src/services/qualification.ts
 M apps/web/src/pages/CompliancePage.vue
 M docs/plans/DEVIN-COMMIT-2026-08-08.md
 M docs/plans/hazmat-consolidation/HAZMAT-IA-PLAN.md
 M packages/shared/src/qualificationGate.ts
?? packages/shared/src/qualificationGate.test.ts
```

If a stale `.git/index.lock` blocks you, delete it — one keeps reappearing from a concurrent git
process, and Cowork can only move files on this machine, not unlink them. Check `_to_delete/` for the
ones it has already moved aside.

### Run the gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn

pnpm lint && pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:migrations
pnpm lint:boundaries && pnpm lint:tokens-parity && pnpm --filter @fuelguard/web lint:tokens
pnpm typecheck
pnpm test
pnpm build
```

Expected matrix counts, unchanged by this commit:
**rls 179 · hazmat_rls 16 · load-lifecycle 54 · duty-sessions 20.**

`pnpm test` is the one that matters. `packages/shared/src/qualificationGate.test.ts` is new — 22
assertions — and vitest cannot run in the Cowork sandbox, so this is its first real execution. The
logic behind all 22 was verified by compiling the module and asserting against plain node, but that
is not the same as running the suite. If it is red, report the failure; do not edit the assertions.

### Commit and push

```bash
git add packages/shared/src/qualificationGate.ts \
        packages/shared/src/qualificationGate.test.ts \
        apps/api/src/services/qualification.ts \
        apps/web/src/pages/CompliancePage.vue \
        docs/plans/hazmat-consolidation/HAZMAT-IA-PLAN.md \
        docs/plans/DEVIN-COMMIT-2026-08-08.md

git commit -m "Tell an unstarted qualification file apart from an incomplete one

An empty certifications table produced seven driver findings and two org
findings that all restated one fact: nobody has filed anything yet. On a
fleet's first day that is every driver, and a roster of red rows that all mean
the same thing is how a real disqualification later gets scrolled past.

qualifyDriver and qualifyOrg now return a state, and with zero certifications
the findings collapse to one that names what the file needs. This is not a
softening: qualified stays false and the codes keep the driver_unqualified:
prefix that makes a finding unclearable — asserted explicitly, because that is
the property most likely to be broken by accident later.

Employment status survives the collapse; a terminated driver is disqualified
whether or not anyone started their file. The roster badge for not-started is
neutral rather than red, and the filter gained a Not started option.

Adds qualificationGate.ts's first test file: 22 assertions, covering the
10.4/10.5 predicates that had never been tested directly."

git push origin main
```

No migration in this commit, so no Supabase workflow fires. Railway will redeploy; confirm with:

```bash
pnpm verify:live
```

`commit` must equal `git rev-parse HEAD`, `schema.applied` stays **0148**, `ok` **true**.

---

## Then clean the tree

```bash
rm -rf _to_delete
git status --porcelain
```

`_to_delete/` holds scratch files Cowork moved aside rather than deleted — patch scripts, two debug
harnesses, a compiled-module verification directory, and one or more stale `index.lock` files.
Nothing in it is tracked.

---

## Report

1. Full `pnpm test` output, especially `qualificationGate.test.ts` and the four matrix counts.
2. `pnpm verify:live` after the push.
3. Confirm `_to_delete/` is gone and `git status` is clean.
4. Whether `wip/driver-design-system-2` should stay on `origin` now that it is merged — ask Miki, do
   not delete it on your own.
