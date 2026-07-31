# @hazmat/golden

The **golden acceptance suite** for the HazmatGuard rules engine (plan H2). Declarative, SME-authored
scenarios (`scenarios/*.yaml`) are run through the **real `@hazmat/engine`** against the **real shipped
`@hazmat/data` dataset**; the engine must reproduce every independently-authored expectation.

## Why this is its own package

`@hazmat/engine` and `@hazmat/data` must stay dependency-free and extractable — CI forbids them from
importing each other or the app. The golden suite legitimately needs **both** (the engine's logic + the
real dataset), so it lives here, as the one package that wires them together. This is a deliberate change
from the plan's original "in the engine's test dir" location, which predates the package boundary being
enforced on the whole engine directory.

## Layout

- `scenarios/*.yaml` — one scenario per file. `TEMPLATE.yaml` is the authoring template; `_*.yaml` are
  implementer harness examples (NOT part of the acceptance count).
- `src/schema.ts` — the scenario + expectation schema (Zod).
- `src/runner.ts` — runs a scenario through the engine and checks the expectation (never authors it).
- `src/load.ts` — loads + validates the YAML scenarios.
- `src/report.ts` / `src/cli.ts` — human-readable report.
- `src/golden.test.ts` — the Vitest gate (all pass; `verifiedBy` present; a non-vacuous negative control).
- `AUTHORING.md` — the SME's guide, incl. the independent-authorship rule and coverage budget.

## Run

```
pnpm install                        # first time only — links the new workspace package
pnpm --filter @hazmat/golden test   # the gate
pnpm --filter @hazmat/golden golden # readable CLI report (for the review log)
```
