import type { UnitKitDto } from "@silvicom/shared";

/**
 * The words of Equipment's On trucks tab (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.4, M7): what one
 * truck or trailer carries, in one sentence, and how much of its kit is missing.
 *
 * ── EVERY NUMBER IS THE API'S ─────────────────────────────────────────────────────────────────
 * `held` and `shortBy` are `deriveKitStatus`'s, carried by `/units` (I9's done-when); these functions
 * word them and count nothing again.
 *
 * ── "2 × LOAD BAR", NOT "2 LOAD BARS" ─────────────────────────────────────────────────────────
 * A type's name is whatever the shop typed ("Load bar", "Fire extinguisher"), and English plurals
 * cannot be derived — `packages/ui/src/lists/plural.ts` carries the measurement. A count beside the
 * name as typed is never wrong.
 *
 * ── A TABLET IS WORDED WITH ITS DRIVER ────────────────────────────────────────────────────────
 * Tablets follow the driver (D-DE1), so the fact worth reading is whose tablet it is. Which line is
 * a tablet is the TYPE's `heldBy` (0524's `asset_types.held_by`), never its name — the shop may rename
 * "Tablet". The driver is the truck's, inferred and never stored (D-INV3).
 */

type OnBoard = Pick<UnitKitDto, "lines" | "inferredDriverName">;

/** "Tablet (Dana Reyes), 2 × Load bar, Fire extinguisher" — or null when the unit carries nothing. */
export function onBoardSentence(unit: OnBoard): string | null {
  const parts = unit.lines
    .filter((l) => l.held > 0)
    .map((l) => {
      const what = l.held > 1 ? `${l.held} × ${l.assetTypeName}` : l.assetTypeName;
      return l.heldBy === "driver" && unit.inferredDriverName ? `${what} (${unit.inferredDriverName})` : what;
    });
  return parts.length ? parts.join(", ") : null;
}

/**
 * "2 missing", or null. Only for a unit somebody has checked: until its first check a unit is short
 * on paper only, because its things have no records yet (R10) — that is "Never checked", not missing.
 */
export function missingWords(unit: Pick<UnitKitDto, "shortBy" | "lastCheckedAt">): string | null {
  return unit.lastCheckedAt !== null && unit.shortBy > 0 ? `${unit.shortBy} missing` : null;
}
