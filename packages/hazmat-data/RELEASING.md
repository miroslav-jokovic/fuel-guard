# Releasing a `@hazmat/data` dataset (Phase H1, deliverable 5)

A dataset is a **human-reviewed, two-source-verified** release. The steps ARE the safety — the
emergency path is the same steps, same day, no shortcuts.

1. **Poll eCFR** `latest_amended_on` for Title 49 (weekly scheduled job in H11; manual until then).
   If unchanged, stop.
2. **Import** — run `import/ecfr.ts`: point-in-time Title 49 XML → HMT table + §172.504(e) + §177.848(d)
   parsed into the schema. Parser fixtures (frozen XML → expected rows) must pass.
3. **Second-source diff** — run `import/diff.ts` vs the licensed dataset (D5). **Zero unexplained
   disagreements** to proceed; explained ones recorded in `datasets/<version>/diff-report.md`.
4. **Citation-resolver check** — every citation in the H2/H3 rule catalogs must resolve against the
   current eCFR structure; unresolvable citations fail the build.
5. **Hand-verified fixtures** — every fuel product's row asserted field-by-field against a human
   transcription (`fixtures/handVerifiedRows.ts`); the full §177.848(d) grid asserted cell-by-cell.
6. **Human review** of the delta, then bump the calendar version (`YYYY.MM.n`) with `effectiveDate`.
7. **Golden suite (H2)** must pass fully.
8. Merge. The DB records only the dataset **version** each verdict used.

**Provisional releases:** until the licensed second source is in place, ship `provisional: true`.
A provisional dataset can be used for development and preview, but the clear endpoint (H4/H7) refuses
ALL clearing — auto or attested — in production. This makes the license blocking for launch, not for
building.
