import { TOLL_PROVIDER_LABEL, TOLL_STATEMENT_FORMAT_LABEL, formatDisplayDate, type TollStatementDto } from "@silvicom/shared";
import type { AppBadge } from "@silvicom/ui";

/** Read from AppBadge itself rather than restated: the badge decides which tones exist. */
type BadgeTone = NonNullable<InstanceType<typeof AppBadge>["$props"]["tone"]>;

/**
 * How a statement reads on the Tolls page (TOLLS-PER-TRUCK-PLAN.md TL4a). Pure, so the list and the
 * drawer say the same thing, and the words are tested once.
 *
 * ── "NOT READ YET" IS SAID IN WORDS ──────────────────────────────────────────────────────────
 * A kept file is not a counted toll. Until a reader has read it (TL5) the row says so, so nobody takes
 * a full list for per-truck tolls that exist.
 */

export type StatementStatus = "removed" | "read" | "unread";

export function statementStatus(s: Pick<TollStatementDto, "removedAt" | "readAt">): StatementStatus {
  if (s.removedAt) return "removed";
  return s.readAt ? "read" : "unread";
}

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  unread: "Not read yet",
  read: "Read",
  removed: "Removed",
};

export const STATEMENT_STATUS_TONE: Record<StatementStatus, BadgeTone> = {
  unread: "info",
  read: "success",
  removed: "neutral",
};

/** `2.4 MB`, `310 KB`, `900 bytes`: enough to tell a statement from an empty export. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "PDF · 2.4 MB" — the format the bytes showed, not the one the name claims. */
export const fileKind = (s: Pick<TollStatementDto, "format" | "byteSize">) => `${TOLL_STATEMENT_FORMAT_LABEL[s.format]} · ${fileSize(s.byteSize)}`;

/** The period the statement covers, once read. */
export function statementPeriod(s: Pick<TollStatementDto, "periodStart" | "periodEnd">): string | null {
  if (!s.periodStart && !s.periodEnd) return null;
  if (s.periodStart === s.periodEnd || !s.periodEnd) return formatDisplayDate(s.periodStart);
  if (!s.periodStart) return formatDisplayDate(s.periodEnd);
  return `${formatDisplayDate(s.periodStart)} – ${formatDisplayDate(s.periodEnd)}`;
}

/** Search matches the file's name, its provider and who uploaded it. */
export function matchesStatementSearch(s: TollStatementDto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [s.fileName, TOLL_PROVIDER_LABEL[s.provider], s.uploadedByName ?? ""].some((v) => v.toLowerCase().includes(needle));
}
