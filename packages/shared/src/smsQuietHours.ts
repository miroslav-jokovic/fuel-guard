/**
 * When a text may be sent (A11b, D-APP13).
 *
 * ── THE RULE, FROM THE RULE ───────────────────────────────────────────────────────────────────
 * 47 CFR §64.1200(c)(1), read verbatim 2026-08-21: no solicitation "before the hour of 8 a.m. or
 * after 9 p.m. (local time at the called party's location)". So the regulation's window is 8–21.
 *
 * ⚠ OURS IS 9–20, AN HOUR TIGHTER AT EACH END, AND THAT IS A CHOICE RATHER THAN THE REGULATION.
 * A11's text asks for it, and the margin is worth having for a reason the next reader should not have
 * to reconstruct: every input to the comparison below is an estimate — the recipient's timezone most
 * of all — and the penalty is assessed per message at $500 to $1,500. An hour of buffer costs a
 * recruiting text nothing.
 */
export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR = 20;

/**
 * ⚠ THERE IS NO AREA-CODE TABLE, AND A11'S TEXT ASKS FOR ONE.
 *
 * "Quiet-hours enforcement ... derived from the number's area code" is followable — the mapping is
 * public and about three hundred entries — and it should not be followed. An area code says where a
 * number was ISSUED, not where its owner is: number portability has been law since 2003, and the
 * population this product texts is, definitionally, the most mobile one there is. A driver with a
 * Chicago cell living in Phoenix is not an edge case, it is a Tuesday.
 *
 * A table like that produces a confident answer that is sometimes wrong, and "sometimes wrong" is
 * billed per message. So: when the recipient's timezone is genuinely known, use it. When it is not,
 * send only inside the window that is within quiet hours in EVERY US timezone at once — which cannot
 * be wrong, needs no data to maintain, and for a message sent once per driver in their lifetime is
 * not a constraint anybody will feel.
 *
 * The UTC offsets are the extremes of the US range: Hawaii (UTC-10, no DST) and Eastern in summer
 * (UTC-4). Fixed rather than computed, because a table of offsets is the thing this comment is about.
 */
const US_MIN_UTC_OFFSET = -10;
const US_MAX_UTC_OFFSET = -4;

/** The hour, in a named IANA zone, without pulling in a timezone library. */
function hourIn(at: Date, timeZone: string): number | null {
  try {
    const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false })
      .formatToParts(at)
      .find((p) => p.type === "hour")?.value;
    const parsed = Number(hour);
    // `Intl` renders midnight as "24" in some engines, which is hour 0.
    return Number.isFinite(parsed) ? parsed % 24 : null;
  } catch {
    // An unknown zone string. Treated as "we do not know", never as "send anyway".
    return null;
  }
}

const inWindow = (hour: number): boolean =>
  hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;

/**
 * May a message go out to this recipient right now?
 *
 * `timeZone` null means unknown, and unknown is the common case — nothing in this product asks a
 * driver where they live. The fallback is deliberately strict rather than optimistic: the question
 * "is it a civil hour for this person" has no safe default answer, so the only honest one is to
 * require that it be a civil hour for everybody.
 */
export function canSendSmsAt(at: Date, timeZone: string | null | undefined): boolean {
  if (timeZone) {
    const hour = hourIn(at, timeZone);
    if (hour !== null) return inWindow(hour);
    // Fall through on an unusable zone rather than trusting it.
  }
  const utcHour = at.getUTCHours();
  // Every US local hour this instant could correspond to, from Hawaii to Eastern.
  for (let offset = US_MIN_UTC_OFFSET; offset <= US_MAX_UTC_OFFSET; offset += 1) {
    if (!inWindow((utcHour + offset + 24) % 24)) return false;
  }
  return true;
}

/**
 * Why a send was held, for the log and for the office.
 *
 * A held message is RESCHEDULED by the sweep that produced it — the next run is at most six hours
 * away and the window is five hours wide, so a nudge held at 03:00 goes out the same day. It is never
 * dropped: dropping would mean a driver who consented to a text silently getting nothing, which is
 * the failure mode a consent regime is least able to explain.
 */
export type SmsHoldReason = "quiet_hours" | "no_consent" | "consent_revoked" | "no_number";
