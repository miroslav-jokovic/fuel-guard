import { leafFieldPaths, valueAtPath, type FieldEvidence, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { alignLines } from "./alignLines.js";
import { HMT_JUDGED_KEYS, hmtVerdict, type HmtVerdict } from "./hmtWitness.js";
import { anchorOf, classTokens, ROW_JUDGED_KEYS, rowBacks, rowOf, type OcrPage, type Row } from "./rowWitness.js";

/**
 * A shipping document's evidence (§7B, D-DR19): for every field, what each witness said.
 *
 *   passA   the locked reader (Sonnet 4.6, D-DR20) — the document the read returns.
 *   passB   the second reader (Sonnet 5.5, Q-DR23), its hazmat lines matched to A's by key (alignLines.ts).
 *           Absent when pass B produced no document (a refusal, a truncation) or has no partner line —
 *           absence is one reader, never agreement.
 *   table   the Hazardous Materials Table's verdict on the line, on its id, PSN, class and PG (A2).
 *   ocr     the OCR engine's word on a line's count, weight and quantity (A5, rowWitness.ts): which of the
 *           readers' values is printed on the row of the line's own UN id. Absent when there was no OCR
 *           (engine off, failed, or a cache replay of a read made without it) or the row is ambiguous.
 *
 * Status under rule 2: `not_read` when both readers read nothing there; otherwise `check`. Agreement is
 * RECORDED, not yet acted on: a field moves to *Read* only by graduation (D-DR5 — N confirmations with no
 * correction under one rule, switched on per org by the owner, Step 4.3), and graduation counts exactly
 * these records. `readersAgree` (fieldEvidenceContract.ts) is how the screen tells "both readers say 6"
 * from "they say 6 and 9".
 */

const LINE_RX = /^hazmat\.lines\[(\d+)\]\.(.+)$/;
type Doc = Pick<ShippingDocument, "hazmat">;

export function shippingEvidence(a: Doc, b: Doc | null, ruleVersion: string, ocr: readonly OcrPage[] | null = null): FieldEvidence[] {
  const aLines = a.hazmat?.lines ?? [];
  const { aligned, extra } = b ? alignLines(aLines, b.hazmat?.lines ?? []) : { aligned: aLines.map(() => null), extra: [] };
  // Pass B as it would read at pass A's positions; its unpaired lines after A's last.
  const bAtA = b ? { ...b, hazmat: { ...b.hazmat, lines: [...aligned, ...extra] } } : null;
  const verdicts = new Map<number, HmtVerdict>();
  const verdictOf = (i: number, line: PrintedHazmatLine) => verdicts.get(i) ?? verdicts.set(i, hmtVerdict(line)).get(i)!;
  const lineAt = (i: number) => (i < aLines.length ? aLines[i] : extra[i - aLines.length])!;
  // The row of line i: the nth printed occurrence of its id, n = how many lines before it carry the same id.
  const allLines = [...aLines, ...extra];
  const rows = new Map<number, Row | null>();
  const rowAt = (i: number): Row | null => {
    if (!ocr) return null;
    if (!rows.has(i)) {
      const id = anchorOf(lineAt(i).idText);
      const same = allLines.filter((l) => id !== null && anchorOf(l.idText) === id);
      rows.set(i, rowOf(ocr, id, allLines.slice(0, i).filter((l) => same.includes(l)).length, same.length));
    }
    return rows.get(i)!;
  };

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
    const row = m && (ROW_JUDGED_KEYS as readonly string[]).includes(m[2]!) && (av != null || bv != null) ? rowAt(Number(m[1])) : null;
    if (row) {
      const i = Number(m![1]);
      const unprovable = classTokens(lineAt(i).hazardClass, i < aLines.length ? aligned[i]?.hazardClass : null);
      sources.push({ reader: "ocr", page: row.page, bbox: row.bbox, value: rowBacks(row, [av, bv], unprovable) as never });
    }
    const nothing = av == null && bv == null && av !== undefined && bv !== undefined;
    out.push({ path, value: (av ?? bv ?? null) as never, status: nothing ? "not_read" : "check", sources, ruleVersion });
  };

  for (const path of leafFieldPaths(a)) {
    const m = LINE_RX.exec(path);
    const partnered = m ? aligned[Number(m[1])] != null : true;
    emit(path, true, bAtA !== null && partnered);
  }
  // Lines only pass B saw: a line pass A missed is a disagreement, shown, never dropped.
  extra.forEach((line, k) => {
    for (const path of leafFieldPaths({ hazmat: { lines: [line] } })) {
      emit(path.replace("hazmat.lines[0]", `hazmat.lines[${aLines.length + k}]`), false, true);
    }
  });
  return out;
}
