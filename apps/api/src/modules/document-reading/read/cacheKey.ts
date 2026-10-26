import { createHash } from "node:crypto";

/**
 * A read's cache key (§4 item 6, F-EX10): everything that, changed, must make a finished read NOT
 * replay. The hazmat extractor's key once left out the engine, the dataset and the qualification inputs
 * (orchestrate.ts §10.10), and a stale verdict replayed from cache; this key is named term by term so a
 * missing one is visible in review and in the test that varies each term alone.
 *
 *   profileVersion     the profile's schema version (a new field is a new document).
 *   models             the pass models actually called, in pass order.
 *   promptVersion      the profile prompt's version (prompts.ts).
 *   schemaHash         the wire schema(s) sent — for a sectioned profile, the combined hash.
 *   acceptanceRule     the acceptance rule's version (Phase 2; `ACCEPTANCE_RULE_VERSION` until then).
 *   pages              each page READ, in order: its original's sha256, the normaliser that made it, and
 *                      the clockwise turn it was sent at (P2, 0456) — the same bytes turned are another page.
 *   sendRule           how the pages were sized and framed in the request (`SEND_RULE_VERSION`, D-DR16):
 *                      the same pages sent at another size are another read.
 *   reviewEpoch        how many reviews the source's reads hold. F-EX10: once a person has corrected a
 *                      read of these bytes, a new read must be a new read, not the corrected one replayed
 *                      as if nobody had looked. Reviews are append-only (0448), so the count only rises.
 *
 * The terms are joined as `name=value` lines in this fixed order, so no two different inputs can join to
 * the same string (no term holds a newline: versions and hashes are generated, and a model id is a pin).
 */
/**
 * The acceptance rule that sets each field's status (D-DR17/D-DR19), versioned so a graduation count and
 * a cached read each belong to one rule.
 *   none — no evidence recorded (Steps 1.6–P2).
 *   1    — 2026-10-11, §7B A2: the Hazardous Materials Table judges each hazmat line; nothing is *Read*
 *          on one model's word, so every judged field is *Check*, with the table's reason when it fails.
 *   2    — 2026-10-11, §7B A3: every field carries both model readers' values (lines matched by key) and
 *          the table's verdict; `not_read` where both read nothing, else `check` until graduation (D-DR5).
 *   3    — 2026-10-11, §7B A5: a hazmat line's count, weight and quantity also carry the OCR engine's
 *          row-bound word (PP-OCRv6 medium at the revision ocrModels.ts pins); statuses unchanged.
 *          A model or revision change there is a new rule, as this one was.
 *   4    — 2026-10-12, §7A N6: the table judges a line printed "Combustible liquid" with the §173.150(f)
 *          election the paper states, as the hazmat extractor's mapper always has (mapBolLines.ts) —
 *          under 3 every correctly printed combustible diesel line was a class mismatch.
 *   5    — 2026-10-13, §7B A4: a born-digital PDF's text layer is a second row-bound witness on a line's
 *          count, weight and quantity, beside the OCR (textLayerWitness.ts); statuses unchanged.
 *   6    — 2026-10-15, after D-DR24: a read with no hazmat line carries the OCR's and the text layer's scan of
 *          every read page for hazmat marks on `hazmat.lines` (hazmatMarkWitness.ts), the evidence the
 *          screen needs before it says "No hazardous materials"; statuses unchanged.
 *   7    — 2026-10-15, Q-DR26 L3: every row's count and weight, non-hazmat rows included (profile 1.3.0), carries
 *          the paper's own totals as the `arithmetic` witness (arithmeticWitness.ts), and the non-hazmat rows
 *          are matched reader to reader (alignOtherLines); statuses unchanged.
 *   8    — 2026-10-19: the table judges with PSN normalizer 1.1.0 (resolveLine.ts) — singular/plural on every
 *          word, and a number printed without UN/NA placed by its name — so under 7 "FLAMMABLE LIQUID, N.O.S."
 *          on UN1993 and a bare "1760, Corrosive liquid N.O.S." were refused; a cached read would replay that.
 *   9    — 2026-10-19, READER-CORRECTNESS-PLAN RC1: normalizer 1.2.0 — rows that share one name (UN1950
 *          Aerosols, UN1005 Ammonia, anhydrous …) are picked by the printed class, then PG (Q-RC3), where 8
 *          refused every correct printing of them; and the table's refs split at their last "#".
 *   10   — 2026-10-19, RC3: the readers' lines are paired in the paper's order and a line read with one misread
 *          digit is ONE line with its id in dispute (alignLines.ts), not two; the table judges pass B's
 *          reading of such a line too (`passB` on its verdict).
 *   11   — 2026-10-21, RC5: normalizer 1.3.0 — the table matches "Samples, explosive" (UN0190), which carries no
 *          class, to the Class 1 division its paper prints; 10 refused every correct printing of it.
 *   12   — 2026-10-21, Q-RC7: where the readers split on a line's UN/NA number, the OCR and the text layer record the
 *          reading the page settles — the table fits it and not the other, and the line's own printed row shows it
 *          (idWitness.ts) — and the paper audit judges the line as that number.
 *   13   — 2026-10-26, D-PC1: the table carries its subsidiary classes (column 6), so a line printed "8 (6.1)" resolves
 *          where 12 refused it (normalizer 1.4.0: the printed class picks the exactly printed row, "Class" may precede).
 */
export const ACCEPTANCE_RULE_VERSION = "13";

export interface CacheKeyInput {
  profileVersion: string;
  models: readonly string[];
  promptVersion: string;
  schemaHash: string;
  acceptanceRule: string;
  pages: readonly { sha256: string; normaliserVersion: string; rotation: number }[];
  sendRule: string;
  reviewEpoch: number;
}

export function readCacheKey(k: CacheKeyInput): string {
  const lines = [
    `profile=${k.profileVersion}`,
    `models=${k.models.join(",")}`,
    `prompt=${k.promptVersion}`,
    `schema=${k.schemaHash}`,
    `rule=${k.acceptanceRule}`,
    `pages=${k.pages.map((p) => `${p.sha256}@${p.normaliserVersion}@r${p.rotation}`).join(",")}`,
    `send=${k.sendRule}`,
    `reviews=${k.reviewEpoch}`,
  ];
  for (const l of lines) if (l.includes("\n")) throw new Error(`cache key term holds a newline: ${l.split("=")[0]}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
