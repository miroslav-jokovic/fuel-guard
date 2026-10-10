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
 *   pages              each page READ, in order: its original's sha256 and the normaliser that made it.
 *   reviewEpoch        how many reviews the source's reads hold. F-EX10: once a person has corrected a
 *                      read of these bytes, a new read must be a new read, not the corrected one replayed
 *                      as if nobody had looked. Reviews are append-only (0448), so the count only rises.
 *
 * The terms are joined as `name=value` lines in this fixed order, so no two different inputs can join to
 * the same string (no term holds a newline: versions and hashes are generated, and a model id is a pin).
 */
export const ACCEPTANCE_RULE_VERSION = "none";

export interface CacheKeyInput {
  profileVersion: string;
  models: readonly string[];
  promptVersion: string;
  schemaHash: string;
  acceptanceRule: string;
  pages: readonly { sha256: string; normaliserVersion: string }[];
  reviewEpoch: number;
}

export function readCacheKey(k: CacheKeyInput): string {
  const lines = [
    `profile=${k.profileVersion}`,
    `models=${k.models.join(",")}`,
    `prompt=${k.promptVersion}`,
    `schema=${k.schemaHash}`,
    `rule=${k.acceptanceRule}`,
    `pages=${k.pages.map((p) => `${p.sha256}@${p.normaliserVersion}`).join(",")}`,
    `reviews=${k.reviewEpoch}`,
  ];
  for (const l of lines) if (l.includes("\n")) throw new Error(`cache key term holds a newline: ${l.split("=")[0]}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
