import type { UnitAttentionReason } from "@silvicom/shared";
import { formatDate } from "@/lib/format";

/**
 * The one sentence that put a truck on the list (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3): the
 * worklist's groups in plain words (D-MX4), one per reason kind. The server names the reason and the
 * facts; this is the only place they are worded, so the list and the page say the same thing.
 */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function attentionSentence(r: UnitAttentionReason): string {
  switch (r.kind) {
    case "defect":
      return r.count === 1 ? "A defect found on an inspection is not fixed" : `${r.count} defects found on inspections are not fixed`;
    case "work_order":
      return r.count === 1 ? `In the shop${r.oldestOpenedAt ? ` since ${formatDate(r.oldestOpenedAt)}` : ""}` : `${r.count} work orders open in the shop`;
    case "annual": {
      const n = Math.abs(r.daysRemaining);
      if (r.daysRemaining < 0) return `Annual inspection ${plural(n, "day", "days")} overdue (${formatDate(r.expiresOn)})`;
      if (r.daysRemaining === 0) return `Annual inspection due today`;
      return `Annual inspection due in ${plural(n, "day", "days")} (${formatDate(r.expiresOn)})`;
    }
    case "pm": {
      const what = r.name ?? "Service";
      if (r.milesLeft !== null) {
        const n = Math.abs(r.milesLeft).toLocaleString("en-US");
        return r.verdict === "overdue" ? `${what} ${n} mi overdue` : `${what} due in ${n} mi`;
      }
      return r.verdict === "overdue" ? `${what} overdue${r.dueOn ? ` since ${formatDate(r.dueOn)}` : ""}` : `${what} due${r.dueOn ? ` ${formatDate(r.dueOn)}` : ""}`;
    }
    case "short":
      return `Missing ${plural(r.shortBy, "piece", "pieces")} of equipment`;
    case "open_check":
      return `A check started ${formatDate(r.openedAt)} was never closed`;
  }
}

/** The truck page's tabs (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.3, Q-MX9 (a)), in their order. */
export const UNIT_TABS = ["repairs", "due", "equipment", "inspections", "papers"] as const;
export type UnitTab = (typeof UNIT_TABS)[number];

/** Which tab of the truck's page answers the sentence. It was an anchor down one long page until M6. */
export function attentionTab(r: UnitAttentionReason): UnitTab {
  switch (r.kind) {
    case "defect":
    case "work_order":
      return "repairs";
    case "annual":
      return "inspections";
    case "pm":
      return "due";
    case "short":
    case "open_check":
      return "equipment";
  }
}
