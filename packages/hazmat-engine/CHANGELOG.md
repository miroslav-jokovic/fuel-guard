# @hazmat/engine — changelog

Every **verdict-affecting** change bumps the minor version and gets an entry here; the version is
stored on every verdict row (H4) so a decision is reproducible forever.

## 0.11.0 — 2026-08-11 (H-MX: mixed hazmat + general-freight loads)
- **New input `otherFreightAboard: boolean | null` (default `null`).** States whether the vehicle carries
  any freight beyond the declared hazmat lines. Read by exactly one rule — the §172.301(a)(3) non-bulk
  single-material ID display, whose "contains no other material, hazardous or otherwise" condition was
  previously an unstated assumption. It NEVER feeds the §172.504(c) aggregate (the CFR counts hazmat only).
- **§172.301(a)(3) now evaluates all of its conditions.** Other hazmat aboard (a bulk line, a second
  material) disapplies the rule; `otherFreightAboard: true` yields an `info` finding saying the display is
  NOT required, with the citation; `false` keeps the display and narrows the conditional to the
  one-loading-facility assumption; `null` preserves pre-0.11 conservative behavior exactly.
- **New output `placards.loadProfile`** — bulk / non_bulk / mixed packaging over the resolved lines, the
  line and distinct-category counts, and the echoed `otherFreightAboard` tri-state, so the UI can state the
  load type without re-deriving it.

## 0.7.0 — 2026-07-31 (H2)
- **Table 1 fail-closed gate (D4-revised).** Any line whose dataset placard row is a §172.504 **Table 1**
  class/division (explosives 1.1–1.3, 2.3 poison gas, 4.3, PIH 6.1, organic-peroxide 5.2, radioactive) now
  produces a blocking `table1_out_of_scope_v1` finding (tier `violation`), computes **no placards for the
  load**, and forces eligibility `blocked`. Recognition is total and dataset-driven — a Table 1 row is caught
  by its matched `spec.table`, regardless of whether its placard name maps to a known design. Table 1 *logic*
  (any-quantity placards, explosive-division rules) remains a later expansion pack; silence or a partial
  verdict on a Table 1 load is forbidden (D2).
- Removed the dead `determinationWithheldGate` (never referenced; its "ladder not yet implemented" message
  was stale now that the ladder ships).

## 0.6.0 — 2026-07-30 (H2) — catch-up (0.3.0–0.6.0 shipped without individual notes)
- The substantive `computePlacards` ladder: §172.504 Table 2, the 1,001-lb aggregate (172.504(c)),
  sole-vs-mixed DANGEROUS (172.504(b)), GASOLINE/FUEL OIL wording (172.542/.544), bulk (172.302/172.331) +
  non-bulk single-material (172.301(a)(3)) ID display, ERG guides, and the HOT mark (172.325).
- `checkSegregation` (§177.848(d) load-compatibility grid) and `validateBol` (§172.202/.203 shipping-paper
  compliance) — each tested against the real `2026.07.x` dataset.

## 0.2.0 — 2026-07-29 (H2, in progress)
- Adopt the locked H2 I/O contract: full `LoadInput` (vehicle, tank state, lines, claimed exceptions,
  port/trip context, injected dataset) and the rich `Verdict` (placards/eligibility/segregation/trace).
- `evaluateLoad()` implements the dataset-INDEPENDENT gates: no-hazmat exit, cleaned-and-purged tank
  prohibition (§172.502(a)/§172.303), and a fail-closed "determination withheld" gate. The substantive
  placard ladder (steps 2–12) is blocked on H1's certified dataset + SME R1–R3 and fail-closes to review.

## 0.1.0 — 2026-07-29 (H0)
- Module skeleton: I/O contracts + fail-closed stubs.
