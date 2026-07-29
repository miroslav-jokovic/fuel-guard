# @hazmat/engine — changelog

Every **verdict-affecting** change bumps the minor version and gets an entry here; the version is
stored on every verdict row (H4) so a decision is reproducible forever.

## 0.1.0 — 2026-07-29 (H0)
- Module skeleton: I/O contracts (`LoadInput`, `HazmatDataset`, `PlacardResult`, `LoadEvaluation`, …)
  and the five entry points (`computePlacards`, `validateBol`, `checkEligibility`, `checkSegregation`,
  `evaluateLoad`) as fail-closed stubs. No verdict logic yet — H1–H3 implement it.
