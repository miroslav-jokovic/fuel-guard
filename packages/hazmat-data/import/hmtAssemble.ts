/**
 * Shared §172.101 HMT assembly (Phase H1, D5 v7).
 *
 * The HMT is rendered by TWO official sources in the SAME logical shape — 14 columns in the same order
 * (Symbols, PSN, Hazard class, ID, PG, Label codes, Special provisions, 8A/8B/8C packaging, 9A/9B
 * quantity, 10A/10B vessel) with the same `<E T="03">` italic convention in the PSN column — but in two
 * DIFFERENT markups: eCFR "processed" HTML (`<TABLE>/<TR>/<TD>`) and the official GovInfo GPO edition
 * (`<GPOTABLE>/<ROW>/<ENT>`). The regulation semantics (§172.101(c) 'or'-alternates, italic (c)(2) text,
 * the flattened multi-PG continuation grouping, the UN/NA id split) are IDENTICAL for both and live here;
 * the format-specific extraction (which table, and how to tokenize a row into 14 cells) lives in the two
 * thin callers `parseHmt.ts` (eCFR) and `parseHmtGovInfo.ts` (GovInfo).
 *
 * Why the split matters for the D5 cross-check: this shared layer is pinned by the frozen HUMAN-verified
 * `parseHmt.test.ts` (ground-truth field values), while the per-format EXTRACTION layer — the layer where
 * a transport/markup parse error actually occurs — is what the automated eCFR↔GovInfo triangulation
 * independently exercises. The two mechanisms cover the two layers.
 */

import { hmtEntrySchema, type HmtEntry, type PgRow } from "../src/schema.js";

// ------------------------------------------------------------------ XML helpers
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", deg: "°", sect: "§", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  thinsp: " ", ensp: " ", emsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Strip all XML tags from a fragment and normalize whitespace to single spaces. */
export function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export interface Cell {
  text: string;
  inner: string;
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
export function parsePsnCell(inner: string): PsnParts {
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

/**
 * Assemble validated `HmtEntry[]` from rows that have ALREADY been tokenized into exactly 14 cells each
 * (both callers normalize to 14 — eCFR emits only 14-<TD> data rows; GovInfo pads its trailing-omitted
 * <ENT> cells). The grouping is the flattened-multi-PG model: a non-empty PSN cell with a valid ID STARTS
 * a new entry; a blank PSN cell APPENDS a pgRow to the current entry; a non-empty PSN with no valid ID
 * (Forbidden / ID8000 / "see" cross-reference index rows) is not a shippable entry and resets `current`.
 */
export function assembleHmtEntries(rows: Cell[][]): HmtEntry[] {
  const drafts: DraftEntry[] = [];
  let current: DraftEntry | null = null;

  for (const cells of rows) {
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
