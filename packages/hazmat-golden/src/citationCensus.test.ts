import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCitations, normaliseCfrText, parseCitation } from "@hazmat/data";
import { emittedCitations } from "./emittedCitations.js";

/**
 * The citation census (TWO-CLICK-READER-PLAN TC0.5, D-TC10): every `cfr` the engine emits is a paragraph a person
 * has said what it must say, and eCFR was read to say it.
 *
 * Two of them did not. DANGEROUS WHEN WET was cited as §172.505(b) — uranium hexafluoride — from 2026-08 to 2026-10-29
 * (E4), on the verdict chip and in the defense packet; and a bulk line's ID number as §172.302(c) — special-permit
 * packagings — where the rule is §172.302(a). Both paragraphs exist, so a check that a citation EXISTS passes them.
 * What fails them is the list's `mustSay`: the words the paragraph must contain for the engine's use to be right,
 * checked against eCFR by `@hazmat/data import/citationsBuild.ts`, which refused both on 2026-10-29.
 *
 * Here: the engine may emit no string outside the list, whether a load reaches it (`emittedCitations`, the whole
 * table) or it only sits in the source; the list may hold no string the engine no longer emits; and each entry's
 * stored evidence still says its phrases at the paragraph its citation names.
 */
const list = loadCitations();
const listed = new Set([...list.citations.map((c) => c.cfr), ...list.internal.map((c) => c.cfr)]);
const emitted = emittedCitations();

const ENGINE_SRC = new URL("../../hazmat-engine/src/", import.meta.url).pathname;
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sourceFiles(join(dir, d.name)) : d.name.endsWith(".ts") && !d.name.endsWith(".test.ts") ? [join(dir, d.name)] : []);
}
/** Every literal citation in the engine's source, including ones no load of the sweep reaches. */
const literals = new Map<string, string>();
for (const f of sourceFiles(ENGINE_SRC)) {
  for (const m of readFileSync(f, "utf8").matchAll(/"(49 CFR [^"]*|internal: [^"]*)"/g)) literals.set(m[1]!, f.slice(ENGINE_SRC.length));
}

describe("the citation census — every cfr the engine emits is verified (TC0.5, D-TC10)", () => {
  it("reaches the engine's citations from the whole table", () => {
    expect(emitted.size).toBeGreaterThan(50);
  });

  it("emits no citation outside the verified list, on any load of the sweep", () => {
    expect([...emitted].filter(([cfr]) => !listed.has(cfr)).map(([cfr, where]) => `${cfr} ← ${where}`)).toEqual([]);
  });

  it("holds no citation in its source outside the verified list", () => {
    expect([...literals].filter(([cfr]) => !listed.has(cfr)).map(([cfr, f]) => `${cfr} in ${f}`)).toEqual([]);
  });

  it("lists nothing the engine no longer emits", () => {
    expect([...listed].filter((cfr) => !emitted.has(cfr) && !literals.has(cfr))).toEqual([]);
  });

  it("keeps, for every entry, eCFR's words at the paragraph it names, saying every phrase it must", () => {
    expect(list.ecfrDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const bad: string[] = [];
    for (const c of list.citations) {
      const { sectionNumber, designators } = parseCitation(c.cfr);
      const paragraph = designators.map((d) => `(${d})`).join("") || null;
      if (c.section !== sectionNumber || c.paragraph !== paragraph || !c.excerpt || !c.source) bad.push(`${c.cfr}: not built — run import/citationsBuild.ts`);
      else if (!normaliseCfrText(c.excerpt).includes(normaliseCfrText(c.mustSay[0]!))) bad.push(`${c.cfr}: the excerpt does not say ${c.mustSay[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("cites DANGEROUS WHEN WET at §172.505(c) and a bulk ID number at §172.302(a) — the two corrected on 2026-10-29", () => {
    expect(emitted.has("49 CFR 172.505(c)")).toBe(true);
    expect(emitted.has("49 CFR 172.302(a)")).toBe(true);
    for (const wrong of ["49 CFR 172.505(b)", "49 CFR 172.302(c)"]) {
      expect(emitted.has(wrong)).toBe(false);
      expect(listed.has(wrong)).toBe(false);
    }
  });
});
