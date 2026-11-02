/**
 * Key-sorted JSON: two values that differ only in key order serialise identically, so a hash over
 * this text is a hash of the value, not of how it happened to be built. Arrays keep their order —
 * `required` and `enum` order in a schema, or the order of a prompt's messages, is meaning, not noise.
 *
 * One definition for new callers. Moved here from the document reader's `wireSchema.ts` (ads A4,
 * 2026-11-01), where the reader's schema hash and cache key already used it, so the ads rail's input
 * hash and `aiInputHash` could read the same function instead of a fourth copy. Two older private
 * copies remain (`anomalies/scoring/persist.ts`, `hazmat/hazmatAnalysis.ts`); their hashes are
 * stored, so folding them in is a change to check against stored rows, not a refactor to slip in here.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
