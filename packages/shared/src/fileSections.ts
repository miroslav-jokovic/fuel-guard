/**
 * Whose section a filed paper belongs to (UNIT-FILES-PLAN D-UF5).
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
 * `/api/compliance/documents` and `/certifications` were gated on `roster` as a whole, because the
 * first file they served was a driver's. A truck's registration therefore belonged to the driver
 * roster's readers: a technician (equipment view, roster none) could not see the papers of the truck
 * in their bay, a recruiter (roster view, equipment none) could, and a safety manager who may only
 * VIEW equipment could file them. Measured against `SECTION_ACCESS` on 2026-10-19.
 *
 * The answer is not a second role list for equipment papers — it is that a paper belongs to the
 * section of the file it is in, and the matrix already says who may read and manage each section.
 * An owner who wants safety managers filing truck papers raises their `equipment` access in
 * Settings → Permissions, and this follows; nothing here names a role.
 *
 * ── FLEET PAPERS ON THE ORGANIZATION ─────────────────────────────────────────────────────────────
 * A fleet insurance policy is filed on the organization and covers every unit (D-UF6), so the
 * organization's insurance / IFTA belong to `equipment`. Every other organization paper — PHMSA
 * registration, operating authority, the hazmat security plan — stays `roster`, where it was.
 */
import type { AppSection } from "./auth.js";
import { FLEET_WIDE_UNIT_KINDS } from "./equipmentFileCatalogue.js";

export function fileSectionFor(subjectType: string, kind: string | null | undefined): AppSection {
  switch (subjectType) {
    case "tractor":
    case "trailer":
      return "equipment";
    case "organization":
      return kind != null && FLEET_WIDE_UNIT_KINDS.includes(kind) ? "equipment" : "roster";
    default:
      // driver, and a load's paper — both the roster's, as they always were.
      return "roster";
  }
}

/** Every section a compliance file can belong to — what the routes' coarse gate admits. */
export const FILE_SECTIONS: readonly AppSection[] = ["roster", "equipment"];
