import { buildDatasetIndex, LATEST_DATASET_VERSION, loadDataset, resolveHmtLine, type DatasetIndex } from "@hazmat/data";
import type { FieldEvidence, PrintedHazmatLine } from "@silvicom/shared";

/**
 * The Hazardous Materials Table as a witness on each read hazmat line (DOCUMENT-READER-PLAN §7B, D-DR19,
 * step A2). Measured on the ten office BOLs (§7B.2): Haiku 5.5 wrote a shipper's product codes (5607540…)
 * as the UN number on all five lines of one paper — plausible to a person skimming, impossible in the
 * table. This is the check that catches that, with no model involved.
 *
 * It reuses `resolveHmtLine`, the hazmat extractor's LOCKED resolver (plan H6: exact id blocking, no
 * similarity score in the accept path, every normalisation one §172.101(c) authorises) — the same verdict
 * the calculator's engine will reach on these fields, never a second implementation of it.
 *
 * What it can and cannot say. A FAILURE is decisive: the id is not an id, is not in the table, or the
 * class contradicts it — the line cannot be what the paper says, so its identifying fields are *Check*
 * with the reason. A SUCCESS proves only consistency: a model can invent a line the table likes. So under
 * this rule no field is ever *Read* — a single reader is never enough (D-DR17) — and the table's verdict
 * waits, recorded, for the second reader (step A3) to make agreement possible.
 */

/** The fields of a line the table judges: the ones `resolveHmtLine` reads. */
export const HMT_JUDGED_KEYS = ["idText", "psn", "hazardClass", "pg"] as const satisfies readonly (keyof PrintedHazmatLine)[];

export type HmtVerdict =
  | { consistent: true; dataset: string; hmtRef: string; findings: string[] }
  | { consistent: false; dataset: string; reason: string };

let index: { version: string; index: DatasetIndex } | null = null;
function datasetIndex(): { version: string; index: DatasetIndex } {
  index ??= { version: LATEST_DATASET_VERSION, index: buildDatasetIndex(loadDataset(LATEST_DATASET_VERSION)) };
  return index;
}

/** Pure over the dataset: the table's verdict on one printed line. */
export function hmtVerdict(line: Pick<PrintedHazmatLine, "idText" | "psn" | "hazardClass" | "pg">): HmtVerdict {
  const { version, index: idx } = datasetIndex();
  const r = resolveHmtLine(idx, { idText: line.idText, psn: line.psn, hazardClass: line.hazardClass, pg: line.pg });
  return r.ok
    ? { consistent: true, dataset: version, hmtRef: r.hmtRef, findings: [...r.findings] }
    : { consistent: false, dataset: version, reason: r.reason };
}

/**
 * Evidence for every judged field of every hazmat line: what pass A read, and the table's verdict on the
 * line. `page: null` on both — pass A reads the document as a whole and gives no page per field yet (it
 * will with key alignment, Phase 2.2), and the table reads no page.
 */
export function hmtEvidence(lines: readonly PrintedHazmatLine[], ruleVersion: string): FieldEvidence[] {
  return lines.flatMap((line, i) => {
    const verdict = hmtVerdict(line);
    return HMT_JUDGED_KEYS.map((key) => ({
      path: `hazmat.lines[${i}].${key}`,
      value: line[key] ?? null,
      status: "check" as const,
      sources: [
        { reader: "passA" as const, page: null, bbox: null, value: line[key] ?? null },
        { reader: "table" as const, page: null, bbox: null, value: verdict },
      ],
      ruleVersion,
    }));
  });
}
