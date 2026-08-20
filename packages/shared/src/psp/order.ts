import { z } from "zod";

/**
 * Ordering a PSP record — OUR endpoint's contract, not the vendor's (P9).
 *
 * Deliberately one field. Everything else the vendor request needs is composed server-side from the
 * driver's row and the environment: the licence number, the date of birth, the DOT number, and
 * `driverConsent`, which is a fact about the signed authorization we hold rather than a claim a
 * client may assert (`checkPspGates` refuses without one before the request is built).
 *
 * ── NO `monitor` FLAG, YET ─────────────────────────────────────────────────────────────────────
 * §5.4.1 lets a request enrol in 45-day monitoring, and `PspRequestDraft` carries it. It is not
 * exposed here because P8 — the poll that would read what monitoring reports — does not exist.
 * Offering the switch would enrol transactions in a programme nothing in this product listens to,
 * and the enrolment is the easy half: `changeDetected` says only THAT something changed, and reading
 * what costs another transaction (D-PSP4). The flag arrives with the consumer, not before it.
 */
export const pspOrderRequestSchema = z.object({
  driver_id: z.uuid(),
});
export type PspOrderRequest = z.infer<typeof pspOrderRequestSchema>;

/** What the confirmation screen is told before anybody commits to a charge. */
export interface PspOrderPreflight {
  /** Both the kill switch and a configured key — either one off means no order can be placed. */
  enabled: boolean;
  environment: string;
  budget: { used: number; limit: number; remaining: number };
  /**
   * Null when nobody has told us the price (PSP-PLAN Q2). The confirmation then states that the
   * transaction bills and shows the budget, rather than inventing a figure.
   */
  unitPriceUsd: number | null;
  /** The §8.5 outcomes that carry the fee — read from the status table, never restated. */
  billsOn: string[];
  /** The first thing standing in the way, or null. Step-up is never reported here. */
  refusal: { code: string; message: string } | null;
}
