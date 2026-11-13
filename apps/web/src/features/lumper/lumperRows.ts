import { formatDisplayDate, type LumperCaseRow, type LumperCaseState } from "@silvicom/shared";

/**
 * How a lumper case is shown (LUMPER-REVISED-RC-PLAN D-LRC5, D-LRC10): the badge tone of each state,
 * the money, the place, and how many days a case has waited. Pure, so the list and the drawer read the
 * same words and the tests can hold them still.
 */
export type BadgeTone = "danger" | "caution" | "warning" | "success" | "info" | "brand" | "neutral";

/** Red for money already at risk on an invoice, amber for a paper still owed, green for done. */
export const LUMPER_STATE_TONE: Record<LumperCaseState, BadgeTone> = {
  waiting_for_rc: "caution",
  rc_received: "info",
  billed_no_rc: "danger",
  billed_without_lumper: "danger",
  billed_short: "danger",
  billed_rc_on_file: "success",
  closed_not_billable: "neutral",
  charge_removed: "neutral",
};

export const usd = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * McLeod's dates are calendar days (a transaction date, a bill date) sent as midnight labelled `Z`.
 * Shown from their first ten characters, so no time zone can move one to the day before.
 */
export const mcleodDay = (value: string | null): string => formatDisplayDate(value ? value.slice(0, 10) : null);

export function lumperPlace(c: Pick<LumperCaseRow, "consigneeName" | "consigneeCity" | "consigneeState">): string {
  const town = [c.consigneeCity, c.consigneeState].filter(Boolean).join(", ");
  return [c.consigneeName, town].filter(Boolean).join(" · ") || "—";
}

/**
 * What we paid, or what the dispatcher keyed when payroll has not recorded the payment yet (it follows
 * the lumper by 9 to 88 hours). The second is labelled, so a keyed amount is never read as a payment.
 */
export function lumperAmount(c: Pick<LumperCaseRow, "paidAmount" | "chargeAmount">): { text: string; note: string | null } {
  if (c.paidAmount > 0) return { text: usd(c.paidAmount), note: null };
  if (c.chargeAmount > 0) return { text: usd(c.chargeAmount), note: "keyed, not paid in payroll yet" };
  return { text: "—", note: null };
}

/** Whole days since the lumper was paid, or since the case opened when payroll has no date yet. */
export function lumperDaysOpen(c: Pick<LumperCaseRow, "paidAt" | "openedAt">, now: Date): number {
  const from = Date.parse(c.paidAt ?? c.openedAt);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((now.getTime() - from) / 86_400_000));
}

/** The search box: order number, broker, dispatcher, delivery place, EFS reference. */
export function matchesLumperSearch(c: LumperCaseRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.orderId, c.customerName, c.dispatcherName, c.consigneeName, c.consigneeCity, c.lastInvoiceNo, ...c.references]
    .some((v) => (v ?? "").toLowerCase().includes(q));
}

/** How old the connector's last read is, in words; `late` once it is over a day (plan §4). */
export function sweepFreshness(sweptAt: string | null, now: Date): { text: string; late: boolean } {
  if (!sweptAt) {
    return { text: "No lumper fees have been read from McLeod yet. The list fills once the connector's lumper read is switched on.", late: true };
  }
  const hours = Math.floor((now.getTime() - Date.parse(sweptAt)) / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return { text: `Last read from McLeod ${days} day${days === 1 ? "" : "s"} ago. Anything paid, keyed or invoiced since then is not shown.`, late: true };
  }
  return { text: hours < 1 ? "Read from McLeod within the last hour." : `Read from McLeod ${hours} hour${hours === 1 ? "" : "s"} ago.`, late: false };
}
