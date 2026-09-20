/**
 * The console's dates come from the same definition the product uses — `MM/DD/YYYY` from
 * `@silvicom/shared` (D-DS17, extended from the picker to the whole product on 2026-09-20).
 *
 * These were a third and fourth independent implementation before that, and carried the same
 * calendar-day fault as the ones in `apps/web`: `new Date("2026-09-20")` is UTC midnight, rendered in
 * local time, so a US-timezone operator read an org's creation date a day early. The names stay so the
 * five call sites do not churn; the arithmetic is no longer here.
 */

export { formatDisplayDate as fmtDate, formatDisplayDateTime as fmtDateTime } from "@silvicom/shared";
