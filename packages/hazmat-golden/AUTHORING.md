# Authoring golden scenarios (HazmatGuard §H2 acceptance suite)

This suite is the **independent acceptance gate** for the rules engine. Each scenario is a real load
plus the outcome the CFR requires; the engine must reproduce every one, 100%, before it can be trusted
to clear a load.

## The one rule that makes this suite worth anything (D11 / plan H2)

**The `expect` values are authored from the CFR text and doc-17 by the hazmat SME — never by the engine
implementer, and never by running the engine and pasting its output.** If the expected answer comes from
the code, the test only proves the code agrees with itself. Author from the regulation.

- Every file records `verifiedBy:` (who wrote the expectation) and `verifiedOn:`. The gate rejects a
  scenario with an empty `verifiedBy`.
- The "different chat session, same person who implemented the engine" shortcut is **not** independent —
  it is forbidden.
- Files whose name starts with `_` are **implementer harness examples** that demonstrate the runner.
  They are NOT part of the acceptance count. Do not add real scenarios with a `_` prefix.

## How to add a scenario

1. Copy `scenarios/TEMPLATE.yaml` to a new descriptive name **not** starting with `_`
   (e.g. `gasoline-1001lb-edge.yaml`). One scenario per file.
2. Fill `input` with the load (see the template for the field guide). `hmtRef` is `"<entryId>#<PG>"`,
   e.g. `"UN1203-gasoline#II"`; use `"none"` for a material with no packing group.
3. Fill `expect` **from the CFR** — only the keys you want to assert. Cite the rule in `docRef`.
4. Set `verifiedBy` / `verifiedOn`.
5. Run the suite: `pnpm --filter @hazmat/golden test` (or `pnpm --filter @hazmat/golden golden` for the
   readable CLI report). A failing scenario means either the engine is wrong (a finding — file it) or the
   expectation is wrong (fix it) — investigate every disagreement (D11 conflict rule: the CFR wins the
   verdict, but the disagreement is documented before it is resolved).

## Coverage budget (plan H2 — minimum 400 scenarios at launch)

Do NOT re-enumerate the per-cell HMT / segregation values — those are asserted cell-by-cell in the H1
fixtures. This suite covers **interactions**:

- Every Table 2 row (~16) + one `table1_out_of_scope_v1` blocking scenario per Table 1 row (~7 — proves
  the fail-closed gate, not the logic).
- Every §172.504(f) exception involving only Table 2 classes — (f)(2), (f)(3), (f)(7), (f)(9), (f)(10) (~15).
- 1,001-lb aggregate edges — 999 / 1000 / 1001 lb, mixed-class aggregation, residue exclusion (~15).
- DANGEROUS permutations incl. every reason it is forbidden (~15).
- Every fuel product alone + all pairwise cargo-tank combos (~110); tank states × products (~45).
- Business-day ID scenarios incl. the overnight case + the ethanol never-retain rule (~15).
- Both trap lists (doc-17 §A.8 + §B.6), ≥1 each (~30).
- Segregation *interaction* pairs — one per distinct X/O outcome + every fuel-relevant pairing (~40).
- Eligibility allow / deny / unknown-product (~20). Remainder: H11 regression additions.

## Known erratum for authors

**Doc-17 §B.5 mis-groups UN3475 (Ethanol and gasoline mixture) under ERG Guide 128 — the correct guide is
127** (doc-17 §5.2 has it right). Do not copy the §B.5 grouping into a scenario.

## Sign-off (H2 exit criteria)

Keep a scenario-review log: who verified which files, when. The suite's `verifiedBy` fields + this log are
the evidence a human authored the gate. A mutation spot-check (flip ~10 engine rule constants → expect
≥10 scenario failures each) confirms the suite actually constrains the code.
