/**
 * One identity per Samsara idling event, whichever spelling of its id Samsara sent
 * (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md I0, W1; migration 0398).
 *
 * Measured 2026-10-01: GET /idling/events returns each event under two `eventUuid` spellings —
 * the real UUID, `3411b05c-3d84-4ad3-bcbe-4c6d819a6f15`, and, since 2026-09-14, the hex of the
 * UPPERCASE ASCII of its first sixteen hex digits laid out as a UUID,
 * `33343131-4230-3543-3344-383434414433` = "3411B05C3D844AD3". The second cannot be turned back
 * into the first (half the id is gone), so what the two share — and what this returns — is those
 * sixteen digits, lower case. Over all 258,824 stored rows that prefix grouped 142,538 singles and
 * 58,143 pairs, never a triple.
 *
 * A real UUID is read as the encoded spelling only if all sixteen of its bytes fall in the sixteen
 * values ASCII uses for 0-9 and A-F: (16/256)^16 ≈ 5·10⁻²⁰. An id that is not 32 hex digits (test
 * fixtures, a future format) is its own key, so it can never be merged with anything.
 *
 * This is the ONLY definition: idleSync de-duplicates a fetch with it, the twin clean-up keys stored
 * rows with it, and `idle_events.event_key` holds what it returned.
 */

const HEX32 = /^[0-9a-f]{32}$/;
/** Each byte is the ASCII code of 0-9 (0x30-0x39) or A-F (0x41-0x46). */
const ENCODED = /^(?:3[0-9]|4[1-6]){16}$/;

/** True when `eventUuid` is the hex-of-ASCII spelling rather than a real UUID. */
export function isEncodedIdleEventId(eventUuid: string): boolean {
  return ENCODED.test(eventUuid.replace(/-/g, "").toLowerCase());
}

export function idleEventKey(eventUuid: string): string {
  const hex = eventUuid.replace(/-/g, "").toLowerCase();
  if (!HEX32.test(hex)) return eventUuid;
  if (!ENCODED.test(hex)) return hex.slice(0, 16);
  let ascii = "";
  for (let i = 0; i < 32; i += 2) ascii += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return ascii.toLowerCase();
}

/**
 * Collapse a list to one item per event key. The real-UUID spelling wins over the encoded one, so
 * the id kept is the one that names the event in full; between equals the first is kept.
 */
export function dedupeIdleEventsByKey<T>(items: T[], idOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = idleEventKey(idOf(item));
    const held = byKey.get(key);
    if (held === undefined || (isEncodedIdleEventId(idOf(held)) && !isEncodedIdleEventId(idOf(item))))
      byKey.set(key, item);
  }
  return [...byKey.values()];
}
