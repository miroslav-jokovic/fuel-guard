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

export type StatementStatus = "removed" | "read" | "refused" | "unread";

/**
 * TL4b: a statement the reader REFUSED is not "not read yet" — someone tried, and the statement did
 * not add up or could not be opened. The row says so in its own words, and the drawer shows why.
 */
export function statementStatus(s: Pick<TollStatementDto, "removedAt" | "readAt" | "lastRead">): StatementStatus {
  if (s.removedAt) return "removed";
  if (s.readAt) return "read";
  return s.lastRead?.outcome === "refused" ? "refused" : "unread";
}

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  unread: "Not read yet",
  read: "Read, adds up",
  refused: "Could not be read",
  removed: "Removed",
};

export const STATEMENT_STATUS_TONE: Record<StatementStatus, BadgeTone> = {
  unread: "info",
  read: "success",
  refused: "danger",
  removed: "neutral",
};

/** `$1,234.56` from integer cents. */
export const centsToDollars = (c: number): string =>
  `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "2,651 tolls · $40,143.28 · account …4126" for a read statement; null otherwise. The account ending
 * is shown so a statement from an account that is not ours stands out next to the others (D-TL20).
 */
export function readSummary(s: Pick<TollStatementDto, "readAt" | "lastRead">): string | null {
  const r = s.lastRead;
  if (!s.readAt || !r || r.outcome !== "read" || r.tollLineCount == null || r.tollCents == null) return null;
  const parts = [`${r.tollLineCount.toLocaleString("en-US")} ${r.tollLineCount === 1 ? "toll" : "tolls"}`, centsToDollars(r.tollCents)];
  if (r.accountEnding) parts.push(`account …${r.accountEnding}`);
  return parts.join(" · ");
}

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
