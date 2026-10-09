/**
 * Reading a line's printed description as one string (`PrintedPaperLine.descriptionText`) — where its id,
 * shipping name, class and packing group stand, and what is printed between them. Two rules need it:
 * §172.202(b)'s sequence and §172.203(b)'s "following the basic description". Quotes are eCFR's text of
 * 2026-10-09.
 *
 * Each element is located from the reader's OWN transcription of that element (`idText`, `psn`,
 * `hazardClass`, `pg`), so nothing is re-read from the text; when a transcribed value cannot be found in
 * the text at all the answer is "unmatched" and the rule cannot tell.
 */
import type { PrintedPaperLine } from "./paperTypes.js";
import { blank } from "./paperSupport.js";

interface Span { start: number; end: number }
export type DescriptionLayout =
  | { kind: "in_sequence"; end: number }
  | { kind: "out_of_order" }
  | { kind: "interspersed"; text: string }
  | { kind: "unmatched" };

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whitespace in the transcription matches any whitespace (or none) in the text. */
const flex = (s: string): string => esc(s.trim()).replace(/\s+/g, "\\s*");

function idPattern(idText: string): RegExp {
  const m = /^\s*(UN|NA)\s*(\d+)\s*$/i.exec(idText);
  return m ? new RegExp(`(?<![A-Za-z0-9])${m[1]}\\s*${m[2]}(?!\\d)`, "i") : new RegExp(`(?<![\\w.])${flex(idText)}(?![\\w.])`, "i");
}
const plain = (s: string): RegExp => new RegExp(flex(s), "i");
const token = (s: string): RegExp => new RegExp(`(?<![\\w.])${flex(s)}(?![\\w.])`, "i");
/** §172.202(a)(4): "The packing group may be preceded by the letters "PG"". */
const pgPattern = (pg: string): RegExp => new RegExp(`(?<![A-Za-z])(?:PG\\s*)?${pg}(?![A-Za-z])`, "i");

function find(rx: RegExp, text: string, from: number): Span | null {
  const m = rx.exec(text.slice(from));
  return m ? { start: from + m.index, end: from + m.index + m[0].length } : null;
}

/**
 * §173.2 Table 1's class and division names, verbatim — the vocabulary §172.202(a)(3)(iii) lets a domestic
 * paper print after the class number ("hazard class or division names may be entered following the
 * numerical hazard class or division").
 */
const CLASS_NAMES_173_2 = [
  "EXPLOSIVES (WITH A MASS EXPLOSION HAZARD)", "EXPLOSIVES (WITH A PROJECTION HAZARD)", "EXPLOSIVES (WITH PREDOMINATELY A FIRE HAZARD)",
  "EXPLOSIVES (WITH NO SIGNIFICANT BLAST HAZARD)", "VERY INSENSITIVE EXPLOSIVES; BLASTING AGENTS", "EXTREMELY INSENSITIVE DETONATING SUBSTANCES",
  "FLAMMABLE GAS", "NON-FLAMMABLE COMPRESSED GAS", "POISONOUS GAS", "FLAMMABLE AND COMBUSTIBLE LIQUID", "FLAMMABLE SOLID",
  "SPONTANEOUSLY COMBUSTIBLE MATERIAL", "DANGEROUS WHEN WET MATERIAL", "OXIDIZER", "ORGANIC PEROXIDE", "POISONOUS MATERIALS",
  "INFECTIOUS SUBSTANCE (ETIOLOGIC AGENT)", "RADIOACTIVE MATERIAL", "CORROSIVE MATERIAL", "MISCELLANEOUS HAZARDOUS MATERIAL",
];
const CLASS_NAME_WORDS = new Set(CLASS_NAMES_173_2.flatMap((n) => n.toLowerCase().split(/[^a-z-]+/)).filter(Boolean));

/** What may stand in each gap of the basic description without being "additional information interspersed". */
function leftover(gap: string, allowed: "before_psn" | "before_class" | "before_pg"): string {
  let s = gap;
  if (allowed === "before_psn") {
    // §172.203(n): "the word "HOT" must immediately precede the proper shipping name"; §172.101(c)(9): the
    // word "Waste" "preceding the proper shipping name" of a hazardous waste.
    s = s.replace(/\b(HOT|Waste)\b/gi, " ");
  } else {
    // §172.202(d): "Technical and chemical group names may be entered in parentheses between the proper
    // shipping name and hazard class"; §172.202(a)(3): subsidiary classes "in parentheses immediately
    // following the primary"; (a)(3)(i): "The words "Class" or "Division" may be included preceding".
    s = s.replace(/\([^)]*\)/g, " ").replace(/\b(Class|Division)\b/gi, " ");
    if (allowed === "before_pg") s = s.split(/(\s+|[,;:])/).filter((w) => !CLASS_NAME_WORDS.has(w.toLowerCase())).join("");
  }
  return s.replace(/[\s,;:]+/g, " ").trim();
}

/**
 * Locate id → PSN → class → PG in order. §172.202(b): "the basic description specified in paragraphs
 * (a)(1), (2), (3), and (4) of this section must be shown in sequence with no additional information
 * interspersed". Anything may stand before the id (quantity and packaging, §172.202(c)(1); "RQ",
 * §172.203(c)(2) "either before or after") or after the PG (§172.201(a)(4)). An element the line does not
 * carry (no PG on a gas, no class on "Combustible liquid, n.o.s." per (a)(3)(ii)) is skipped.
 */
export function layoutDescription(line: PrintedPaperLine): DescriptionLayout {
  const text = line.descriptionText ?? "";
  const parts: Array<{ rx: RegExp; gap: "before_psn" | "before_class" | "before_pg" | null }> = [];
  if (!blank(line.idText)) parts.push({ rx: idPattern(line.idText!), gap: null });
  if (!blank(line.psn)) parts.push({ rx: plain(line.psn!), gap: "before_psn" });
  if (!blank(line.hazardClass)) parts.push({ rx: token(line.hazardClass!), gap: "before_class" });
  if (line.pg) parts.push({ rx: pgPattern(line.pg), gap: "before_pg" });
  if (parts.some((p) => !p.rx.test(text))) return { kind: "unmatched" };
  // Order first: every element found after the one before it. Only then are the gaps between them read.
  const spans: Span[] = [];
  for (const part of parts) {
    const span = find(part.rx, text, spans.length ? spans[spans.length - 1]!.end : 0);
    if (!span) return { kind: "out_of_order" };
    spans.push(span);
  }
  for (let i = 1; i < parts.length; i++) {
    const extra = leftover(text.slice(spans[i - 1]!.end, spans[i]!.start), parts[i]!.gap!);
    if (extra) return { kind: "interspersed", text: extra };
  }
  return { kind: "in_sequence", end: spans.length ? spans[spans.length - 1]!.end : 0 };
}
