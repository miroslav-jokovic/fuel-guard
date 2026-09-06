import { useQuery } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * The two ledger figures on the Dashboard's fuel strip (C9).
 *
 * ⚠ NULL IS A THIRD ANSWER AND NOT AN ERROR. The Dashboard has no section gate — any authenticated
 * member opens it, a driver included — so the API answers per row: a caller who may see neither
 * section gets `null`, not `0`. "No findings you may see" and "no findings" are different facts about
 * the fleet, and a tile rendering 0 would state the second. The caller hides the tile on null rather
 * than printing a zero it cannot stand behind.
 *
 * Fail-quiet on error for the same reason `SamsaraFeedLine` is: this is one strip on the landing page
 * every member opens, and a dashboard that refuses to render because a supporting figure is
 * unavailable is worse than one missing a tile.
 */
export interface FindingsSummary {
  open: number | null;
  recoveredThisQuarter: number | null;
  quarterFrom: string;
}

export function useFindingsSummaryQuery() {
  return useQuery({
    queryKey: ["findings-summary"],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<FindingsSummary | null> => {
      const res = await apiFetch<{ ok: boolean } & FindingsSummary>("/api/fueling/findings/summary");
      if (!res.ok || !res.data) return null;
      return {
        open: res.data.open,
        recoveredThisQuarter: res.data.recoveredThisQuarter,
        quarterFrom: res.data.quarterFrom,
      };
    },
  });
}

/**
 * The strip's ledger tiles, built from the summary.
 *
 * Pure, and out of `DashboardPage.vue` for two reasons rather than one. The page is over the 500-line
 * budget and `lint:filesize` says split rather than waive — but the better reason is that the page is
 * deliberately untested at the component level (its own test file says so), and a tile that decides
 * whether to render based on a permission answer is exactly the logic that should not live somewhere
 * nothing can assert it.
 *
 * ⚠ `null` HIDES a tile; `0` renders one. That is the ruling in one line: a driver is told nothing
 * rather than told the fleet has no findings, and an org that genuinely has none is told zero.
 */
export interface LedgerTile {
  label: string;
  value: string;
  valueTitle?: string;
  sub: string;
  icon: unknown;
  tone: string;
  to: { path: string; query?: Record<string, string> };
}

export function ledgerTiles(
  summary: FindingsSummary | null | undefined,
  icons: { open: unknown; money: unknown },
  fmt: { int: (n: number) => string; compact: (n: number) => string; money: (n: number) => string },
): LedgerTile[] {
  if (!summary) return [];
  const tiles: LedgerTile[] = [];
  if (summary.open != null) {
    tiles.push({
      label: "Open findings",
      value: fmt.int(summary.open),
      sub: "need somebody",
      icon: icons.open,
      tone: summary.open > 0 ? "text-warning-600 bg-warning-50" : "text-success-600 bg-success-50",
      to: { path: "/findings" },
    });
  }
  if (summary.recoveredThisQuarter != null) {
    tiles.push({
      label: "Recovered",
      value: `$${fmt.compact(summary.recoveredThisQuarter)}`,
      valueTitle: fmt.money(summary.recoveredThisQuarter),
      sub: quarterLabel(summary.quarterFrom),
      icon: icons.money,
      tone: "text-success-600 bg-success-50",
      to: { path: "/findings", query: { state: "closed" } },
    });
  }
  return tiles;
}

/** "Q3 2026", from the first day of the quarter the figure covers. */
export const quarterLabel = (from: string): string => {
  const [y, m] = from.split("-");
  const q = Math.floor((Number(m) - 1) / 3) + 1;
  return `Q${q} ${y}`;
};
