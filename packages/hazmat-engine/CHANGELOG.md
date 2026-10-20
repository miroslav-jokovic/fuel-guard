# @hazmat/engine — changelog

Every **verdict-affecting** change bumps the minor version and gets an entry here; the version is
stored on every verdict row (H4) so a decision is reproducible forever.

## 0.20.0 — 2026-10-20 (RQ by net weight and printed concentration — READER-CORRECTNESS-PLAN R-M1)

- **`paper_rq` judges a package's contents from the NET weight column** (`PrintedPaperLine.netWeightLb`, reader
  profile 1.5.0) when the description prints no quantity by mass, and **a solution by the concentration its
  description cell prints** (`printedConcentration`: "CAUSTIC SODA 50%" → 50; none, or two different ones, → null).
  At or over the RQ → `rq_not_printed` (facts carry `concentrationPct`, `substancePerPackage`); a printed share that
  puts it under → `concentration_basis_unknown` (cannot tell — §171.8 judges by weight, a paper's "%" does not say
  by what), never a pass. Mayo Products BOL 14182 (8 totes at 50 % sodium hydroxide, 2 of sulfuric acid at 93 %)
  now fails RQ on both lines, as worked by hand; before, both were "can't tell".
- **A package whose whole gross weight is under the RQ clears it** (`below_rq`, `basis: "gross_weight"`): it cannot
  hold that much of anything. A gross weight never fails a line.
- **`paper_quantity_present` passes a line that prints a net weight** (`net_weight_printed`): the contents' mass
  is §172.202(a)(5)'s total quantity by mass.
- Proven over every HMT row Appendix A reaches, both sides of the RQ, in hazmat-golden `rqCensus.test.ts`.

## 0.19.0 — 2026-10-19 (whole-table census: Appendix B by form, §172.505 weight)
- **Appendix B (marine pollutants) is matched by form, through the same definition as Appendix A**
  (`appendixNameMatch.ts`). The exact match missed 13 entries, among them UN2315 Polychlorinated biphenyls,
  liquid — a SEVERE marine pollutant no rule recognised. `validateBol` no longer keeps its own copy of the
  marine-pollutant test; it calls `classifyMarinePollutantEntry`.
- **A §172.505 material in non-bulk packaging now counts toward the §172.504(c) aggregate.** It always
  placarded, but its weight was dropped from the vehicle's total, so 500 lb of red fuming nitric acid beside
  1,000 lb of other poisons read as a 1,000 lb aggregate and POISON was not required. PHMSA Interp. 07-0102:
  all non-bulk Table 2 weight counts; bulk does not (98-0601), which is unchanged. Found by the new placard
  census (hazmat-golden `placardCensus.test.ts`: every HMT row at four loads, 20,000 seeded mixed loads,
  same-class bulk pairs for every class).

## 0.18.0 — 2026-10-19 (Appendix A by form)
- **RQ, the marine-pollutant exception and the required-description line now find an Appendix A substance
  under its HMT form.** The match was exact, so "Sodium hydroxide solution" (Mayo Products BOL 14182, 50 %
  caustic soda totes), "Ammonia, anhydrous" (RQ 100 lb) and "Acrolein, stabilized" (RQ 1 lb) read as not
  listed and `paper_rq` PASSED them. A neat form (anhydrous, stabilized, solid, molten …) is judged as the
  substance; a solution or wetted/fuming form as a component — cleared under the RQ, otherwise
  `concentration_unknown`, never a pass. Reaches 52 + 37 entries beyond the 155 exact matches (2026.07.1).

## 0.17.0 — 2026-10-19 (identification numbers: one carrier per number)
- **Each required identification number now rides only on its own primary-class placard (§172.332(c)).**
  Every number used to receive the same carrier list — every required placard — so on a gasoline-tote +
  corrosive load the CORROSIVE placard was offered UN1203.
- **§172.334(d) is evaluated.** A number goes across a placard only when the numbers on that class's
  placards together cover every material of the class aboard (PHMSA Interp. 16-0026: separate placards of
  the class, one per number). Two Class 8 totes, UN1824 + UN1830, on a dry van (the owner's Mayo Products
  BOL) → two CORROSIVE placards on each side and each end, one reading 1824, one reading 1830. When the
  class also holds a material whose number is not required (UN3264 drums beside a UN1760 tote), the
  required number moves to an orange panel / white square-on-point beside the placard (§172.334(f)), with
  the info finding `id_number_not_on_placard_class_not_covered`.

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
