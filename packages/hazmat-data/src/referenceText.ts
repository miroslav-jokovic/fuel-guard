import { z } from "zod";

/**
 * @hazmat/data — CFR reference text (Phase H1, decision D12).
 *
 * The plain, sectioned, citation-keyed text of the CFR sections HazmatGuard cites. Its ONLY jobs are
 * (1) letting a human read the rule behind a verdict ("show me §172.504(f)") and (2) strengthening
 * the audit chain by recording the exact text a verdict relied on.
 *
 * IT NEVER FEEDS THE ENGINE. That boundary is enforced structurally: this store is NOT part of the
 * `Dataset` schema (`schema.ts`), so `evaluateLoad(input)` — which only ever receives a `Dataset` —
 * cannot reach it. Every compliance/eligibility/placard verdict still comes from the deterministic
 * rules over the structured dataset (D1). Reference text is display + audit, full stop.
 */

export const referenceParagraphSchema = z.object({
  /** The paragraph designator as printed — "a", "b", "1", "i", … — or null for lead-in text. */
  designator: z.string().nullable(),
  text: z.string(),
});
export type ReferenceParagraph = z.infer<typeof referenceParagraphSchema>;

export const sectionReferenceSchema = z.object({
  /** Full citation, e.g. "49 CFR 172.504". */
  citation: z.string(),
  /** Section number alone, e.g. "172.504" — the store key. */
  sectionNumber: z.string(),
  subject: z.string(),
  paragraphs: z.array(referenceParagraphSchema).default([]),
  /** The eCFR point-in-time date / dataset version this text was captured at (provenance). */
  sourceVersion: z.string().nullable().default(null),
});
export type SectionReference = z.infer<typeof sectionReferenceSchema>;

export const referenceStoreSchema = z.object({
  version: z.string(),
  /** true until populated by the reviewed build (import/referenceTextBuild.ts). */
  provisional: z.boolean().default(true),
  source: z.string().nullable().default(null),
  /** Keyed by section number ("172.504"). */
  sections: z.record(z.string(), sectionReferenceSchema).default({}),
});
export type ReferenceStore = z.infer<typeof referenceStoreSchema>;

export function parseReferenceStore(raw: unknown): ReferenceStore {
  return referenceStoreSchema.parse(raw);
}

// ── citation resolution (for the "read the rule behind this finding" UI) ──────────
const CITATION_RE = /(\d{3}\.\d+)((?:\([A-Za-z0-9]+\))*)/;

/** Parse "49 CFR 172.504(f)(2)" (or "172.504(f)") → { sectionNumber, designators }. */
export function parseCitation(citation: string): { sectionNumber: string | null; designators: string[] } {
  const m = CITATION_RE.exec(citation);
  if (!m || !m[1]) return { sectionNumber: null, designators: [] };
  const designators = [...(m[2] ?? "").matchAll(/\(([A-Za-z0-9]+)\)/g)].map((d) => d[1] ?? "");
  return { sectionNumber: m[1], designators };
}

/**
 * Resolve a rule's citation to its reference text: the whole section plus the best-matching paragraph
 * (the top-level designator, e.g. "(f)"). Returns null when the section isn't in the store — the UI
 * then links out to eCFR rather than showing nothing.
 */
export function referenceForCitation(
  store: ReferenceStore,
  citation: string,
): { section: SectionReference; paragraph: ReferenceParagraph | null } | null {
  const { sectionNumber, designators } = parseCitation(citation);
  if (!sectionNumber) return null;
  const section = store.sections[sectionNumber];
  if (!section) return null;
  const top = designators[0];
  const paragraph = top ? (section.paragraphs.find((p) => p.designator === top) ?? null) : null;
  return { section, paragraph };
}
