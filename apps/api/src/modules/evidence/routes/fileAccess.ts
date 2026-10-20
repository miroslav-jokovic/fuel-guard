import type { Request } from "express";
import { callerCanManage, callerCanView, fileSectionFor, FILE_SECTIONS, type SectionAccess } from "@silvicom/shared";
import { requireAnySection } from "../../../middleware/auth.js";

/**
 * May this caller read (or file) a paper of this subject and kind — asked of the section the paper
 * belongs to (UNIT-FILES-PLAN D-UF5, `fileSectionFor`), against the same matrix and org overrides
 * `requireSection` reads. The compliance routes serve three files; one router-wide `roster` gate made
 * a truck's registration the driver roster's business.
 */
export function mayFile(req: Request, level: Exclude<SectionAccess, "none">, subjectType: string, kind: string | null | undefined): boolean {
  const section = fileSectionFor(subjectType, kind);
  const role = req.auth?.role ?? null;
  const sections = req.auth?.sections ?? null;
  return level === "manage" ? callerCanManage(role, section, sections) : callerCanView(role, section, sections);
}

/**
 * The coarse door in front of the per-paper check: somebody who can see NO file section is refused
 * before a query runs. The precise answer is `mayFile`, asked once the subject (and, on the
 * organization, the kind) is known.
 */
export const anyFileSection = (level: Exclude<SectionAccess, "none">) =>
  requireAnySection(...FILE_SECTIONS.map((s): [typeof s, typeof level] => [s, level]));
