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
 */
export const ACCEPTANCE_RULE_VERSION = "2";

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
