/**
 * `GET /api/compliance/unit-files?subjectType=tractor|trailer` — every truck's or trailer's file in
 * one read (UNIT-FILES-PLAN UF2). The Vehicles and Trailers lists' Files column (UF4) and the fleet
 * manager's Truck paperwork card read it; a unit's own page builds the same file from the same
 * function (`buildUnitFile`), so the list, the card and the page cannot disagree.
 */
import type { FileItemState, FileSummary } from "./fileEngine.js";
import type { EquipmentGroup, OwnershipType, UnitSubjectType } from "./equipmentFileCatalogue.js";
import type { UnitAttentionItem } from "./unitFile.js";

/** One item of a unit's file, as a list cell needs it — no spec, which the client has in shared. */
export interface UnitFileCell {
  key: string;
  group: EquipmentGroup;
  state: FileItemState;
  goodUntil: string | null;
  /** McLeod's date when no paper is on file (D-UF3); the item itself is `missing`. */
  dateOnly: { goodUntil: string; state: FileItemState } | null;
  /** True when the fleet's paper on the organization covers it (D-UF6). */
  fleetWide: boolean;
  documentId: string | null;
}

/**
 * A paper on file, as a list cell shows it: enough to draw a thumbnail and to say what it is. The
 * thumbnail's signed URL lives five minutes like every document URL; the full document is fetched
 * from `/api/compliance/documents` when someone opens it.
 */
export interface PaperThumb {
  documentId: string;
  kind: string;
  contentType: string;
  /** Null until the derive job has run (or for a type with no thumb). */
  thumbUrl: string | null;
}

export interface UnitFileRow {
  subject_type: UnitSubjectType;
  subject_id: string;
  unit_number: string;
  status: string;
  ownership: OwnershipType | null;
  state: FileSummary["state"];
  counts: Record<FileItemState, number>;
  /** Item keys that wait on the unit's ownership being set (D-UF11). */
  ownership_unknown: string[];
  attention: UnitAttentionItem[];
  items: UnitFileCell[];
  /** The newest papers on file for this unit, newest first, at most `PAPERS_PER_ROW`. */
  papers: PaperThumb[];
  /** Every original on file for this unit — what "+N" counts past `papers`. */
  paper_count: number;
}

export interface UnitFilesResponse {
  units: UnitFileRow[];
}

/** How many thumbnails one list cell draws before "+N". */
export const PAPERS_PER_ROW = 3;
