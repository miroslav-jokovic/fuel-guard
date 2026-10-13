import { formatDisplayDateTime, type RoadsideFeed } from "@silvicom/shared";

/**
 * The sentence under the Roadside card and above the inspections list that says how current FMCSA's
 * record is (INSPECTION-CHALLENGE-PLAN §4.1, IC1c). The state is the server's `roadsideFeedState`, the
 * same one the scheduler's alert reads, so the page cannot call fresh what the bell calls late.
 *
 * Times read on the org's clock, as every other office time does. `late` is what turns the line into
 * a caution: the figures are still shown — they are the last good record — but never as today's.
 */
export function roadsideFeedSentence(feed: RoadsideFeed, zone?: string): { text: string; late: boolean } {
  const at = (iso: string | null) => formatDisplayDateTime(iso, "—", zone);
  switch (feed.state) {
    case "fresh":
      return { text: `FMCSA's record as of ${at(feed.fetchedAt)}.`, late: false };
    case "ours_late":
      return { text: `Not refreshed from FMCSA since ${at(feed.fetchedAt)} — the daily fetch is failing, so these figures may be out of date.`, late: true };
    case "fmcsa_late":
      return { text: `FMCSA has not published since ${at(feed.sourceUpdatedAt)}, so this is its record as of then.`, late: true };
    case "never":
      return { text: "FMCSA's record has not been fetched yet.", late: true };
  }
}
