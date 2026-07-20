# Phase 7 — Single Source of Truth + Codegen (consistency layer)

The original vision was a YAML single source of truth with generators. This phase **proves that pattern
on one module** — the anomaly rule catalog — with a working generator, a drift guard, and full behavior
preservation, so it can be extended to the next module with confidence rather than as a leap.

Business logic stays hand-authored. Codegen only owns the derived **data and types** that were previously
kept in sync by hand across files.

## What was scattered before

A single rule's static spec lived in three places that had to be edited together and could silently drift:

- `ids.ts` — `RULE_IDS` (+ tier grouping in comments), `RuleId`, `RULE_LABELS`, `SUPPRESSED_RULE_IDS`
- `cases.ts` — `SIGNAL_META` (the correlation `axis` + directness-of-theft `weight`) and `SignalAxis`
- the tier each rule belongs to existed **only** as a comment

Adding a rule meant touching all of these and hoping nothing was missed. TypeScript caught a *missing*
key (the `Record<RuleId, …>` types), but not a wrong weight, a wrong axis, or a forgotten label.

## What it looks like now

```
catalog.yaml                 ← THE source of truth (one entry per rule: id, tier, axis, weight,
    │                           suppressed, label, note)
    │  pnpm gen:rules  (scripts/gen-rule-catalog.mjs)
    ▼
catalog.generated.ts         ← RULE_IDS, RuleId, SignalAxis, RULE_LABELS, SUPPRESSED_RULE_IDS, SIGNAL_META
    ▲                           (DO NOT EDIT — regenerated; eslint/prettier-ignored)
    │
ids.ts / cases.ts            ← consume the generated data; keep only hand-authored logic
                               (formatRuleId, the correlation math, CASE_RULE_ID)
```

To change a weight, relabel a rule, suppress one, or add a new rule: **edit `catalog.yaml`, run
`pnpm gen:rules`, commit both files.** Nothing else.

## Why the generator is dependency-free

It parses the restricted YAML subset this catalog uses with a small strict reader instead of pulling in a
YAML library. That keeps `pnpm-lock.yaml` untouched, so CI needs nothing extra installed and the drift
check runs anywhere Node runs. The reader was verified to produce **byte-identical** output to the real
`yaml` npm package, and it fails loudly on anything outside the expected shape. If a future catalog needs
richer YAML (anchors, nested maps), swap in the `yaml` package and add it to devDependencies then.

## The drift guard (how consistency is *enforced*, not just intended)

`pnpm lint:codegen` = regenerate + `git diff --exit-code` on the generated files. If a committed generated
file doesn't match what the catalog produces (someone hand-edited it, or forgot to regenerate), it fails.

**One manual step:** `.github/workflows/ci.yml` is protected and can't be written by the remote tools, so
add this step yourself (right after "Install dependencies"):

```yaml
      - name: Codegen up-to-date
        run: pnpm lint:codegen
```

The script already exists in `package.json`; this just runs it in CI. Locally it's part of the same fitness
suite as `lint:filesize` / `lint:boundaries`.

## Verification done this session

- Generator output byte-identical to (a) the real `yaml` library and (b) the prior hand-authored
  `SIGNAL_META`, `RULE_LABELS`, and `RULE_IDS` (order included).
- `pnpm lint:codegen` → no drift.
- 636 shared tests + 120 api tests green; `packages/shared`, `apps/api`, `apps/web` all typecheck;
  eslint clean. Behavior is provably unchanged — this was a pure consistency-layer refactor.

## Extending the pattern (next candidates, same recipe)

The recipe — *YAML catalog → generator → generated.ts → thin consumers → drift check* — transfers directly
to the other spots where data is hand-synced across layers. In rough priority:

1. **Detection thresholds** (`anomaly_thresholds`): the zod schema, default values, the DB columns, and the
   Thresholds settings UI are kept in step by hand. A `thresholds.yaml` could generate the zod schema +
   defaults + TS type (the form scaffolding stays hand-authored).
2. **Settings groups** (`idle_settings`, `driver_performance_settings`): same shape as thresholds.
3. **API contract**: the handful of non-Supabase endpoints (imports, integrations, mutations) could get
   generated request/response types shared by `apps/api` and `apps/web`.

Each should be its own focused change with the same behavior-preserving + drift-guard discipline proven
here. Prove, don't leap.
