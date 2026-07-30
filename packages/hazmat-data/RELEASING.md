# Releasing a `@hazmat/data` dataset (Phase H1, deliverable 5)

A dataset is a **human-reviewed, two-source-verified** release. The steps ARE the safety — the
emergency path is the same steps, same day, no shortcuts.

**Two sources, both official, both free (D5 v5 — no paid vendor):**
- **Source A (automated, authoritative, scales):** the eCFR versioner API — point-in-time Title 49
  XML — parsed by `import/ecfr.ts`.
- **Source B (independent, human):** a person transcribes the in-scope rows from the **official
  GovInfo Title-49 legal PDF** into `fixtures/handVerifiedRows.ts`. This is independent of A because
  it is a different *rendering* read by a different *method* — the only check that catches a
  source-data error, not just a parse bug. (eCFR and GovInfo XML share the OFR origin, so a second
  automated feed would not be independent.)

1. **Poll eCFR** `latest_amended_on` for Title 49 (weekly scheduled job in H11; manual until then).
   If unchanged, stop.
2. **Import** — run `import/ecfr.ts`: point-in-time Title 49 XML → HMT table + §172.504(e) + §177.848(d)
   parsed into the schema. Parser fixtures (frozen XML → expected rows) must pass.
3. **Second-source diff** — run `import/diff.ts` to compare the parser output against the human
   transcription (`fixtures/handVerifiedRows.ts`, Source B). **Zero unexplained disagreements** to
   proceed; explained ones recorded in `datasets/<version>/diff-report.md`.
4. **Citation-resolver check** — every citation in the H2/H3 rule catalogs must resolve against the
   current eCFR structure; unresolvable citations fail the build.
5. **Hand-verified fixtures** — the same transcription is also asserted field-by-field in the golden
   suite (every fuel product's row; the full §177.848(d) grid cell-by-cell). Steps 3 and 5 read the
   one `fixtures/handVerifiedRows.ts`: it is both the independence check and the ground-truth anchor.
6. **Human review** of the delta, then bump the calendar version (`YYYY.MM.n`) with `effectiveDate`.
7. **Golden suite (H2)** must pass fully.
8. Merge. The DB records only the dataset **version** each verdict used.

**Scope note.** The transcription (Source B) covers the **in-scope rows** only (fuel + Table-2 launch
set). That is sufficient because D4 forbids CLEARING any out-of-scope row — an unverified row is
recognized and fail-closed, never cleared. Expanding scope = transcribe the new in-scope rows first,
then they fall under the step-3 diff gate.

**Provisional releases:** until the transcription + diff for the in-scope rows is complete, ship
`provisional: true`. A provisional dataset can be used for development and preview, but the clear
endpoint (H4/H7) refuses ALL clearing — auto or attested — in production. So the *transcription* is
what is blocking for launch (bounded in-house work, no procurement) — not any vendor license.
