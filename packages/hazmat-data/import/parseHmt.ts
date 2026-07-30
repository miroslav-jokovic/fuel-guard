/**
 * §172.101 HMT parser (Phase H1, deliverable 2 — the parse half).
 *
 * Turns the raw §172.101 XML (fetched by `EcfrClient.getFullXml`, captured by `captureFixtures.ts`)
 * into `HmtEntry[]`. This is the single hardest table in the regulation, and a mis-parse is a WRONG
 * VERDICT — so it is built against a CAPTURED REAL FIXTURE and frozen with hand-verified expectations
 * (see parseHmt.test.ts), never against a guessed XML structure.
 *
 * WHAT THE REAL eCFR "processed" XML actually is (verified against the captured
 * import/fixtures/section-172-101.xml, eCFR date 2026-07-28):
 *   - The section contains 6 HTML <TABLE>s. The HMT is the LARGEST (≈3,689 <TR>); the others are the
 *     two (c)(11) notes tables, Appendix A (haz-substances), the ERG-ID note, and Appendix B (marine
 *     pollutants). We pick the table with the most rows and assert a header signature before trusting it.
 *   - Two header <TR> (10 + 7 cells). Every DATA row has EXACTLY 14 <TD> and NO rowspan/colspan — eCFR
 *     FLATTENS the printed multi-PG entries: a PSN that spans PG I/II/III becomes one "lead" row (with
 *     symbols/PSN/class/ID filled) followed by continuation rows whose symbols/PSN/class/ID are BLANK
 *     and only the PG + downstream columns differ. So: a non-empty PSN cell STARTS a new entry; a blank
 *     PSN cell APPENDS another pgRow to the current entry. (Verified: 0 rows have a blank PSN but a
 *     non-blank ID, and 0 continuation rows carry a class/ID — the grouping is unambiguous.)
 *   - The 14 columns, in order: (0) Symbols, (1) PSN, (2) Hazard class, (3) ID number, (4) PG,
 *     (5) Label codes, (6) Special provisions, (7) 8A packaging-exceptions, (8) 8B non-bulk,
 *     (9) 8C bulk, (10) 9A passenger-aircraft/rail, (11) 9B cargo-aircraft, (12) 10A vessel location,
 *     (13) 10B vessel other.
 *   - The schema keeps `bulkPackagingRef` (8C) — correct for a fuel FLEET, which moves product in bulk
 *     cargo tanks. Columns 8A/8B carry real data (e.g. §173.150 / §173.202) but the frozen pgRow schema
 *     has no field for them, so they are intentionally not captured here (flagged as a schema decision).
 *   - Italic is a single element: <E T="03">…</E>. It does DOUBLE duty in the PSN column: an italic
 *     "or" separates legal 'or'-alternate names (§172.101(c)(10)); any OTHER italic run is descriptive
 *     text that is NOT part of the PSN (§172.101(c)(2)) — a qualifier ("with more than 10% ethanol"),
 *     a parenthetical ("(No. 1, 2, 4, 5, or 6)"), or a "see also" cross-reference. All such italic text
 *     is pulled out into `italicText`; for a "see …" cross-reference the roman text AFTER it (e.g.
 *     "Propane, see also Petroleum gases, liquefied") is a pointer, not the PSN, so it is dropped from
 *     the name too.
 *   - ID numbers are `UN####` or `NA####`. The schema's idPrefix is UN|NA only; the lone `ID8000`
 *     ("Consumer commodity") and the ~684 ID-less "Forbidden"/cross-reference index rows cannot be
 *     represented and are skipped (they are not shippable materials the engine matches on).
 *   - A UN/NA number is NOT unique: e.g. UN1202 appears at three alphabetical positions ("Diesel fuel",
 *     "Gas oil", "Heating oil, light") and NA1993 at five. Each is its own HmtEntry; `entryId` is a
 *     stable synthetic slug `${prefix}${number}-${psn-slug}` (deduped) — never the bare UN number.
 */

import { hmtEntrySchema, type HmtEntry, type PgRow } from "../src/schema.js";

// ------------------------------------------------------------------ XML helpers
// Same tolerant, dependency-free approach as import/referenceText.ts (no DOM, no deps).
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", deg: "°", sect: "§", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  thinsp: " ", ensp: " ", emsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Strip all XML tags from a fragment and normalize whitespace to single spaces. */
function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Pick the HMT table: the <TABLE> with the most <TR>, then confirm its header signature. */
function extractHmtTable(xml: string): string {
  const tables = xml.match(/<TABLE\b[^>]*>[\s\S]*?<\/TABLE>/gi) ?? [];
  let best: string | null = null;
  let bestRows = -1;
  for (const t of tables) {
    const rows = (t.match(/<TR\b/gi) ?? []).length;
    if (rows > bestRows) {
      bestRows = rows;
      best = t;
    }
  }
  if (!best) {
    throw new Error("parseHmtSection: no <TABLE> found in the §172.101 XML — wrong input or markup drift.");
  }
  const header = stripTags(best.slice(0, 6000)).toLowerCase();
  if (!header.includes("hazardous materials descriptions") || !header.includes("identification numbers")) {
    throw new Error(
      "parseHmtSection: the largest table does not carry the HMT header signature " +
        "('Hazardous materials descriptions' + 'Identification Numbers'). Refusing to parse the wrong table.",
    );
  }
  return best;
}

interface Cell {
  text: string;
  inner: string;
}
function cellsOf(trInner: string): Cell[] {
  const out: Cell[] = [];
  for (const m of trInner.matchAll(/<TD\b[^>]*>([\s\S]*?)<\/TD>/gi)) {
    const inner = m[1] ?? "";
    out.push({ text: stripTags(inner), inner });
  }
  return out;
}

// ------------------------------------------------------------------ PSN parsing
interface PsnParts {
  psnPrinted: string;
  psnAlternates: string[];
  italicText: string | null;
}

/** Trim, collapse whitespace, tidy spacing around punctuation, drop stray leading/trailing commas. */
function cleanFragment(s: string): string {
  let x = s.replace(/\s+/g, " ").trim();
  x = x.replace(/\s+([),;])/g, "$1").replace(/\(\s+/g, "(");
  return x.replace(/^[,;]+|[,;]+$/g, "").trim();
}

/**
 * Parse the PSN cell into the printed name, 'or'-alternates, and separated italic text.
 * Roman runs build the name; an italic "or" ends an alternate; an italic "see …" ends the name and
 * turns the remainder into a cross-reference note; any other italic run is a (c)(2) qualifier note.
 */
function parsePsnCell(inner: string): PsnParts {
  interface Run {
    italic: boolean;
    text: string;
  }
  const runs: Run[] = [];
  let pos = 0;
  for (const m of inner.matchAll(/<E\b[^>]*>([\s\S]*?)<\/E>/gi)) {
    const idx = m.index ?? 0;
    if (idx > pos) {
      const roman = stripTags(inner.slice(pos, idx));
      if (roman) runs.push({ italic: false, text: roman });
    }
    const it = stripTags(m[1] ?? "");
    runs.push({ italic: true, text: it });
    pos = idx + m[0].length;
  }
  if (pos < inner.length) {
    const roman = stripTags(inner.slice(pos));
    if (roman) runs.push({ italic: false, text: roman });
  }

  const alternates: string[] = [];
  const notes: string[] = [];
  let current = "";
  let crossref = false;
  const flush = (): void => {
    const c = cleanFragment(current);
    if (c) alternates.push(c);
    current = "";
  };
  for (const run of runs) {
    if (crossref) {
      notes.push(run.text);
      continue;
    }
    if (run.italic) {
      const low = run.text.trim().toLowerCase();
      if (low === "or") {
        flush();
      } else if (low.startsWith("see")) {
        flush();
        notes.push(run.text);
        crossref = true;
      } else {
        notes.push(run.text);
      }
    } else {
      current = current ? `${current} ${run.text}` : run.text;
    }
  }
  flush();

  return {
    psnPrinted: alternates[0] ?? "",
    psnAlternates: alternates.slice(1),
    italicText: notes.length ? notes.join(" ").replace(/\s+/g, " ").trim() || null : null,
  };
}

// ------------------------------------------------------------------ small utils
function splitList(s: string, re: RegExp): string[] {
  return s.split(re).map((x) => x.trim()).filter(Boolean);
}

function parseId(s: string): { prefix: "UN" | "NA"; number: string } | null {
  const m = /^(UN|NA)(\d{3,4})$/.exec(s.trim());
  if (!m) return null;
  return { prefix: m[1] as "UN" | "NA", number: m[2] as string };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const PACKING_GROUPS = new Set(["I", "II", "III"]);

// A mutable working entry before entryId is assigned + schema-validated.
interface DraftEntry {
  symbols: string[];
  psnPrinted: string;
  psnAlternates: string[];
  italicText: string | null;
  hazardClass: string | null;
  subsidiaryClasses: string[];
  idPrefix: "UN" | "NA";
  idNumber: string;
  pgRows: PgRow[];
}

// ------------------------------------------------------------------ main
/**
 * Parse the raw §172.101 XML into validated `HmtEntry[]`. Each entry is run through `hmtEntrySchema`,
 * so the return value is the engine's data boundary — it throws on any structural drift.
 */
export function parseHmtSection(xml: string): HmtEntry[] {
  const table = extractHmtTable(xml);
  const trs = [...table.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)].map((m) => m[1] ?? "");

  const drafts: DraftEntry[] = [];
  let current: DraftEntry | null = null;

  for (const tr of trs) {
    const cells = cellsOf(tr);
    if (cells.length !== 14) continue; // header rows (10/7 cells) or malformed — never a data row
    const texts = cells.map((c) => c.text);
    if (!texts.some(Boolean)) continue; // fully-empty spacer row

    const psnText = texts[1] ?? "";
    if (psnText) {
      const id = parseId(texts[3] ?? "");
      if (!id) {
        current = null; // Forbidden / ID8000 / cross-reference index row — not representable
        continue;
      }
      const psn = parsePsnCell(cells[1]?.inner ?? "");
      current = {
        symbols: splitList(texts[0] ?? "", /[\s,]+/),
        psnPrinted: psn.psnPrinted,
        psnAlternates: psn.psnAlternates,
        italicText: psn.italicText,
        hazardClass: (texts[2] ?? "") || null,
        subsidiaryClasses: [],
        idPrefix: id.prefix,
        idNumber: id.number,
        pgRows: [],
      };
      drafts.push(current);
    } else if (!current) {
      continue; // continuation row of a skipped entry
    }

    // Append a pgRow from this row (applies to both a lead row and a continuation row).
    const pgText = texts[4] ?? "";
    const labelText = (texts[5] ?? "").trim();
    const pgRow: PgRow = {
      pg: PACKING_GROUPS.has(pgText) ? (pgText as "I" | "II" | "III") : null,
      labelCodes: labelText.toLowerCase() === "none" ? [] : splitList(texts[5] ?? "", /,/),
      specialProvisions: splitList(texts[6] ?? "", /,/),
      bulkPackagingRef: (texts[9] ?? "") || null,
      quantityLimits: {
        passengerAircraftRail: (texts[10] ?? "") || null,
        cargoAircraft: (texts[11] ?? "") || null,
      },
      vesselStowage: {
        location: (texts[12] ?? "") || null,
        other: splitList(texts[13] ?? "", /,/),
      },
    };
    // `current` is guaranteed non-null here (set on a lead row, or the early-continue fired above).
    (current as DraftEntry).pgRows.push(pgRow);
  }

  // Stable synthetic entryId (UN numbers repeat across UN/NA/alphabetical variants).
  const seen = new Map<string, number>();
  const result: HmtEntry[] = [];
  for (const e of drafts) {
    const base = `${e.idPrefix}${e.idNumber}-${slugify(e.psnPrinted)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const entryId = n === 1 ? base : `${base}#${n}`;
    result.push(hmtEntrySchema.parse({ entryId, ...e }));
  }
  return result;
}
