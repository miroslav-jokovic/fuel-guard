# Golden scenarios (HazmatGuard acceptance suite) — sourcing model v2 (PLAN v1.18)

> **v2 (2026-08-05, owner decision): scenarios are CAPTURED from SME-adjudicated real BOLs, never
> invented.** The v1 model ("author 400 synthetic scenarios upfront") is retired — it asked the SME
> to invent cases at a desk, which is backwards. The app is built FROM the rules; the SME validates
> it by inspecting REAL BOLs her normal way and recording her outcome (the BOL Adjudication Log);
> the same BOL runs through the app and the outcomes must match. Each adjudicated BOL is converted
> (by the engineering side — the SME never writes YAML) into a scenario file here, so the gate
> grows monotonically from reality and becomes the permanent regression net.
>
> **Scope: v1 works Table 2 materials only.** A Table 1 material on a load is refused fail-closed —
> the only Table 1 scenarios in this suite assert that refusal, nothing more.

## The independence rule (unchanged, and still the point)

The `expect` values come from the SME's adjudication of the real document + the CFR — never from
running the engine and pasting its output. `verifiedBy` records the SME; `sourceBolRef` records the
real BOL the scenario was captured from. A disagreement between her and the engine is investigated
and documented BEFORE it is resolved; the CFR wins the verdict.

## How a scenario gets here now

1. The SME fills one row of the BOL Adjudication Log for a real BOL (her normal inspection, in her
   normal order — nothing new to learn).
2. The same BOL runs through the app.
3. Engineering converts the Log row + the load's declared/extracted lines into a YAML scenario file
   (fields below), sets `verifiedBy` to the SME and `sourceBolRef` to the BOL's photo/reference.
4. On a MISMATCH: file the disagreement, adjudicate against the CFR with the SME, then capture the
   RESOLVED expectation — the scenario memorializes the resolution.
5. Deliberate edge-case scenarios (a boundary reality never produced, e.g. 1,001 lb exactly) are
   allowed ONLY when a coverage-checklist review flags the gap, and are constructed WITH the SME as
   a minimal modification of a real BOL, marked `deliberate: true` with the gap they close.

## File format (unchanged — the harness is the same)

Copy `scenarios/TEMPLATE.yaml`; one scenario per file; files starting with `_` are implementer
harness examples and never count. `pnpm --filter @hazmat/golden test` is the gate;
`pnpm --filter @hazmat/golden golden` prints the readable report for the review log.

## Known erratum for authors (unchanged)

**Doc-17 §B.5 mis-groups UN3475 (Ethanol and gasoline mixture) under ERG Guide 128 — the correct
guide is 127** (doc-17 §5.2 has it right). Do not copy the §B.5 grouping into a scenario.

## Sign-off

The Adjudication Log + `verifiedBy`/`sourceBolRef` on each captured scenario are the evidence a
human adjudicated the gate. A mutation spot-check (flip ~10 engine rule constants → expect scenario
failures) still confirms the suite constrains the code.
