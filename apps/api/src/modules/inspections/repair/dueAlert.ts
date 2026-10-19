import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDisplayDate, repairAlertStage, repairClock, repairUnitName, type CalendarDay, type RoadsideRepairDueDto } from "@silvicom/shared";
import { notify } from "../../messaging/index.js";
import { usersWhoManage } from "../../org/index.js";
import { readRepairsDue } from "../read/repairsDue.js";

/**
 * The `roadside_repair_due` alert (INSPECTION-CHALLENGE-PLAN IC11 B2b, D-IC14; category from 0483).
 *
 * ── TO WHOM, AND WHERE IT OPENS ────────────────────────────────────────────────────────────────
 * The MAINTENANCE section's managers (`usersWhoManage`, derived from the section matrix): they name the
 * repair (Q-IC13). It opens the Shop's "Roadside repairs due" page, which they can open — not the
 * inspection page, which is safety's (Q-IC16 (a); the web's `notificationRoute` chooses by reader).
 *
 * ── HOW OFTEN ──────────────────────────────────────────────────────────────────────────────────
 * Twice per unit at most: three days before its 396.9(d) due day, and the day after it if still
 * unnamed (`repairAlertStage`; the dedupe key carries the unit and the stage). Past a week overdue the
 * bell is quiet and the list carries it — the first run meets a year of history nobody decided.
 *
 * Runs on the FMCSA tick after the engine's pass, so a work order opened this hour is already proposed.
 * Never throws into the scheduler: an alert that cannot be sent is logged.
 */

/** Title and body for one unit at one stage. Pure. */
export function repairDueNotice(r: RoadsideRepairDueDto, stage: "due_soon" | "overdue", today: CalendarDay): { title: string; body: string } {
  const unit = repairUnitName(r);
  const due = formatDisplayDate(r.dueOn);
  const report = r.inspection.reportNumber ? `report ${r.inspection.reportNumber}` : "a roadside inspection";
  const on = `${report} of ${formatDisplayDate(r.inspection.inspectionDate)}`;
  if (stage === "overdue") {
    const n = repairClock(r.dueOn, today).days;
    return {
      title: `${unit}: roadside repair overdue`,
      body: `The repair of the violations on ${on} was due ${due} (${n} ${n === 1 ? "day" : "days"} ago) and no repair is recorded. Name the FleetPal work order, or say where it was repaired.`,
    };
  }
  return {
    title: `${unit}: roadside repair due ${due}`,
    body: `The violations on ${on} must be repaired and recorded by ${due} (49 CFR 396.9(d)). Name the FleetPal work order that repaired them, or say where it was repaired.`,
  };
}

export async function alertRepairsDue(admin: SupabaseClient, orgId: string, today: CalendarDay): Promise<number> {
  try {
    const repairs = await readRepairsDue(admin, orgId, today);
    if ("error" in repairs) throw new Error(repairs.error.message);
    const due = repairs.flatMap((r) => {
      const stage = repairAlertStage(r, today);
      return stage ? [{ r, stage }] : [];
    });
    if (due.length === 0) return 0;
    const managers = await usersWhoManage(admin, orgId, "maintenance");
    let sent = 0;
    for (const { r, stage } of due) {
      const notice = repairDueNotice(r, stage, today);
      for (const userId of managers) {
        const id = await notify(admin, {
          orgId,
          userId,
          category: "roadside_repair_due",
          severity: stage === "overdue" ? "critical" : "warning",
          ...notice,
          entityType: "roadside_inspection",
          entityId: r.inspection.id,
          dedupeKey: `roadside-repair-due:${r.unitId}:${stage}`,
        });
        if (id) sent++;
      }
    }
    return sent;
  } catch (e) {
    console.error(`[inspection-repair] org ${orgId}: repair-due alert failed —`, e instanceof Error ? e.message : e);
    return 0;
  }
}
