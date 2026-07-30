# Releasing a `@hazmat/data` dataset (Phase H1, deliverable 5)

A dataset is a **human-reviewed, two-source-verified** release. The steps ARE the safety — the
emergency path is the same steps, same day, no shortcuts. Nothing here is hand-edited into
`datasets/<version>.json`; that file is only ever minted by `import/buildDataset.ts`.

**Two sources, both official, both free (D5 v5 — no paid vendor):**

- **Source A (automated, authoritative, scales):** the eCFR versioner API — point-in-time Title 49
  XML — parsed by `import/parseHmt.ts` (`parseHmtSection`), built and frozen against a real captured
  fixture.
- **Source B (independent, human):** a person transcribes the in-scope rows from the **official
  GovInfo Title-49 legal PDF** into `import/fixtures/handVerifiedRows.ts`. This is independent of A
  because it is a different *rendering* read by a different *method* — the only check that catches a
  source-data error, not just a parse bug. (eCFR and GovInfo XML share the OFR origin, so a second
  automated feed would not be independent.)

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

**3. Transcribe Source B — the human step, the launch blocker.**
   - Fetch the official PDF: `GOVINFO_API_KEY=… npx tsx import/govinfoSmoke.ts` downloads the §172.101
     legal PDF and prints its provenance (package/granule id, edition year — record this as each row's
     `source`).
   - Fill `import/fixtures/handVerifiedRows.ts`: for each of the 13 in-scope fuel rows, transcribe
     every column **from the PDF only** — do NOT open the eCFR XML, `parseHmt` output, or
     `parseHmt.test.ts` while transcribing (reading A's source defeats the independence). Set
     `status: "done"` and fill `source` + `transcriber` per row. The file header documents the
     discipline and shows a filled example.

**4. Second-source diff — the release gate.**
   - `npx tsx import/diff.ts` compares Source A vs Source B on `prefix+number+name` and prints a
     field-level report; it exits non-zero until **every in-scope row is `done`, audited, and in
     agreement** (`report.clean`). **Zero unexplained disagreements to proceed.**
   - Save the printed report to `datasets/<version>/diff-report.md`. A real disagreement is either a
     parser bug (fix `parseHmt.ts`, re-run step 2) or a transcription error (fix Source B); an
     *explained* difference (e.g. a known eCFR typo with a citation) is recorded there and allowed.

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
refuses ALL clearing — auto or attested — against it in production. The *transcription* is what is
blocking for launch (bounded in-house work, no procurement), not any vendor license.

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
