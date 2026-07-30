import { z } from "zod";

/**
 * @hazmat/data — PHMSA interpretation letters (Phase H1).
 *
 * PHMSA Letters of Interpretation that modify engine behavior are curated here and referenced by the
 * H2/H3 rules' citations, so a finding can cite "§172.336(c) + PHMSA 18-0023" and the UI/audit can
 * show the letter. Like reference text (D12), this is provenance + display metadata — the RULE encodes
 * the behavior; the letter explains and authorizes it. `affectsRules` links each letter to the rule
 * ids that depend on it (populated as those rules are authored).
 *
 * No API — curated once from the PHMSA permalinks (`/regulations/title49/interp/{id}`), verified
 * against the live pages.
 */

export const interpretationSchema = z.object({
  /** PHMSA reference, e.g. "18-0023" or "15-0187R". */
  id: z.string(),
  date: z.string().nullable().default(null),
  url: z.string(),
  /** CFR sections/paragraphs the letter addresses. */
  cfrSections: z.array(z.string()).default([]),
  summary: z.string(),
  /** Engine rule ids that rely on this letter (filled in as rules are authored). */
  affectsRules: z.array(z.string()).default([]),
  /** Repo-relative path of the downloaded source PDF (audit archive), if committed. */
  localFile: z.string().nullable().default(null),
  /** SHA-256 of that PDF — pins exactly which document the summary was verified against. */
  sha256: z.string().nullable().default(null),
});
export type Interpretation = z.infer<typeof interpretationSchema>;

export const interpretationsFileSchema = z.object({
  edition: z.string(),
  source: z.string().nullable().default(null),
  interpretations: z.array(interpretationSchema).default([]),
});
export type InterpretationsFile = z.infer<typeof interpretationsFileSchema>;

export function parseInterpretations(raw: unknown): InterpretationsFile {
  return interpretationsFileSchema.parse(raw);
}

/** Look up a letter by PHMSA id (case-insensitive on the trailing R). */
export function interpretationById(file: InterpretationsFile, id: string): Interpretation | null {
  const norm = (s: string) => s.trim().toUpperCase();
  return file.interpretations.find((i) => norm(i.id) === norm(id)) ?? null;
}
