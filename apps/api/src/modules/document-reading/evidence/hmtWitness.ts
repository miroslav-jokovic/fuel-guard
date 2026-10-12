import { buildDatasetIndex, LATEST_DATASET_VERSION, loadDataset, resolveHmtLine, type Dataset, type DatasetIndex, type ResolveLineResult } from "@hazmat/data";
import type { PrintedHazmatLine } from "@silvicom/shared";

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
 * this rule no field is ever *Read* on the table's word; shippingEvidence.ts records its verdict beside
 * the two model readers' values (A3).
 */

/** The fields of a line the table judges: the ones `resolveHmtLine` reads. */
export const HMT_JUDGED_KEYS = ["idText", "psn", "hazardClass", "pg"] as const satisfies readonly (keyof PrintedHazmatLine)[];

export type HmtVerdict =
  | { consistent: true; dataset: string; hmtRef: string; findings: string[] }
  | { consistent: false; dataset: string; reason: string };

let loaded: { version: string; dataset: Dataset; index: DatasetIndex } | null = null;
/**
 * The dataset the witnesses judge against, parsed once per process (`loadDataset` parses the whole file on
 * every call). The paper audit (`paperAudit.ts`) reads the same one, so the table's verdict on a line and
 * the audit's rules over it can never come from two dataset versions.
 */
export function witnessDataset(): { version: string; dataset: Dataset; index: DatasetIndex } {
  if (!loaded) {
    const dataset = loadDataset(LATEST_DATASET_VERSION);
    loaded = { version: LATEST_DATASET_VERSION, dataset, index: buildDatasetIndex(dataset) };
  }
  return loaded;
}

/**
 * Pure over the dataset: the table's verdict on one printed line.
 *
 * A class printed "Combustible liquid" is resolved WITH the §173.150(f) election, exactly as the hazmat
 * extractor's mapper does (`mapBolLines.ts`): the resolver then accepts it only on a Class 3 entry the
 * election can apply to, and still refuses it on gasoline or an acid. Without it, NA1993 "Diesel fuel,
 * Combustible liquid, PG III" — how most fuel BOLs print diesel — was a class mismatch (found 2026-10-12
 * building N6's prefill, which takes the line's product from this verdict). Whether the election applies
 * to the placard is the offeror's to confirm and not this witness's question.
 */
export function hmtVerdict(line: Pick<PrintedHazmatLine, "idText" | "psn" | "hazardClass" | "pg">): HmtVerdict {
  const { version } = witnessDataset();
  const r = hmtResolution(line);
  return r.ok
    ? { consistent: true, dataset: version, hmtRef: r.hmtRef, findings: [...r.findings] }
    : { consistent: false, dataset: version, reason: r.reason };
}

/** The resolver's whole answer on one printed line, the election applied as above — the paper audit's input. */
export function hmtResolution(line: Pick<PrintedHazmatLine, "idText" | "psn" | "hazardClass" | "pg">): ResolveLineResult {
  return resolveHmtLine(witnessDataset().index, {
    idText: line.idText,
    psn: line.psn,
    hazardClass: line.hazardClass,
    pg: line.pg,
    reclassedCombustible: /combustible/i.test(line.hazardClass ?? ""),
  });
}
