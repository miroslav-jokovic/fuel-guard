/**
 * Is this connection free to upload three megabytes over? (D-SCAN11.)
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────────────────────────
 * `connectivity.ts` imports NetInfo, which imports React Native, so nothing in it can be reached by
 * `pnpm test` — the driver suite runs in a node environment with no RN renderer. This session
 * already paid for that lesson once: a mutation inverting D-SCAN4 passed the entire suite because
 * the decision lived beside the native bridge instead of beside its test. The rule that came out of
 * it is the same one `nativeScanOutcome.ts` states — decisions here, I/O there — and this predicate
 * has a trap in it worth holding.
 */

/** The only two fields of a NetInfo state this decision reads, as plain data. */
export interface ConnectionFacts {
  type: string;
  /** Tri-state on purpose: true, false, or undefined when the platform will not say. */
  isConnectionExpensive?: boolean;
}

/**
 * ⚠ **`=== false`, not a falsy check, and that is the whole trap.**
 *
 * `isConnectionExpensive` is tri-state. `!facts.isConnectionExpensive` reads "the platform did not
 * tell us" as "cheap", which is the one wrong answer that costs a driver money: it would push a
 * ~12 MB three-page bill of lading over their own cellular plan, for bytes nothing reads until
 * somebody disputes the load.
 *
 * So the predicate is deliberately conservative — anything it is unsure about is metered — and the
 * cost of being wrong in that direction is a delay of up to `DEFERRED_RETRY_MS` rather than a bill.
 * Wi-Fi is the case that matters in a truck stop; the `=== false` clause catches what is cheap
 * without being Wi-Fi, such as an ethernet-tethered tablet.
 */
export function isUnmeteredConnection(facts: ConnectionFacts): boolean {
  if (facts.type === "wifi") return true;
  return facts.isConnectionExpensive === false;
}
