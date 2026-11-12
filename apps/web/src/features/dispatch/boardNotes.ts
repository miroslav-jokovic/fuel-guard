import {
  UNIT_NOTE_MAX_SUBJECTS,
  type DispatchBoardRow,
  type UnitNoteKind,
  type UnitNoteSubjectSummary,
} from "@silvicom/shared";
import type { NotesTarget } from "@/components/notes/useNotesDrawer";

/**
 * The Dispatch Board's ONE Notes column (UNIT-NOTES-PLAN D-UN12): a row is a truck, but what a
 * dispatcher writes about is the truck, whoever drives it and what it pulls, and the dispatchers' own
 * verdict on the board was "too much information" (DISPATCH-BOARD-V2-PLAN) — so one cell and one
 * drawer per row hold every unit on it, each named by a chip, rather than three columns.
 *
 * The units, pushed in the contract's order (`UNIT_NOTE_KINDS`: truck, driver, trailer), both seats of
 * a team in seat order:
 *
 * - the truck, always (`vehicleId`);
 * - the driver and, on a team truck, the second seat — the roster's pairing (`driver`, `coDriver`,
 *   UN6a / Q-UN5), the same two people the board's Driver column and the map name;
 * - the current load's trailer (`trailerId`, UN6a), the one the row's trailer warnings are judged on.
 *   A bobtail, an empty truck and a truck in the shop have none, and the drawer simply holds fewer.
 *
 * Every id is the server's: nothing here resolves a unit number to an id (Q-UN5 (b), rejected).
 */
export function boardNoteTargets(row: DispatchBoardRow): NotesTarget[] {
  const out: NotesTarget[] = [{ kind: "vehicle", id: row.vehicleId, label: row.unitNumber }];
  for (const seat of [row.driver, row.coDriver]) {
    // A roster pairing that names one person in both seats is a data fault, not two drivers.
    if (seat && !out.some((t) => t.kind === "driver" && t.id === seat.id)) out.push({ kind: "driver", id: seat.id, label: seat.name });
  }
  if (row.trailerId) out.push({ kind: "trailer", id: row.trailerId, label: row.current?.trailerUnit ?? undefined });
  // Four at most today; the contract's cap is the URL's and the API's, so it is held here too.
  return out.slice(0, UNIT_NOTE_MAX_SUBJECTS);
}

/**
 * The row's cell: every note on its units, counted together, aged by the newest of them — the same
 * "count · age" the Vehicles, Trailers and Drivers cells show for one unit. `summaries` is the ONE
 * three-kind answer the board asks for (`useUnitNoteSummaries(["vehicle","driver","trailer"])`);
 * a unit with no notes is absent from it, and a row none of whose units has a note has no summary
 * (the cell's quiet "Add").
 */
export function boardNoteSummary(
  targets: readonly NotesTarget[],
  summaries: Partial<Record<UnitNoteKind, Record<string, UnitNoteSubjectSummary>>>,
): UnitNoteSubjectSummary | undefined {
  let count = 0;
  let lastAt: string | null = null;
  for (const t of targets) {
    const s = summaries[t.kind]?.[t.id];
    if (!s || s.count <= 0) continue;
    count += s.count;
    // By the instant: Postgres's `+00:00` and a browser's `Z` do not compare as text (`orderUnitNotes`).
    if (lastAt === null || Date.parse(s.lastAt) > Date.parse(lastAt)) lastAt = s.lastAt;
  }
  return lastAt === null ? undefined : { count, lastAt };
}

/** The words the cell's button says to a screen reader: "3 notes on truck 773, Ana Ruiz, trailer 3152". */
export function boardNoteUnitsWords(targets: readonly NotesTarget[]): string {
  return targets
    .map((t) => (t.kind === "driver" ? (t.label ?? "the driver") : `${t.kind === "vehicle" ? "truck" : "trailer"} ${t.label ?? ""}`.trim()))
    .join(", ");
}
