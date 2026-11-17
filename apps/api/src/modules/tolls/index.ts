/**
 * Tolls — the fleet's toll tags and, from TL4, their statements (TOLLS-PER-TRUCK-PLAN.md).
 *
 * The providers (E-ZPass, K-TAG, ExpressToll) have no API, so this module's inputs are what the
 * office types (which truck carries which tag, and when) and, later, the weekly statements it
 * uploads. A toll's truck is never stored: it is read from the tag's dated history (D-TL3).
 */
export { tollsRouter } from "./routes/tolls.js";
