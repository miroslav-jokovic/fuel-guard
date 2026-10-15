import type { Env } from "../../../env.js";

/**
 * The gate a `roadside_inspection_report` read passes before it spends (INSPECTION-CHALLENGE-PLAN IC10;
 * DOCUMENT-READER-PLAN Step 1.6's "the consumer's gate"). Wired to the reader at the composition root
 * (the `document_read` queue handler), beside the shipping document's, because the reader must not
 * depend on its consumers (D-DR1).
 *
 * ── NO ENTITLEMENT, AND WHY THAT IS NOT A GAP ─────────────────────────────────────────────────────
 * The shipping document's gate asks `org_module_enabled(…, 'hazmatguard')`, because the Hazmat
 * Calculator is a product a carrier holds or does not. Roadside inspections are not an `org_modules` key
 * (production, 2026-10-15: dispatch, hazmatguard, messages, navigation, notifications, training): the
 * pages are gated by the `safety` SECTION, and a read happens only for a report somebody in that section,
 * or the driver, filed. So the gate is the operator's switch, `ROADSIDE_REPORT_READING`.
 *
 * No monthly budget (null = unlimited, `withinBudget`'s convention): a report is one or two pages, read
 * once — the reader's cache answers a re-read of the same bytes — and the volume is the carrier's
 * inspections with a report filed, ~12–30 a month (measured 2026-10-15). A budget is a number the owner
 * would set from a measured month, and there is no month yet.
 */
export function roadsideReportReadGate(env: Pick<Env, "ROADSIDE_REPORT_READING">): { open: boolean; monthlyTokenBudget: number | null } {
  return { open: env.ROADSIDE_REPORT_READING === "on", monthlyTokenBudget: null };
}
