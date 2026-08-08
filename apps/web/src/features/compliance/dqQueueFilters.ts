export interface DqDateRange {
  from?: string;
  to?: string;
}

export interface DqDateFilterable {
  goodUntil: string | null;
  evidenceDate: string | null;
}

export interface DqDateFilters {
  goodUntil: DqDateRange;
  evidenceDate: DqDateRange;
}

export type DqDateFilterResult =
  | { kind: "match"; missing: [] }
  | { kind: "missing-date"; missing: ("goodUntil" | "evidenceDate")[] }
  | { kind: "outside-range"; missing: [] };

function active(range: DqDateRange): boolean {
  return Boolean(range.from || range.to);
}

function matches(value: string | null, range: DqDateRange): boolean {
  if (!active(range) || !value) return false;
  return (!range.from || value >= range.from) && (!range.to || value <= range.to);
}

export function classifyDqDateFilters(
  row: DqDateFilterable,
  filters: DqDateFilters,
): DqDateFilterResult {
  const missing: ("goodUntil" | "evidenceDate")[] = [];
  if (active(filters.goodUntil) && !row.goodUntil) missing.push("goodUntil");
  if (active(filters.evidenceDate) && !row.evidenceDate) missing.push("evidenceDate");
  if (missing.length) return { kind: "missing-date", missing };

  const goodUntilMatches = matches(row.goodUntil, filters.goodUntil);
  const evidenceDateMatches = matches(row.evidenceDate, filters.evidenceDate);
  if (
    (active(filters.goodUntil) && !goodUntilMatches) ||
    (active(filters.evidenceDate) && !evidenceDateMatches)
  ) {
    return { kind: "outside-range", missing: [] };
  }

  return { kind: "match", missing: [] };
}
