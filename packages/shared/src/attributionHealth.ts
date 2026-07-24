/**
 * WP3 — chronic-unattribution escalation. Unattributed fills are deliberately NOT anomalies (weight 0,
 * suppressed): a lone unmatched row is a data gap. But unattribution is also what disables EVERY
 * vehicle-keyed rule — so a CLUSTER of unattributed fills on one card is exactly where misuse hides,
 * and it must escalate to a human instead of staying invisible. Pure aggregation; the digest renders it.
 */
import { cardLast4 } from "./cardAssignment.js";

export interface UnattributedFillRow {
  vehicle_id: string | null;
  driver_id: string | null;
  card_ref: string | null;
  control_id: string | null;
}

export interface UnattributedCluster {
  /** Masked card label ("•••• 7521", disambiguated by control id when masked), or "no card recorded". */
  card: string;
  count: number;
}

export interface AttributionHealth {
  /** Fills missing a vehicle OR a driver in the window. */
  total: number;
  /** Cards with ≥ minCluster unattributed fills — the "look here" list, biggest first. */
  clusters: UnattributedCluster[];
}

/** Group unattributed fills by card identity; only clusters ≥ `minCluster` escalate (default 3). */
export function computeAttributionHealth(rows: UnattributedFillRow[], opts: { minCluster?: number } = {}): AttributionHealth {
  const minCluster = opts.minCluster ?? 3;
  const un = rows.filter((r) => r.vehicle_id == null || r.driver_id == null);
  const byCard = new Map<string, number>();
  for (const r of un) {
    const last4 = cardLast4(r.card_ref);
    const key = last4 ? `•••• ${last4}${r.control_id ? ` (driver ${r.control_id.trim()})` : ""}` : "no card recorded";
    byCard.set(key, (byCard.get(key) ?? 0) + 1);
  }
  const clusters = [...byCard.entries()]
    .filter(([, n]) => n >= minCluster)
    .map(([card, count]) => ({ card, count }))
    .sort((a, b) => b.count - a.count);
  return { total: un.length, clusters };
}
