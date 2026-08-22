import { type Icon, ArrowsRightLeftIcon, LicenseIcon, UserListIcon } from "@fuelguard/ui/icons";
import type { DashboardComplianceCounts } from "@fuelguard/shared";

/**
 * The dashboard's §391 row (UI plan U2) — pure, on `attentionStrip.ts`'s precedent, so what it
 * decides is testable without mounting a page that owns Chart.js and three live queries.
 *
 * ⚠ **`null` DROPS a tile; `0` RENDERS one.** The server answers null for a capability section the
 * caller may not view, and zero when it counted and found none. Collapsing the two would either
 * show a driver a row of zeros about a fleet they may not read, or tell a recruiter with a clean
 * board nothing at all — and "nothing outstanding" is one of the more useful things this row says.
 */
export interface ComplianceTile {
  label: string;
  value: string;
  sub: string;
  icon: Icon;
  tone: string;
  to: string;
}

export function buildComplianceRow(counts: DashboardComplianceCounts | undefined): ComplianceTile[] {
  if (!counts) return [];
  const out: ComplianceTile[] = [];

  if (counts.driversWithoutQualificationFile !== null) {
    out.push({
      label: "No qualification file",
      value: String(counts.driversWithoutQualificationFile),
      sub: "§391.51 not started",
      icon: LicenseIcon,
      tone:
        counts.driversWithoutQualificationFile > 0
          ? "text-caution-700 bg-caution-50"
          : "text-success-600 bg-success-50",
      to: "/compliance",
    });
  }

  if (counts.overdueInvestigations !== null) {
    out.push({
      label: "Overdue investigations",
      value: String(counts.overdueInvestigations),
      sub: "past §391.23(c)(1)",
      icon: ArrowsRightLeftIcon,
      // Overdue is the one number here that is a live regulatory breach rather than a backlog, so it
      // is the only one that goes danger-red. A clean queue is not "good", it is merely not late.
      tone: counts.overdueInvestigations > 0 ? "text-danger-600 bg-danger-50" : "text-ink-muted bg-surface-muted",
      to: "/recruitment/inquiries",
    });
  }

  if (counts.applicants !== null) {
    out.push({
      label: "Applicants",
      value: String(counts.applicants),
      sub: "on the board",
      icon: UserListIcon,
      tone: "text-info-600 bg-info-50",
      to: "/recruitment",
    });
  }

  return out;
}
