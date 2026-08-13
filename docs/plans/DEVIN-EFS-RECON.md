# Devin task — EFS card control: repository reconnaissance

## What this is

A **read-only survey**. We have an execution plan (`docs/28-EFS-EXECUTION-PLAN.md`) whose Phase 0 depends on facts about this repo that we have not verified from inside it. Your job is to run the checks below and report exactly what you find.

## Hard rules

1. **Change nothing.** No fixes, no refactors, no formatting, no dependency updates.
2. **Do not make a failing gate pass.** If `lint:filesize` is red, report it red. **Do not add a waiver, raise a pin, add `.skip`, loosen a regex, or delete an assertion.** A red gate is the finding.
3. **Do not guess.** If a command errors or a file is missing, report the error verbatim. "Not found" is a valid, useful answer.
4. **Paste real output.** Every result must include the actual command and its actual output (tail is fine for long output). Do not summarise a command you did not run.
5. The only file you may create is the report itself.

## Deliverable

Write `docs/EFS-RECON-REPORT.md` using the template at the end of this document. Commit it on a branch named `recon/efs-baseline` and push. Do not open a PR against `main`.

---

## A. Standing gates

Run each **separately** so one failure does not hide the others. Record pass/fail and the output tail for any failure.

```bash
pnpm install --frozen-lockfile
pnpm --filter @fuelguard/shared build:rn

pnpm lint
pnpm lint:filesize
pnpm lint:funcsize
pnpm lint:migrations
pnpm lint:boundaries
pnpm lint:tests
pnpm lint:upserts
pnpm lint:tokens-parity
pnpm lint:secrets
pnpm typecheck
pnpm test
pnpm build
```

For `pnpm test`, report the four matrix counts. Expected: `rls` **179** · `hazmat_rls` **16** · `load-lifecycle` **54** · `duty-sessions` **20**. Any difference is a finding.

For `pnpm lint:filesize`, paste the **full** list of files over budget and any waiver that grew past its pin.

---

## B. CI wiring

Read every file in `.github/workflows/` and report:

1. Each workflow: filename, trigger (`on:`), and the ordered list of steps/scripts it runs.
2. **Does any workflow declare `needs:` or `workflow_run:`?** Run and paste:
   ```bash
   grep -rn "needs:\|workflow_run:" .github/workflows/ || echo "NO EDGES FOUND"
   ```
3. **Which of the standing gates in section A actually run in CI?** Produce a table: gate → runs in CI (yes/no) → in which workflow.
4. Does `migrate.yml` (or equivalent) run `supabase db push`, and on what trigger?
5. Is `pnpm verify:live` run anywhere — CI, a deploy hook, or nowhere?

---

## C. Fitness functions — which exist, which are wired

For each script below: does the file exist, and is it referenced by `package.json`, by CI, or by nothing?

```bash
ls -la scripts/
grep -rn "check-rls" package.json .github/ scripts/ || echo "check-rls: NO REFERENCES"
grep -rn "lint:codegen" .github/ || echo "lint:codegen: NOT IN CI"
grep -rn "mutation:check" .github/ || echo "mutation:check: NOT IN CI"
ls -la .gitleaks.toml 2>&1
```

Report as a table: script → exists → referenced by → runs in CI.

---

## D. Four specific claims to verify

These are load-bearing for the plan. Verify each and report **CONFIRMED** or **REFUTED** with evidence.

### D1 — Does `routeAuth.test.ts` discover `/api/fuel-cards`?

```bash
node -e '
const fs=require("fs");
const src=fs.readFileSync("apps/api/src/app.ts","utf8");
const t=fs.readFileSync("apps/api/src/routeAuth.test.ts","utf8");
const m=t.match(/const re = (\/.*\/[gimsuy]*);/);
console.log("regex:", m ? m[1] : "NOT FOUND");
const body=m[1].slice(1, m[1].lastIndexOf("/"));
const found=[...src.matchAll(new RegExp(body,"g"))].map(x=>x[1]);
console.log("discovered count:", found.length);
console.log("discovered:", found);
console.log("fuel-cards discovered?", found.includes("/api/fuel-cards"));
'
```

Also paste the exact line in `apps/api/src/app.ts` that mounts `/api/fuel-cards`.

### D2 — Does the comment at `efsCardEdits.ts` name a test that exists?

```bash
sed -n '145,160p' apps/api/src/services/efsCardEdits.ts
grep -cin "nest" apps/api/src/services/efsCardEdits.test.ts
grep -n "it(" apps/api/src/services/efsCardEdits.test.ts | wc -l
```

Report whether a test with a nested-child record exists.

### D3 — What does `lint:boundaries` actually cover?

Read `scripts/check-feature-boundaries.mjs` and report:
- Which directories it scans
- **Does it inspect `apps/api/src` at all?** Quote the relevant lines.

### D4 — Does `lint:funcsize` exclude routes?

Read `scripts/check-function-size.mjs` and report:
- The `MAX` value and the full `GRANDFATHERED` map
- Which paths are excluded from scanning. Quote the filter line.

---

## E. Schema and deployment state

```bash
ls supabase/migrations/ | tail -20
ls supabase/migrations/ | wc -l
cat docs/MIGRATION-DISCIPLINE.md
pnpm verify:live   # if it needs credentials you do not have, report that
```

Report: the highest migration number on disk · the count of files · any gaps in the numbering · what `verify:live` says about deployed HEAD, `schema.applied`, `state`, `drift`, `ok` (or that you could not run it).

---

## F. Card-control file sizes

```bash
for f in \
  apps/api/src/routes/fuelCards/control.ts \
  apps/api/src/services/efsCardControl.ts \
  apps/api/src/services/efsCardEdits.ts \
  apps/api/src/lib/efsCardEcho.ts \
  apps/api/src/lib/efsCardXml.ts \
  apps/api/src/lib/efsCardOps.ts \
  apps/api/src/lib/efsCardWrite.ts \
  apps/api/src/lib/efsCardCanonical.ts \
  apps/api/src/lib/efsSoapSession.ts \
  apps/api/src/routes/fuelCards/experiments.ts \
  apps/api/src/routes/fuelCards/writeProbe.ts \
  apps/api/src/services/efsCardUnresolved.ts \
  apps/api/src/services/efsCardMirror.ts \
  packages/shared/src/cardControlContract.ts \
  packages/shared/src/efsCardCatalog.ts \
  apps/web/src/features/fuelCards/cardControlModel.ts \
  apps/web/src/features/fuelCards/CardControlDrawer.vue \
  apps/web/src/features/fuelCards/useCardControl.ts ; do
  printf "%5s  %s\n" "$(wc -l < "$f" 2>/dev/null || echo "MISSING")" "$f"
done | sort -rn
```

Also list every card-control test file and its line count:
```bash
find apps/api/src apps/web/src packages/shared/src -name "*.test.ts" | xargs grep -l -i "card\|efs" | xargs wc -l | sort -rn
```

---

## G. Mutation testing baseline

```bash
grep -n "mutation" package.json
sed -n '1,40p' scripts/mutation-check.mjs
```

Report what it targets today and whether it can be pointed at a specific directory. **Do not run it** unless it completes in under 15 minutes; if you do run it, report the score.

---

## H. Environment (optional — skip if you lack access)

Report which of these are set in the **deployed** environment, and their values where not secret:

`EFS_SOAP_ENABLED` · `EFS_SOAP_ENVIRONMENT` · `EFS_SOAP_ENDPOINT_URL` (host only) · `EFS_CARD_CONTROL_ENABLED` · **`EFS_CARD_CONTROL_PROBE_ENABLED`** · `EFS_CARD_DELETE_OVERRIDE_ENABLED` · `EFS_CARD_SYNC_MAX_DETAIL` · `EFS_CARD_MAX_MUTATIONS_PER_HOUR` · `EFS_SOAP_EGRESS_PROXY_URL` (set/unset only)

**`EFS_CARD_CONTROL_PROBE_ENABLED` being `true` on a deployed environment is a finding — report it prominently.**

Do **not** set, unset or change any variable.

---

## Report template

Copy this into `docs/EFS-RECON-REPORT.md` and fill it in.

```markdown
# EFS card control — recon report
Date: YYYY-MM-DD
Commit: <git rev-parse HEAD>
Branch: <branch>

## Summary
- Gates passing: N of 12
- Gates failing: <list>
- Claims CONFIRMED: <D1..D4>
- Claims REFUTED: <D1..D4>
- Anything alarming: <one line, or "none">

## A. Standing gates
| Gate | Result | Notes |
|---|---|---|
| lint | | |
| lint:filesize | | |
| ... | | |

Matrix counts: rls __ / hazmat_rls __ / load-lifecycle __ / duty-sessions __
(expected 179 / 16 / 54 / 20)

### Failure output
<paste the tail of every failing gate>

## B. CI wiring
<workflows, triggers, the needs:/workflow_run: result, the gate→CI table,
 db push trigger, verify:live>

## C. Fitness functions
| Script | Exists | Referenced by | Runs in CI |
|---|---|---|---|

## D. Claims
### D1 routeAuth discovery — CONFIRMED / REFUTED
<paste output>
### D2 comment claim — CONFIRMED / REFUTED
<paste output>
### D3 lint:boundaries coverage
<quote the scanned directories>
### D4 lint:funcsize scope
<MAX, GRANDFATHERED, the exclusion filter line>

## E. Schema state
<highest migration, count, gaps, verify:live output>

## F. File sizes
<the sorted list, and the test file list>

## G. Mutation testing
<what it targets, whether it can be scoped, score if run>

## H. Environment
<the variable table, or "no access">

## Anything else you noticed
<free text — surprises, dead code, contradictions between docs and reality>
```

---

## When you are done

Push `recon/efs-baseline` and reply with the **Summary** section pasted inline. Do not open a PR and do not merge.
