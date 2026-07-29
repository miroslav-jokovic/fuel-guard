# @hazmat/engine — changelog

Every **verdict-affecting** change bumps the minor version and gets an entry here; the version is
stored on every verdict row (H4) so a decision is reproducible forever.

## 0.2.0 — 2026-07-29 (H2, in progress)
- Adopt the locked H2 I/O contract: full `LoadInput` (vehicle, tank state, lines, claimed exceptions,
  port/trip context, injected dataset) and the rich `Verdict` (placards/eligibility/segregation/trace).
- `evaluateLoad()` implements the dataset-INDEPENDENT gates: no-hazmat exit, cleaned-and-purged tank
  prohibition (§172.502(a)/§172.303), and a fail-closed "determination withheld" gate. The substantive
  placard ladder (steps 2–12) is blocked on H1's certified dataset + SME R1–R3 and fail-closes to review.

## 0.1.0 — 2026-07-29 (H0)
- Module skeleton: I/O contracts + fail-closed stubs.
