import type { ComplianceSubjectType, UnitSubjectType } from "@silvicom/shared";

/**
 * Whose file a component is showing (UNIT-FILES-PLAN D-UF1) — a driver's §391.51 file, a truck's or a
 * trailer's. The file components under `components/files/` take this instead of a `driverId`, so the
 * truck and trailer pages reuse the very components the driver page renders rather than a copy of them.
 *
 * `organization` is a file of its own since DD5 (DQ-INTO-DRIVERS-PLAN D-DQ23): Settings › Carrier
 * records is the carrier's file, read from `CARRIER_ITEMS`. It was excluded until then on the reasoning
 * that an org paper (fleet insurance, D-UF6) is only ever SHOWN inside a unit's file; Q-DD4 (a) made that
 * untrue. Nothing here had to change for it: the upload and the certification write both take an
 * organization subject, and the drawer's record branch already refuses any subject but a driver.
 */
export interface FileSubject {
  type: ComplianceSubjectType;
  id: string;
}

/** A truck's or a trailer's file — what the unit pages' file section takes (UNIT-FILES-PLAN UF5). */
export type UnitFileSubject = FileSubject & { type: UnitSubjectType };
