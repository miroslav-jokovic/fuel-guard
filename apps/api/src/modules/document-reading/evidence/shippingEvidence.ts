import { leafFieldPaths, valueAtPath, valuesAgree, type FieldEvidence, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { alignLines, alignOtherLines } from "./alignLines.js";
import { arithmeticWitness } from "./arithmeticWitness.js";
import { certificationShown } from "./certificationWitness.js";
import { hazmatMarks } from "./hazmatMarkWitness.js";
import { HMT_JUDGED_KEYS, hmtVerdict, type HmtVerdict } from "./hmtWitness.js";
import { settledDescription, settledId, type SettledId } from "./idWitness.js";
import { anchorOf, classTokens, ROW_JUDGED_KEYS, rowBacks, rowCanJudge, rowOf, type OcrPage, type Row } from "./rowWitness.js";

/**
 * A shipping document's evidence (§7B, D-DR19): for every field, what each witness said.
 *
 *   passA   the locked reader (Sonnet 4.6, D-DR20) — the document the read returns.
 *   passB   the second reader (Sonnet 5.5, Q-DR23), its hazmat lines matched to A's by key (alignLines.ts).
 *           Absent when pass B produced no document (a refusal, a truncation) or has no partner line —
 *           absence is one reader, never agreement.
 *   table   the Hazardous Materials Table's verdict on the line, on its id, PSN, class and PG (A2) — and, under
 *           `passB`, its verdict on pass B's reading of the same line where the two readers differ there (RC3).
 *   ocr     the OCR engine's word on a line's count, weight and quantity (A5, rowWitness.ts): which of the
 *           readers' values is printed on the row of the line's own UN id. Absent when there was no OCR
 *           (engine off, failed, or a cache replay of a read made without it) or the row is ambiguous.
 *   textLayer a born-digital PDF's own characters on the same row, by the same rules (A4,
 *           textLayerWitness.ts). Absent unless every read page carries a text layer.
 *   ocr / textLayer on a line's idText and descriptionText, only where the readers split on its UN/NA number: the
 *           reading the page settles — the table fits it and not the other, and the line's own printed row shows
 *           it (idWitness.ts, Q-RC7). Nothing otherwise: these witnesses never say an identifying reading is wrong.
 *   arithmetic the paper's own totals, on every row's count and weight (Q-DR26 L3, arithmeticWitness.ts):
 *           the reading the totals back, or null where no reading of the rows fits them. Absent where the
 *           totals cannot tell (two readings both fit; a total in dispute; no total printed).
 *
 * The non-hazmat rows (`otherLines`, profile 1.3.0) are matched the same way, by their own rule (`alignOtherLines`:
 * in order when both read as many, else by an exactly agreeing description), and a row only pass B saw is
 * recorded after pass A's last. Their count and weight carry no row witness: a row has no UN id to anchor on.
 *
 * When pass A reads NO hazmat line, `hazmat.lines` is itself a leaf (the empty list), and the same two
 * engines are its witnesses too: each records the hazmat marks — UN/NA ids, RQ, an X in the HM column — it
 * finds anywhere on the read pages (hazmatMarkWitness.ts), so [] backs the empty list and anything else is a
 * page that prints what the readers did not read. Absent, as on a line, when there was no OCR or text layer.
 *
 * On `hazmat.shipperCertification` the same two engines record `true` where the page prints every word of a
 * §172.204 statement (certificationWitness.ts, R-M3) — and NOTHING otherwise: they can back "present", never
 * say "absent", so a page they could not read leaves the field to the readers alone.
 *
 * Status under rule 2: `not_read` when both readers read nothing there; otherwise `check`. Agreement is
 * RECORDED, not yet acted on: a field moves to *Read* only by graduation (D-DR5 — N confirmations with no
 * correction under one rule, switched on per org by the owner, Step 4.3), and graduation counts exactly
 * these records. `readersAgree` (fieldEvidenceContract.ts) is how the screen tells "both readers say 6"
 * from "they say 6 and 9".
 */

const LINE_RX = /^hazmat\.lines\[(\d+)\]\.(.+)$/;
const OTHER_RX = /^otherLines\[(\d+)\]\./;
type Doc = Pick<ShippingDocument, "hazmat"> & Partial<Pick<ShippingDocument, "otherLines" | "freight">>;

export function shippingEvidence(
  a: Doc,
  b: Doc | null,
  ruleVersion: string,
  ocr: readonly OcrPage[] | null = null,
  textLayer: readonly OcrPage[] | null = null,
): FieldEvidence[] {
  const aLines = a.hazmat?.lines ?? [];
  const { aligned, extra } = b ? alignLines(aLines, b.hazmat?.lines ?? []) : { aligned: aLines.map(() => null), extra: [] };
  const aOther = a.otherLines ?? [];
  const other = b ? alignOtherLines(aOther, b.otherLines ?? []) : { aligned: aOther.map(() => null), extra: [] };
  // Pass B as it would read at pass A's positions; its unpaired lines and rows after A's last.
  const bAtA = b
    ? { ...b, hazmat: { ...b.hazmat, lines: [...aligned, ...extra] }, otherLines: [...other.aligned, ...other.extra] }
    : null;
  const verdicts = new Map<number, HmtVerdict & { passB?: HmtVerdict }>();
  // The table judges pass B's reading of a paired line too, when the two differ on what identifies it
  // (RC3): with one digit misread, ONE of the readings usually fits the printed name and class, and the
  // calculator can offer that one for a person to confirm instead of only saying the line does not match.
  const judged = (l: PrintedHazmatLine) => HMT_JUDGED_KEYS.map((k) => l[k] ?? null);
  const verdictOf = (i: number, line: PrintedHazmatLine) => {
    if (verdicts.has(i)) return verdicts.get(i)!;
    const own = hmtVerdict(line);
    const other = i < aLines.length ? aligned[i] : null;
    const v = other && !valuesAgree(judged(line), judged(other)) ? { ...own, passB: hmtVerdict(other) } : own;
    verdicts.set(i, v);
    return v;
  };
  const lineAt = (i: number) => (i < aLines.length ? aLines[i] : extra[i - aLines.length])!;
  // The row of line i: the nth printed occurrence of its id, n = how many lines before it carry the same id.
  const allLines = [...aLines, ...extra];
  const rowsOver = (pages: readonly OcrPage[] | null) => {
    const rows = new Map<number, Row | null>();
    return (i: number): Row | null => {
      if (!pages) return null;
      if (!rows.has(i)) {
        const id = anchorOf(lineAt(i).idText);
        const same = allLines.filter((l) => id !== null && anchorOf(l.idText) === id);
        rows.set(i, rowOf(pages, id, allLines.slice(0, i).filter((l) => same.includes(l)).length, same.length));
      }
      return rows.get(i)!;
    };
  };
  // Each row witness in the order its source is recorded: the OCR engine (A5), then the text layer (A4).
  const rowWitnesses = [["ocr", rowsOver(ocr)], ["textLayer", rowsOver(textLayer)]] as const;
  // The UN/NA number the page settles on a paired line the readers split on (Q-RC7), per witness.
  const settled = new Map<string, SettledId | null>();
  const settledAt = (reader: "ocr" | "textLayer", pages: readonly OcrPage[] | null, i: number): SettledId | null => {
    const key = `${reader}@${i}`;
    if (!settled.has(key)) {
      const b = i < aLines.length ? aligned[i] : null;
      const others = allLines.filter((_, k) => k !== i).map((l) => l.idText);
      settled.set(key, b ? settledId(pages, lineAt(i), b, verdictOf(i, lineAt(i)), others, Math.min(i, others.length)) : null);
    }
    return settled.get(key)!;
  };

  // The totals witness needs whole documents; a caller passing only the hazmat section gets none.
  const sums = a.freight && a.otherLines && (bAtA === null || (bAtA.freight && bAtA.otherLines))
    ? arithmeticWitness({ hazmat: a.hazmat, otherLines: a.otherLines, freight: a.freight }, bAtA && { hazmat: bAtA.hazmat, otherLines: bAtA.otherLines, freight: bAtA.freight! })
    : new Map<string, number | null>();

  const out: FieldEvidence[] = [];
  const emit = (path: string, aHas: boolean, bHas: boolean) => {
    const av = aHas ? valueAtPath(a, path) ?? null : undefined;
    const bv = bHas ? valueAtPath(bAtA, path) ?? null : undefined;
    const sources: FieldEvidence["sources"] = [];
    if (av !== undefined) sources.push({ reader: "passA", page: null, bbox: null, value: av as never });
    if (bv !== undefined) sources.push({ reader: "passB", page: null, bbox: null, value: bv as never });
    const m = LINE_RX.exec(path);
    if (m && (HMT_JUDGED_KEYS as readonly string[]).includes(m[2]!)) {
      const i = Number(m[1]);
      sources.push({ reader: "table", page: null, bbox: null, value: verdictOf(i, lineAt(i)) as never });
    }
    if (m && (ROW_JUDGED_KEYS as readonly string[]).includes(m[2]!) && (av != null || bv != null)) {
      const i = Number(m[1]);
      const unprovable = classTokens(lineAt(i).hazardClass, i < aLines.length ? aligned[i]?.hazardClass : null);
      for (const [reader, rowAt] of rowCanJudge([av, bv], unprovable) ? rowWitnesses : []) {
        const row = rowAt(i);
        if (row) sources.push({ reader, page: row.page, bbox: row.bbox, value: rowBacks(row, [av, bv], unprovable) as never });
      }
    }
    if (m && (m[2] === "idText" || m[2] === "descriptionText") && av != null && bv != null && !valuesAgree(av, bv)) {
      const i = Number(m[1]);
      for (const [reader, pages] of [["ocr", ocr], ["textLayer", textLayer]] as const) {
        const s = settledAt(reader, pages, i);
        if (!s) continue;
        const value = m[2] === "idText" ? s.value : settledDescription(s, av as string, bv as string, String(lineAt(i).idText), String(aligned[i]!.idText));
        if (value != null) sources.push({ reader, page: s.row.page, bbox: s.row.bbox, value });
      }
    }
    if (sums.has(path)) sources.push({ reader: "arithmetic", page: null, bbox: null, value: sums.get(path)! });
    if (path === "hazmat.lines") {
      for (const [reader, pages] of [["ocr", ocr], ["textLayer", textLayer]] as const) {
        if (!pages) continue;
        const marks = hazmatMarks(pages);
        sources.push({ reader, page: marks[0]?.page ?? null, bbox: marks[0]?.bbox ?? null, value: marks.map((k) => k.mark) });
      }
    }
    if (path === "hazmat.shipperCertification") {
      for (const [reader, pages] of [["ocr", ocr], ["textLayer", textLayer]] as const) {
        const shown = pages ? certificationShown(pages) : null;
        if (shown) sources.push({ reader, page: shown.page, bbox: shown.bbox, value: true });
      }
    }
    const nothing = av == null && bv == null && av !== undefined && bv !== undefined;
    out.push({ path, value: (av ?? bv ?? null) as never, status: nothing ? "not_read" : "check", sources, ruleVersion });
  };

  for (const path of leafFieldPaths(a)) {
    const m = LINE_RX.exec(path);
    const o = OTHER_RX.exec(path);
    const partnered = m ? aligned[Number(m[1])] != null : o ? other.aligned[Number(o[1])] != null : true;
    emit(path, true, bAtA !== null && partnered);
  }
  // Lines only pass B saw: a line pass A missed is a disagreement, shown, never dropped.
  extra.forEach((line, k) => {
    for (const path of leafFieldPaths({ hazmat: { lines: [line] } })) {
      emit(path.replace("hazmat.lines[0]", `hazmat.lines[${aLines.length + k}]`), false, true);
    }
  });
  other.extra.forEach((row, k) => {
    for (const path of leafFieldPaths({ otherLines: [row] })) {
      emit(path.replace("otherLines[0]", `otherLines[${aOther.length + k}]`), false, true);
    }
  });
  return out;
}
