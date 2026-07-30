/**
 * Second-source diff (Phase H1, deliverable 3) — NOT YET IMPLEMENTED.
 *
 * Official-sources-only (D5 v5 — no paid vendor). Compares the eCFR-XML parse (Source A, from
 * import/ecfr.ts) against the independent HUMAN TRANSCRIPTION of the in-scope rows (Source B —
 * `fixtures/handVerifiedRows.ts`, typed by a person from the official GovInfo Title-49 legal PDF)
 * and reports every row-level disagreement. RELEASE RULE: zero UNEXPLAINED disagreements; explained
 * ones are recorded in datasets/vX/diff-report.md.
 *
 * Why the second source is a human transcription and not another feed: eCFR and GovInfo XML both
 * derive from the same OFR codification, so a second automated feed would only catch transport/parse
 * errors — never a source-data error. A human reading the official PDF is the only genuinely
 * independent check, and it is bounded to the in-scope rows (D4 fail-closes everything else). This
 * transcription is now the blocking item for launch (in-house work, no procurement), replacing the
 * former licensed-vendor dependency.
 */
export function diffAgainstTranscription(): never {
  throw new Error("diffAgainstTranscription is not implemented yet — HazmatGuard Phase H1 (deliverable 3).");
}
