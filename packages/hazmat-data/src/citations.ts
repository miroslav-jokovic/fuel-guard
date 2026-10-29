import { z } from "zod";

/**
 * @hazmat/data — the verified citation list (TWO-CLICK-READER-PLAN TC0.5, D-TC10).
 *
 * Every `cfr` string the engine puts on a finding, a placard or a trace, each with the words its eCFR paragraph must
 * contain for the engine's use of it to be right (`mustSay`, written by a person) and the excerpt, date and URL that
 * prove it (written by `import/citationsBuild.ts` from eCFR). Existence alone proves nothing: §172.505(b) exists and
 * is uranium hexafluoride, and the engine cited it for DANGEROUS WHEN WET from 2026-08 to 2026-10-29 (E4). A phrase
 * the paragraph must say is the claim; the builder checks it against the regulation, and the census in
 * `@hazmat/golden` checks the engine emits nothing outside the list.
 *
 * Like the reference text it never feeds the engine: it is evidence about the engine, not input to it.
 */
export const citationEntrySchema = z.object({
  cfr: z.string().min(1),
  mustSay: z.array(z.string().min(3)).min(1),
  section: z.string().nullable().default(null),
  paragraph: z.string().nullable().default(null),
  excerpt: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
});
export type CitationEntry = z.infer<typeof citationEntrySchema>;

export const citationListSchema = z.object({
  /** The eCFR point-in-time the excerpts were read at, and the day they were. Null until the first build. */
  ecfrDate: z.string().nullable(),
  readOn: z.string().nullable(),
  citations: z.array(citationEntrySchema),
  /** Strings in a `cfr` field that name a plan decision, not a CFR paragraph — each says why. */
  internal: z.array(z.object({ cfr: z.string().startsWith("internal: "), why: z.string().min(10) })),
});
export type CitationList = z.infer<typeof citationListSchema>;

/** The form `mustSay` is matched in: lower case, one space, straight quotes, no soft breaks. */
export function normaliseCfrText(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}
