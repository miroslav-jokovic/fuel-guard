# Releasing a `@hazmat/data` dataset (Phase H1, deliverable 5)

A dataset is a **human-reviewed, two-source-verified** release. The steps ARE the safety — the
emergency path is the same steps, same day, no shortcuts. Nothing here is hand-edited into
`datasets/<version>.json`; that file is only ever minted by `import/buildDataset.ts`.

**Two sources, both official, both free (D5 v5->v7 - no paid vendor):**

- **Source A (automated, authoritative, scales):** the eCFR versioner API — point-in-time Title 49
  XML — parsed by `import/parseHmt.ts` (`parseHmtSection`), built and frozen against a real captured
  fixture.
- **Source B (independent official edition - D5 v7):** the **official GovInfo annual CFR edition**
  (Title-49 GPO legal edition), captured as XML by `import/captureGovInfo.ts` and diffed automatically
  row-by-row against Source A by `import/diff.ts` - the primary mechanical gate, exhaustive over ALL rows,
  catching every parse/transport error and flagging amendment drift (reconciled to the Federal Register +
  eCFR corrections). Because eCFR and GovInfo share the OFR origin, the automated diff cannot catch a
  *shared source-data* error, so a **human attestation** of the reconciled report (+ a PDF spot-check) is
  retained as the independence backstop - reduced from transcribing every in-scope row to signing off a
  machine-generated report. *(D5 v7 BUILT 2026-07-30: the GovInfo-format parsers (`parseHmtGovInfo`/`parsePlacardsGovInfo`/`parseSegregationGovInfo`, sharing `hmtAssemble.ts` with eCFR) + the automated cross-check `import/govinfoCrossCheck.ts` are built and pass CLEAN on all three tables; the remaining step to mint a non-provisional dataset is wiring `crossCheckAll()` into `buildDataset.ts`'s gate + attesting the clean report.)*

**Prerequisites (run locally — the sandbox/CI cannot reach the gov APIs):** Node 22+, `pnpm install`,
and `GOVINFO_API_KEY` in the environment for the Source-B PDF.

## The cut, step by step

Run everything from `packages/hazmat-data/`.

**0. Currency check — is a re-cut even needed?**
   - `npx tsx import/fedRegisterSmoke.ts` (no key) lists recent PHMSA HMR amendments with their
     **effective dates**; `checkHmrCurrency` flags effective-pending rules you must cut *before*.
   - Poll eCFR `latest_amended_on` for Title 49 (via `checkTitleForUpdate` in `import/ecfr.ts`). If
     the section text is unchanged since the last release and no HMR amendment is pending, **stop.**

**1. Capture the primary source (Source A input).**
   - `npx tsx import/captureFixtures.ts` — saves the real §172.101 / §172.504 / §177.848 XML plus the
     structure/versions/corrections JSON into `import/fixtures/` (gitignored; regenerable). Note the
     pinned eCFR date it prints — it becomes `sourceEcfrDate`.

**2. Parse + prove the parser (Source A).**
   - `pnpm --filter @hazmat/data test import/parseHmt.test.ts` — the frozen fuel-slice fixture with
     hand-verified expected `HmtEntry[]` **must pass**. A parser change that moves any expected value
     fails here first. (This is the "parser fixtures must pass" gate referenced from `parseHmt.ts`.)

**3. Capture Source B - the official GovInfo edition (D5 v7, automated).**
   - `GOVINFO_API_KEY=... npx tsx import/captureGovInfo.ts` - resolves and downloads the official GovInfo
     annual CFR edition XML for §172.101 / §172.504 / §177.848 into `import/fixtures/govinfo/` plus a
     `provenance.json` (package/granule id, edition year - record the edition as `sourceSecondaryRef`).
     Run locally; the sandbox/CI cannot reach `api.govinfo.gov`. The key is never printed; nothing is
     written to the dataset.
   - *D5 v7 (BUILT 2026-07-30):* the GovInfo-format parsers + the automated eCFR<->GovInfo cross-check
     (`import/govinfoCrossCheck.ts`) are built and pass CLEAN (HMT 2,479/2,479, placards 23/23, segregation
     173/173). To mint a non-provisional dataset, wire `crossCheckAll()` into `buildDataset.ts`'s provisional
     gate and attest the clean report. (`handVerifiedRows.ts` remains an optional PDF spot-check anchor.)

**4. Second-source diff — the release gate.**
   - `npx tsx import/diff.ts` compares Source A vs Source B on `prefix+number+name` and prints a
     field-level report; it exits non-zero until **every in-scope row is `done`, audited, and in
     agreement** (`report.clean`). **Zero unexplained disagreements to proceed.**
   - Save the printed report to `datasets/<version>/diff-report.md`. A real disagreement is either a
     parser bug (fix `parseHmt.ts`, re-run step 2) or a transcription error (fix Source B); an
     *explained* difference (e.g. a known eCFR typo with a citation) is recorded there and allowed. (Under D5 v7 triangulation the diff's second source is the GovInfo edition; an explained difference is reconciled to a cited Federal Register amendment / eCFR correction and a human attests the reconciled report rather than transcribing rows.)

**5. Cut the versioned dataset.**
   - `npx tsx import/buildDataset.ts <version> <sourceEcfrDate> [effectiveDate]`
     (e.g. `… 2026.07.0 2026-07-28 2026-08-15`).
   - It parses Source A, loads the frozen ERG table (`datasets/erg2024.json`), **re-runs the step-4
     gate**, and writes `datasets/<version>.json` with a sha256 content `checksum`. **`provisional` is
     forced to `!diff.clean`** — you cannot mint a non-provisional dataset while the gate is red, even
     by hand. Version format: `YYYY.MM.n`.

**6. Register the version.**
   - Add the new file to the `RAW` map in `src/index.ts` and bump `LATEST_DATASET_VERSION`. This is
     the only manual code edit — the assembler will not touch `src/`.

**7. Prove the release.**
   - `pnpm --filter @hazmat/data typecheck && pnpm --filter @hazmat/data test` (loader + parser + diff
     + assembler). The H2 **golden suite** must also pass fully before a non-provisional dataset ships.

**8. Human review → merge.** Review the delta and the diff report, then merge. The database records
   only the dataset **version** each verdict used (D9/G6) — never a copy of the rows.

## Provisional vs. real

`provisional: true` until the Source-B transcription + step-4 diff for the in-scope rows is complete
and clean. A provisional dataset is fine for development and preview, but the clear endpoint (H4/H7)
refuses ALL clearing — auto or attested — against it in production. The second-source verification is what is blocking for launch (D5 v7: attesting the automated GovInfo<->eCFR reconciliation report; interim: the human transcription) - bounded in-house work, no procurement, no vendor license.

## Scope note

Source B covers the **in-scope rows only** (the 13 fuel entries in `IN_SCOPE_ENTRIES` — the 12
`ERG_FUEL_IDS`, with diesel/heating-oil under both UN1202 and NA1993). That is sufficient because D4
forbids CLEARING any out-of-scope row: an unverified row is recognized and **fail-closed, never
cleared**. Expanding scope = transcribe the new in-scope rows first, then they fall under the step-4
gate.

## Tables still pending a parser

`buildDataset.ts` populates `entries` (HMT), `erg`, `placards` (§172.504), `segregation`
(§177.848(d)), `hazSubstances` (§172.101 App. A) and `marinePollutants` (§172.101 App. B) — each
parsed from a frozen fixture with its own test. The one remaining table, `specialProvisions`
(§172.102), has no parser yet and assembles empty until the engine (H2) declares which provisions it
interprets. Empty is safe (the engine D4-fail-closes any check whose table is empty — it never
silently passes). NOTE: only the HMT fuel rows are second-source verified (the step-4 diff); the
placard/segregation/appendix tables are parser-verified against frozen fixtures but not yet
independently transcribed — extend the diff to them before a full non-provisional release.

## Emergency re-cut

Same eight steps, same day. There is no shortcut path: a rushed dataset that skipped the second
source is exactly the failure mode this pipeline exists to prevent. If a PHMSA amendment is
effective-imminent, capture (step 1), transcribe only the affected in-scope rows (step 3), and run
the gate — the bounded scope keeps the human step to hours, not days.
