import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { countLabelFor, singularLabel } from "./plural";

/**
 * The guarantee behind `lib/plural.ts` (D-DS1's "one primitive per job", applied to its copy).
 *
 * ── WHY THE CORPUS IS READ OUT OF THE SOURCE ────────────────────────────────────────────────────
 * English singularisation cannot be computed: `-ies → -y` is right for "entries" and wrong for
 * "movies"; a `-ves → -f` rule is right for "shelves" and wrong for "valves". So a rule set that
 * looks reasonable will eventually render a word wrong on one page, in a component 41 surfaces
 * share, and nobody will be looking at that page when it happens.
 *
 * The rules are therefore not trusted — they are CHECKED, against every `count-label` that actually
 * exists in this app. `EXPECTED` below is the whole shipped vocabulary with the singular a person
 * confirmed, and the scan asserts the two sets are equal in both directions. A new call site whose
 * noun the rules get wrong fails here with the noun named; a vocabulary entry for a label nobody
 * passes any more fails too, so the table shrinks as pages change.
 *
 * The shape is `routeReachability.test.ts`'s and the reasoning is the same one `check-surfaces.mjs`
 * records: a detector that silently matches nothing is worse than no detector, so the scan asserts
 * it found the call sites before it asserts anything about them.
 */

const WEB_SRC = path.join(process.cwd(), "src");

/**
 * Call sites whose label is built in `<script>` and passed through a variable, so no scan of the
 * template can read it. Each entry is a claim that a person opened that file and listed what it can
 * produce; the scan below FAILS on an unresolvable call site that is not named here, because a
 * detector that quietly skips what it cannot parse is worse than no detector (`check-surfaces.mjs`
 * records the same reasoning about its own parser).
 */
const FROM_SCRIPT: Record<string, string[]> = {
  // `barCount` switches on the open tab — three labels, one per tab.
  "pages/FuelReconciliationPage.vue": ["fills", "fills in sequence", "statements"],
};

interface Scan {
  labels: Set<string>;
  /** Files with a bound `:count-label` this scan could not resolve to literals. */
  unresolvable: Set<string>;
  /** How many call sites were seen at all — the guard against a parser that matches nothing. */
  sites: number;
}

/** Every `count-label` value in the app: static, inline-ternary, and declared-from-script. */
function scanSource(): Scan {
  const labels = new Set<string>();
  const unresolvable = new Set<string>();
  let sites = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".vue")) {
        const src = readFileSync(p, "utf8");
        const rel = path.relative(WEB_SRC, p).split(path.sep).join("/");
        // `count-label="entries"` — the static form, which is most of them.
        for (const m of src.matchAll(/(?<!:)\bcount-label="([^"{}]+)"/g)) {
          sites += 1;
          labels.add(m[1]!);
        }
        // `:count-label="lowOnly ? 'shelves' : 'parts'"` — every string literal in a bound value.
        for (const m of src.matchAll(/:count-label="([^"]+)"/g)) {
          sites += 1;
          const literals = [...m[1]!.matchAll(/'([^']+)'/g)].map((lit) => lit[1]!);
          if (literals.length === 0) unresolvable.add(rel);
          for (const lit of literals) labels.add(lit);
        }
      }
    }
  };
  walk(WEB_SRC);

  /**
   * FilterBar's own default is a shipped label too — a caller that passes `:count` and no
   * `count-label` renders it, and "1 results" is the very thing this file exists to stop. No page
   * relies on it today (measured 2026-09-09), which is exactly why nothing else would cover it.
   */
  const bar = readFileSync(path.join(WEB_SRC, "components/ui/FilterBar.vue"), "utf8");
  const fallback = bar.match(/countLabel:\s*"([^"]+)"/)?.[1];
  if (!fallback) throw new Error("FilterBar's countLabel default not found — fix this parser with the component");
  sites += 1;
  labels.add(fallback);

  for (const [file, declared] of Object.entries(FROM_SCRIPT)) {
    for (const label of declared) labels.add(label);
    unresolvable.delete(file);
  }
  return { labels, unresolvable, sites };
}

/**
 * The shipped vocabulary. Every entry was read at 1 and confirmed by a person.
 *
 * ⚠ Three of these are the reason the rules are shaped the way they are, and they disagree with
 * each other: "truck stops" pluralises its LAST word, "segments loaded" and "fills in sequence"
 * pluralise their FIRST, and "shelves" cannot be derived at all.
 */
const EXPECTED: Record<string, string> = {
  alerts: "alert",
  assets: "asset",
  units: "unit",
  applicants: "applicant",
  cards: "card",
  changes: "change",
  contractors: "contractor",
  declines: "decline",
  dispatchers: "dispatcher",
  drivers: "driver",
  entries: "entry",
  events: "event",
  files: "file",
  "fill-ups": "fill-up",
  fills: "fill",
  "fills in sequence": "fill in sequence",
  findings: "finding",
  inspections: "inspection",
  inspectors: "inspector",
  invoices: "invoice",
  jurisdictions: "jurisdiction",
  loads: "load",
  parts: "part",
  plans: "plan",
  readings: "reading",
  requirements: "requirement",
  // FilterBar's default, for a caller that passes a count and no label of its own.
  results: "result",
  rows: "row",
  "segments loaded": "segment loaded",
  shelves: "shelf",
  statements: "statement",
  trailers: "trailer",
  transactions: "transaction",
  "truck stops": "truck stop",
  trucks: "truck",
  vehicles: "vehicle",
};

describe("the shipped count labels", () => {
  const { labels: scanned, unresolvable, sites } = scanSource();

  it("finds them, so this file cannot pass by scanning nothing", () => {
    expect(sites).toBeGreaterThan(35);
    expect(scanned.size).toBeGreaterThan(25);
    expect(scanned).toContain("transactions");
    // …and it reads the bound form too, or the two dynamic call sites would go unchecked.
    expect(scanned).toContain("shelves");
    expect(scanned).toContain("fills in sequence");
  });

  it("cannot skip a call site it failed to parse", () => {
    expect(
      [...unresolvable].sort(),
      "bound :count-label values with no string literal — list what each can produce in FROM_SCRIPT",
    ).toEqual([]);
  });

  it("has a confirmed singular for every one of them", () => {
    const unlisted = [...scanned].filter((l) => !(l in EXPECTED)).sort();
    expect(unlisted, "new count-labels — add each with the singular a person confirmed").toEqual([]);
  });

  it("keeps the vocabulary honest — no entry for a label nothing passes", () => {
    const stale = Object.keys(EXPECTED).filter((l) => !scanned.has(l)).sort();
    expect(stale, "entries for labels no page uses any more — ratchet down").toEqual([]);
  });

  it("renders every one of them correctly at one", () => {
    const wrong = Object.entries(EXPECTED)
      .filter(([plural, one]) => countLabelFor(1, plural) !== one)
      .map(([plural, one]) => `${plural} → ${countLabelFor(1, plural)} (expected ${one})`);
    expect(wrong).toEqual([]);
  });

  it("leaves every one of them plural at zero and at many", () => {
    for (const plural of Object.keys(EXPECTED)) {
      // "0 results", never "0 result" — which is English, and is what these bars render today.
      expect(countLabelFor(0, plural)).toBe(plural);
      expect(countLabelFor(2, plural)).toBe(plural);
      expect(countLabelFor(1204, plural)).toBe(plural);
    }
  });
});

/**
 * The rules themselves, including the words they must NOT touch. These are the cases that make the
 * corpus scan above necessary rather than merely thorough — each one is a word a plausible simpler
 * rule gets wrong.
 */
describe("the singularisation rules", () => {
  it("does not maim a word that ends in s and is already singular", () => {
    // A bare `-s → ""` rule turns each of these into a non-word.
    expect(singularLabel("status")).toBe("status");
    expect(singularLabel("analysis")).toBe("analysis");
    expect(singularLabel("progress")).toBe("progress");
  });

  it("drops the `es` only where it is the plural marker", () => {
    expect(singularLabel("boxes")).toBe("box");
    expect(singularLabel("matches")).toBe("match");
    expect(singularLabel("dashes")).toBe("dash");
    // …and not where the `e` belongs to the stem.
    expect(singularLabel("invoices")).toBe("invoice");
    expect(singularLabel("changes")).toBe("change");
  });

  it("takes the head noun from a phrase, wherever in it the plural word is", () => {
    // The two shipped phrases disagree about this, which is why the rule is "the last plural word"
    // rather than the first word or the last.
    expect(singularLabel("truck stops")).toBe("truck stop");
    expect(singularLabel("segments loaded")).toBe("segment loaded");
    expect(singularLabel("fills in sequence")).toBe("fill in sequence");
  });

  it("leaves a label with no plural word in it alone", () => {
    expect(singularLabel("stock on hand")).toBe("stock on hand");
  });

  /**
   * The irregulars table earns its place here. `shelves` is the shipped word; `valves` is why the
   * `-ves → -f` rule that would derive it cannot be written as a rule.
   */
  it("names the words it cannot derive, rather than deriving them wrongly", () => {
    expect(singularLabel("shelves")).toBe("shelf");
    expect(singularLabel("valves")).toBe("valve");
  });
});
