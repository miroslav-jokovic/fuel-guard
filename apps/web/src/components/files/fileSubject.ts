import type { ComplianceSubjectType, UnitSubjectType } from "@silvicom/shared";

/**
 * Whose file a component is showing (UNIT-FILES-PLAN D-UF1) — a driver's §391.51 file, a truck's or a
 * trailer's. The file components under `components/files/` take this instead of a `driverId`, so the
 * truck and trailer pages reuse the very components the driver page renders rather than a copy of them.
 *
 * `organization` is excluded: an org-level paper (fleet insurance, D-UF6) is filed against the org but
 * is always SHOWN inside a unit's file, never as a file of its own.
 */
export interface FileSubject {
  type: Exclude<ComplianceSubjectType, "organization">;
  id: string;
}

/** A truck's or a trailer's file — what the unit pages' file section takes (UNIT-FILES-PLAN UF5). */
export type UnitFileSubject = FileSubject & { type: UnitSubjectType };
