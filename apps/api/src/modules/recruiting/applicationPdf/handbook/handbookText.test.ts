import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { HANDBOOK_PLACEMENTS } from "@silvicom/shared";
import { handbookParagraphs, handbookWords } from "../../../../testing/handbookDocx.js";
import { HANDBOOK_BLOCKS, HANDBOOK_VERSION, type HandbookBlock } from "./handbookText.js";

/**
 * The handbook text against the carrier's own file (D-HB4: *"pull this text exactly"*).
 *
 * ⚠ What "exactly" is proved as, and why two assertions: the WORDS must be the same multiset — every
 * word the carrier wrote, typos included, the same number of times, nothing added — and the flowing
 * text must be in the carrier's ORDER. The order check leaves out the signature captions, because the
 * layout legitimately regroups those (block 4's `Date:` caption sits beside its rule, not above the
 * `Agreed:` line); every one of their words is still in the multiset.
 */

const blockWords = (b: HandbookBlock): string[] => {
  if (b.k === "p") return handbookWords(b.runs.map((r) => r.t).join(""));
  // Runs join with NOTHING — Word splits `Flying J` and its `.` into two runs — and only the head and
  // the body are separate, as Word's line break between them made them.
  if (b.k === "rule") return handbookWords(`${b.title.map((r) => r.t).join("")} ${b.body.map((r) => r.t).join("")}`);
  if (b.k === "table") {
    return [...(b.head ?? []).flatMap(handbookWords), ...b.rows.flatMap((r) => [...r.item, ...r.fine].flatMap(handbookWords))];
  }
  if (b.k === "sign") return b.fields.flatMap((f) => handbookWords(f.label));
  return [];
};

const count = (words: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

describe("the handbook text is the carrier's", () => {
  const source = handbookParagraphs();

  it("reads the carrier's file (a reader that found nothing would pass everything below)", () => {
    expect(source.length).toBeGreaterThan(200);
    expect(source.join(" ")).toContain("SAFETY STANDARDS AND POLICIES RECEIPT");
  });

  it("has every word the carrier wrote, the same number of times, and none of its own", () => {
    const ours = count(HANDBOOK_BLOCKS.flatMap(blockWords));
    const theirs = count(source.flatMap(handbookWords));
    const missing = [...theirs].filter(([w, n]) => (ours.get(w) ?? 0) < n).map(([w]) => w);
    const added = [...ours].filter(([w, n]) => (theirs.get(w) ?? 0) < n).map(([w]) => w);
    expect(missing).toEqual([]);
    expect(added).toEqual([]);
  });

  it("keeps the carrier's order for everything that is not a signature caption", () => {
    const labels = HANDBOOK_BLOCKS.flatMap((b) => (b.k === "sign" ? b.fields.map((f) => f.label) : []));
    const captionLine = new Set<string>();
    for (const a of labels) {
      captionLine.add(handbookWords(a).join(" "));
      for (const b of labels) captionLine.add([...handbookWords(a), ...handbookWords(b)].join(" "));
    }
    // ⚠ A caption is a caption only NEAR a signature rule (a paragraph of underscores, within two
    // non-empty paragraphs). `Silvicom Inc` is block 4's countersignature caption AND the first line of
    // the memo's letterhead; a filter that matched text alone dropped the letterhead and hid it.
    // Non-blank RAW paragraphs: a rule is often a paragraph of nothing but underscores, which has no
    // words, and filtering by words first would hide every rule from `nearRule`.
    const lines = source.filter((p) => p.trim().length > 0);
    const nearRule = (i: number): boolean =>
      lines.slice(Math.max(0, i - 2), i + 3).some((p) => /_{3,}/.test(p));
    const theirs = lines
      .map((p, i) => ({ words: handbookWords(p).join(" "), i }))
      .filter(({ words, i }) => !(captionLine.has(words) && nearRule(i)))
      .map(({ words }) => words)
      .filter((w) => w.length > 0)
      .join(" ");
    const ours = HANDBOOK_BLOCKS.filter((b) => b.k !== "sign").flatMap(blockWords).join(" ");
    expect(ours).toBe(theirs);
  });

  it("keeps the carrier's typing (D-PKT11)", () => {
    const all = HANDBOOK_BLOCKS.flatMap(blockWords).join(" ");
    for (const typo of ["COMPNAY", "THA", "TEMINATION", "FLASIFICATION", "forgoing"]) expect(all).toContain(typo);
  });

  it("has exactly one signature place per placement, in the placements' order", () => {
    const ids = HANDBOOK_BLOCKS.flatMap((b) => (b.k === "sign" ? [b.id] : []));
    expect(ids).toEqual(HANDBOOK_PLACEMENTS.map((p) => p.id));
  });

  it("versions itself from its own text, so an edit cannot keep the old version", () => {
    const hash = createHash("sha256").update(JSON.stringify(HANDBOOK_BLOCKS)).digest("hex").slice(0, 16);
    expect(HANDBOOK_VERSION).toBe(`hb-${hash}`);
  });
});
