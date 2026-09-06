import type { SupabaseClient } from "@supabase/supabase-js";
import { CASE_RULE_ID, isFullCardNumber, sameCardFill } from "@silvicom/shared";

/** Default window (hours) matching the rule's cumulativeWindowHours default. */
const DEFAULT_WINDOW_H = 48;

interface Assignment {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
  startMs: number;
  endMs: number | null;
}

/** The Samsara driver assigned to a truck at instant tMs (open-ended when end_at is null), or null. */
function driverAt(assignments: Assignment[], vehicleSamsaraId: string, tMs: number): string | null {
  for (const a of assignments) {
    if (a.vehicleSamsaraId !== vehicleSamsaraId) continue;
    if (tMs >= a.startMs && (a.endMs == null || tMs <= a.endMs)) return a.driverSamsaraId;
  }
  return null;
}

/** One fill in the card's window, carrying both driver sources Q-FUI16 compares. */
interface WindowFill {
  card_ref: string | null;
  control_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  fueled_at: string;
}

/** Who a fill's driver was, in ONE identity space, and which source said so. */
type DriverResolution =
  | { key: string; source: "samsara" | "fill" }
  | null;

/**
 * Resolve one fill to a driver key. Samsara's assignment wins where it exists; the fill's own
 * attribution answers only where Samsara is SILENT for that instant (Q-FUI16) — a disagreement is
 * never resolved in the weaker source's favour, it simply keeps Samsara's answer and lets the
 * equality check downstream refuse the clear.
 *
 * A Samsara driver with no roster row keeps a namespaced `samsara:` key rather than being dropped:
 * dropping it would let an unmappable driver silently equal an internal id and clear a case on a
 * coincidence.
 */
function resolveFillDriver(
  fill: WindowFill,
  vehSamsara: Map<string, string>,
  assignments: Assignment[],
  driverBySamsaraId: Map<string, string>,
): DriverResolution {
  const sv = fill.vehicle_id ? vehSamsara.get(fill.vehicle_id) : undefined;
  const samsaraDriver = sv ? driverAt(assignments, sv, Date.parse(fill.fueled_at)) : null;
  if (samsaraDriver) {
    return { key: driverBySamsaraId.get(samsaraDriver) ?? `samsara:${samsaraDriver}`, source: "samsara" };
  }
  if (fill.driver_id) return { key: fill.driver_id, source: "fill" };
  return null;
}

/**
 * Auto-clear "one card fueled multiple trucks" cases explained as ONE driver moving between trucks. The
 * alert is still RAISED (so there's a record), but if every fill on that card in the window resolves to
 * the SAME driver, the case is dismissed and marked (disposition benign_explained). Deliberately
 * conservative: a second driver, or a fill no source can speak for, leaves the case open for a human.
 *
 * Q-FUI16 (owner ruling, 2026-09-05) — TWO sources, in priority order. Samsara's
 * `driver_vehicle_assignments` answers first; where it holds no assignment for that instant, the fill's
 * OWN driver attribution answers instead. Why the second source was added: measured on production,
 * every one of the 50 card_multi_vehicle cases resolves to exactly one driver, but 10 of the 17 open
 * ones resolved NO Samsara driver for ANY fill — the assignment history begins 2026-04-14, so a case
 * older than that could never clear no matter how obviously benign it was. That attribution already
 * drives `fuel_while_driver_home` and the WP-ATTR window exclusions, so refusing it HERE was
 * inconsistent rather than conservative.
 *
 * ⚠ This widens an auto-DISMISS path, which is why it was a ruling and not a detail: a case dismissed
 * on the weaker source says so in its resolution note, so a reviewer can tell the two apart and the
 * widening stays auditable rather than invisible.
 *
 * The two sources are compared in ONE identity space (our `drivers.id`) — a Samsara driver id and a
 * fuel row's driver id are different namespaces, and a Set holding both would treat the same human as
 * two people and silently refuse to clear. A Samsara driver we cannot map to a roster row keeps an
 * opaque key of its own, so it can never accidentally equal an internal id.
 *
 * Returns the count auto-cleared.
 */
export async function reconcileCardMultiForOrg(
  admin: SupabaseClient,
  orgId: string,
  opts: { windowHours?: number } = {},
): Promise<number> {
  const windowMs = (opts.windowHours ?? DEFAULT_WINDOW_H) * 3_600_000;

  const { data: cases } = await admin
    .from("anomalies")
    .select("id, transaction_id, evidence")
    .eq("org_id", orgId)
    .eq("rule_id", CASE_RULE_ID)
    .eq("status", "open");
  const targets = ((cases ?? []) as {
    id: string;
    transaction_id: string;
    evidence: { signals?: { ruleId: string }[] } | null;
  }[]).filter(
    (c) => Array.isArray(c.evidence?.signals) && c.evidence!.signals!.some((s) => s.ruleId === "card_multi_vehicle"),
  );
  if (!targets.length) return 0;

  // Preload the vehicle→samsara-id map and the org's assignments (both small tables).
  const { data: vs } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId);
  const vehSamsara = new Map<string, string>();
  for (const v of (vs ?? []) as { id: string; samsara_vehicle_id: string | null }[]) {
    if (v.samsara_vehicle_id) vehSamsara.set(v.id, v.samsara_vehicle_id);
  }
  // Q-FUI16: the roster map that puts a Samsara driver id and a fuel row's driver id in one space.
  const { data: drv } = await admin
    .from("drivers")
    .select("id, samsara_driver_id")
    .eq("org_id", orgId);
  const driverBySamsaraId = new Map<string, string>();
  for (const d of (drv ?? []) as { id: string; samsara_driver_id: string | null }[]) {
    if (d.samsara_driver_id) driverBySamsaraId.set(d.samsara_driver_id, d.id);
  }
  const { data: asg } = await admin
    .from("driver_vehicle_assignments")
    .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
    .eq("org_id", orgId);
  const assignments: Assignment[] = (
    (asg ?? []) as { vehicle_samsara_id: string; driver_samsara_id: string; start_at: string; end_at: string | null }[]
  ).map((a) => ({
    vehicleSamsaraId: a.vehicle_samsara_id,
    driverSamsaraId: a.driver_samsara_id,
    startMs: Date.parse(a.start_at),
    endMs: a.end_at ? Date.parse(a.end_at) : null,
  }));

  let cleared = 0;
  for (const c of targets) {
    const { data: txn } = await admin
      .from("fuel_transactions")
      .select("card_ref, control_id, fueled_at")
      .eq("id", c.transaction_id)
      .maybeSingle();
    const t = txn as { card_ref: string | null; control_id: string | null; fueled_at: string } | null;
    if (!t?.card_ref) continue;
    const endMs = Date.parse(t.fueled_at);

    // Every fill on that CARD in the SAME backward window scoreTransaction used to count the trucks —
    // matched by true card identity (sameCardFill, WP3), mirroring the scorer's count exactly.
    // WP3c: scan the SAME columns resolveCardContext scans (control_id always; card_ref only for an
    // unmasked full number), or this pass would pull in other drivers' last-4 twins — and here the
    // failure mode is worse than a miscount: an extra truck Samsara can't resolve sets allResolved
    // false and BLOCKS the auto-clear, making the false alert permanent.
    const winStartIso = new Date(endMs - windowMs).toISOString();
    const scanCols: ("card_ref" | "control_id")[] = [];
    if (t.control_id) scanCols.push("control_id");
    if (isFullCardNumber(t.card_ref)) scanCols.push("card_ref");
    const byId = new Map<string, WindowFill>();
    for (const col of scanCols) {
      const val = col === "card_ref" ? t.card_ref : t.control_id;
      if (!val) continue;
      const { data: fills } = await admin
        .from("fuel_transactions")
        .select("id, card_ref, control_id, vehicle_id, driver_id, fueled_at")
        .eq("org_id", orgId)
        .eq(col, val)
        .gte("fueled_at", winStartIso)
        .lte("fueled_at", t.fueled_at);
      for (const f of (fills ?? []) as (WindowFill & { id: string })[]) {
        byId.set(f.id, f);
      }
    }
    const rows = [...byId.values()].filter(
      (f) => f.vehicle_id && sameCardFill({ cardRef: f.card_ref, controlId: f.control_id }, { cardRef: t.card_ref, controlId: t.control_id }),
    );
    if (!rows.length) continue;

    // Resolve each fill's driver. If every fill maps to the SAME driver, one person moved trucks →
    // benign. A fill NO source can speak for, or a second driver → not explained → leave it open.
    const drivers = new Set<string>();
    let allResolved = true;
    let usedFillAttribution = false;
    for (const f of rows) {
      const resolved = resolveFillDriver(f, vehSamsara, assignments, driverBySamsaraId);
      if (!resolved) {
        allResolved = false;
        break;
      }
      if (resolved.source === "fill") usedFillAttribution = true;
      drivers.add(resolved.key);
    }
    if (allResolved && drivers.size === 1) {
      await admin
        .from("anomalies")
        .update({
          status: "dismissed",
          disposition: "benign_explained",
          // The note names the SOURCE, not just the verdict. A case cleared without Samsara was
          // cleared on the weaker of the two, and a reviewer auditing this path has to be able to
          // find those without re-deriving them (Q-FUI16).
          resolution_note: usedFillAttribution
            ? "Auto-cleared: the same driver is attributed to every fill on this card in the window (one card, legitimate truck change). Samsara held no driver assignment for at least one of these fills, so this rests on the fills' own driver attribution."
            : "Auto-cleared: Samsara shows the same driver moved between these trucks (one card, legitimate truck change).",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      cleared++;
    }
  }
  return cleared;
}
