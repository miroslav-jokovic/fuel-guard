import { DQ_EXPORT_MAX_DRIVERS } from "@silvicom/shared";

/**
 * The Drivers table's binder selection, held to what one binder can carry (DQ-INTO-DRIVERS-PLAN DD2,
 * D-DQ19). Moved from `QualificationFleetTable`, which held the same rule inline.
 *
 * A selection only grows past the cap by accumulating: the roster pages 20 rows at a time, so ticking
 * "all" on one page never passes 25, but ticking it on two does. The first 25 are kept, in the order
 * they were ticked (a `Set` keeps insertion order), and `capped` says the rest were turned away, so the
 * page can say why a tick did nothing.
 */
export function capSelection(next: ReadonlySet<string>): { selected: Set<string>; capped: boolean } {
  if (next.size <= DQ_EXPORT_MAX_DRIVERS) return { selected: new Set(next), capped: false };
  return { selected: new Set([...next].slice(0, DQ_EXPORT_MAX_DRIVERS)), capped: true };
}

/** True when the selection is full: the bar says so instead of letting a tick fail silently. */
export const selectionFull = (selected: ReadonlySet<string>): boolean => selected.size >= DQ_EXPORT_MAX_DRIVERS;
