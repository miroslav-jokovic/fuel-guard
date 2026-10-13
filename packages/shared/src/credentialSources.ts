/**
 * Which medical-card expiry the qualification file keeps when its sources disagree
 * (MEDSTOP-PLAN.md §7A.10 — D-MSUX4a/b; Q-MSUX7 answered by the owner 2026-10-13).
 *
 * Sources: McLeod's roster sweep and Med-Stop's (certain matches only, R3). Samba joins the list once
 * it is connected (Q-MSUX6). The rule, as ruled:
 *
 *   1. A card on file BACKED BY A SCAN (`certifications.document_id`) wins. Somebody held the
 *      certificate and filed it; a vendor's date disagreeing with it is the vendor's to explain, and
 *      the disagreement is listed for the office (the scan stays authoritative until a newer scan is
 *      filed — which is also how the office settles a dispute: file the card).
 *   2. Otherwise the EARLIEST date any source gives — the side a lapsed card fails closed on — and
 *      the driver is flagged whenever the sources do not all agree.
 *
 * Both sweeps call this with every source's latest claim (`credential_source_dates`, 0467), so they
 * reach the same answer and neither files a row the other would move back. Pure: the filing, and
 * the write-only-on-change rule, are evidence's (`recordSyncedCredentials`).
 */
import type { CalendarDay } from "./calendarDay.js";

export const MEDICAL_SOURCES = ["mcleod", "medstop"] as const;
export type MedicalSource = (typeof MEDICAL_SOURCES)[number];

export const MEDICAL_SOURCE_LABEL: Record<MedicalSource, string> = {
  mcleod: "McLeod",
  medstop: "Med-Stop",
};

export interface MedicalSourceDate {
  source: MedicalSource;
  expiresOn: CalendarDay;
}

/** The current card in the qualification file, if any. */
export interface MedicalOnFile {
  expiresOn: CalendarDay | null;
  /** A scan is attached (`document_id`), not just a typed or synced date. */
  documented: boolean;
}

export interface MedicalResolution {
  /** The date the file should hold; null = no source has an opinion, file nothing. */
  expiresOn: CalendarDay | null;
  rule: "documented" | "earliest" | "none";
  /** Some source, or the scanned card, says something else — the cross-check lists this driver. */
  disagree: boolean;
}

const day = (d: string | null | undefined): CalendarDay | null => (d ? (d.slice(0, 10) as CalendarDay) : null);

export function resolveMedicalExpiry(onFile: MedicalOnFile | null, sources: readonly MedicalSourceDate[]): MedicalResolution {
  const dates = [...new Set(sources.map((s) => day(s.expiresOn)!))].sort();
  const scanned = onFile?.documented ? day(onFile.expiresOn) : null;
  if (scanned) return { expiresOn: scanned, rule: "documented", disagree: dates.some((d) => d !== scanned) };
  if (dates.length === 0) return { expiresOn: null, rule: "none", disagree: false };
  return { expiresOn: dates[0]!, rule: "earliest", disagree: dates.length > 1 };
}

/** Everything the rule reads for one driver: the card on file and each source's latest claim. */
export interface MedicalCardState {
  onFile: MedicalOnFile | null;
  claims: MedicalSourceDate[];
}
