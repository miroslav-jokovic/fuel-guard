/**
 * WHAT THE BOARD SAYS IN WORDS — the sentences and per-truck metrics the live map renders.
 *
 * ── WHY THIS IS A SECOND FILE (2026-09-17) ───────────────────────────────────────────────────────
 * `liveMapLayer.ts` crossed the 500-line budget when `fuelMetric` landed, and the seam the gate
 * forced is one that was already there: everything here turns board data into ENGLISH, and
 * everything left there turns it into GEOMETRY — icons, a `FeatureCollection`, a rectangle, a
 * filtered list. Nothing in this file knows what a marker is; nothing in that one formats a string
 * a person reads.
 *
 * Pure, and for the same reason the layer is: these are the rules a test can hold still. `now` never
 * appears — every age is either computed by the server (`ageSeconds`) or derived from two values of
 * one response (`fuelMetric`), so nothing here reads a clock.
 */
import { secondsSince } from "@silvicom/shared";
import type { LiveMapBoard, LiveMapScope, LiveMapVehicle } from "@silvicom/shared";

/**
 * A fix's age in words (D-LM10 — shown per truck, never hidden behind the marker).
 *
 * ⚠ It formats the number the SERVER computed and never re-derives one. The board states its own
 * `generatedAt` and every `ageSeconds` on it was measured against that single clock; a component
 * subtracting `sampledAt` from the browser's `Date.now()` would be a second answer, wrong by
 * whatever the two clocks disagree by, on the same screen as the first.
 */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/**
 * How old a fix has to be before its age outranks anything read FROM it (D-LM20).
 *
 * ⚠ Derived from a measurement, not chosen. D-LM8b measured this fleet on production, 2026-09-17:
 * moving trucks are re-fixed about every 11 seconds, worst observed 13.6 s. So an age under about
 * half a minute is the feed working normally and says nothing a reader can act on — which is exactly
 * the owner's complaint, that every row read "3s ago" and none of them distinguished a truck. Over
 * twice the worst measured interval, the feed has skipped at least one report, and THAT is news.
 */
export const STALE_FIX_SECONDS = 30;

/** What the rail's right-hand slot says about one truck, and which fact it turned out to be. */
export interface RowMetric {
  text: string;
  kind: "speed" | "age";
}

/**
 * The one fact worth the rail's right-hand slot for this truck (D-LM20).
 *
 * ── THE OWNER'S ITEM 2, AND WHY IT IS NOT SIMPLY "SPEED INSTEAD OF AGE" ─────────────────────────
 * The slot used to be `formatAge` unconditionally, and on a healthy board that reads "1s ago",
 * "3s ago", "8s ago" down two hundred rows: a column of noise that separates no truck from any
 * other. Speed does separate them, and speed is what the owner asked for.
 *
 * ⚠ But D-LM10 requires the fix age to be visible PER TRUCK and never hidden behind the marker, for a
 * reason that has not stopped being true: a speed read off a fix nobody has refreshed in twenty
 * minutes is a lie with a number on it. A truck can be `moving` with a stale fix — the state only
 * asks that the fix is inside the offline bound, which is fifteen minutes — so "62 mph" alone would
 * be exactly that lie.
 *
 * So the slot carries the fact that is TRUE and USEFUL rather than a fixed column: the speed while
 * the feed is keeping up, and the age the moment it stops. On a healthy board almost every row shows
 * a speed, which is the change the owner asked for; on a truck whose feed has gone quiet the row
 * says so, which is what D-LM10 exists for. Neither requirement is traded away.
 *
 * ⚠ A truck with a fresh fix and no speed on the ping shows its age too. `speedMph` is nullable in
 * `vehicle_positions` and absent is NOT zero — printing "0 mph" for a ping that carried no speed
 * would invent a measurement.
 */
export function rowMetric(vehicle: LiveMapVehicle): RowMetric {
  if (vehicle.ageSeconds > STALE_FIX_SECONDS || vehicle.position.speedMph == null) {
    return { text: formatAge(vehicle.ageSeconds), kind: "age" };
  }
  return { text: `${Math.round(vehicle.position.speedMph)} mph`, kind: "speed" };
}

/** What the truck card says about the tank, and whether the answer needed its age to be honest. */
export interface FuelMetric {
  text: string;
  stale: boolean;
}

/**
 * The tank, said the only way it can honestly be said (`Q-LM20`, the owner's item 8).
 *
 * ── THE RULE IS `rowMetric`'S, THE SHAPE IS NOT, AND THE DIFFERENCE IS PHYSICAL ──────────────────
 * `rowMetric` CHOOSES: the speed while the feed is keeping up, the age the moment it stops, because
 * a speed read off a twenty-minute-old fix is a lie with a number on it. Fuel does not work that
 * way. **A tank only changes while the engine burns from it**, so an hours-old reading on a parked
 * truck is still TRUE — it is unconfirmed, not wrong. Hiding it would blank the number on the 24% of
 * live-fix trucks whose fuel is over an hour old and on every parked truck (measured on production,
 * 2026-09-17), which is most of the reason a dispatcher opens the card.
 *
 * So the number always shows, and past the bound it shows WITH ITS AGE. Same rule — the response
 * decides what fresh means and the reader is told which they are looking at — without the
 * truncation the rail's single slot forces on `rowMetric`. The card is a `<dl>`: it has room for a
 * value and a qualifier, and the rail does not, which is why fuel is not in the rail.
 *
 * ── THE AGE IS COMPUTED FROM THE RESPONSE, NOT FROM THE BROWSER'S CLOCK ──────────────────────────
 * ⚠ `generatedAt` and `fuel.at` both arrive in the same board, so subtracting them cannot be wrong
 * by whatever this laptop's clock disagrees with the server's. That is the D-LM10 rule kept rather
 * than bent: what is forbidden is `Date.now() - sampledAt`, a second clock entering the same screen
 * as the first. `ageSeconds` is server-computed for the FIX because `deriveVehicleState` needs it
 * server-side anyway; the tank's age has no server-side reader, so it is derived here from two
 * values of one response.
 *
 * ⚠ An unparseable or absent timestamp returns null rather than an un-aged percentage. A reading we
 * cannot place in time is the exact thing this function exists to refuse — the board's own
 * `LiveMapFuel` type already makes the pair inseparable, and this is the same ruling at the point of
 * display.
 */
export function fuelMetric(
  vehicle: LiveMapVehicle,
  board: Pick<LiveMapBoard, "generatedAt" | "bounds">,
): FuelMetric | null {
  const fuel = vehicle.fuel;
  if (!fuel) return null;
  const age = secondsSince(fuel.at, board.generatedAt);
  if (age == null) return null;
  const percent = `${Math.round(fuel.percent)}%`;
  if (age <= board.bounds.fuelFreshSeconds) return { text: percent, stale: false };
  return { text: `${percent} · read ${formatAge(age)}`, stale: true };
}

/**
 * Whose trucks these are, as a clause that finishes a count (D-LM18).
 *
 * A table of the two values `LiveMapScope` can take, read by its key — the same shape as
 * `STATE_LABEL` above, and for the same reason. It is not a second copy of the API's answer: the
 * API says WHICH scope is in force and this says what that scope is called in English, which is
 * the one thing a response has no business carrying (`scopeReason` is the prose it does carry, and
 * it is still rendered — see `boardSummarySentence`).
 *
 * ⚠ `mine` has never been in force. D-LM18 ships the board fleet-wide until McLeod grants the
 * dispatcher relation, so the second entry is dead the day this is written — deliberately, because
 * the day the scope becomes real the sentence must already know how to say so rather than being one
 * more thing somebody has to remember.
 */
export const SCOPE_CLAUSE: Record<LiveMapScope, string> = {
  all: "in the fleet",
  mine: "assigned to you",
};

/** Everything the rail's one-line foot says, and the only place it is composed. */
export interface BoardSummary {
  /** Trucks after every filter — what the list is showing and the map is drawing. */
  shown: number;
  /** Trucks on the board. The denominator is the whole fleet, which is what makes the clause true. */
  total: number;
  scope: LiveMapScope;
  /** Derived from `LIVE_MAP_POLL_MS` by the caller, never typed (D-LM9b). */
  pollSeconds: number;
}

/**
 * The single sentence at the foot of the rail — how many trucks, whose, and how fresh (`Q-LM19`).
 *
 * ── THREE THINGS USED TO SAY THIS AND THE OWNER COULD READ NONE OF THEM ──────────────────────────
 * The foot carried a scope PARAGRAPH (D-LM18's `scopeReason`, ~150 characters at `text-2xs` in a
 * 320px rail — four lines), then "171 of 171 shown", then the cadence. The owner's item 6 asked for
 * "a plain total" in place of the first two. The count half shipped on 2026-09-17; this is the rest,
 * and `Q-LM19` is the question of how to do it WITHOUT deleting two recorded decisions:
 *
 * · **D-LM18 survives, and is harder to miss than it was.** The disclosure is now the clause the
 *   count ends in, so a dispatcher cannot read the number without reading whose trucks it counts.
 *   A paragraph underneath a number is the thing people stop seeing; a clause inside the sentence
 *   they came for is not. `scopeReason` — WHY the scope is what it is — is reference material about
 *   a missing McLeod grant, so it moves one click away into the foot's own disclosure rather than
 *   sitting on a dispatcher's screen every day. Nothing is deleted and nothing is dismissible.
 * · **D-LM9b survives unchanged**: `pollSeconds` is derived from `LIVE_MAP_POLL_MS` by the caller,
 *   so retuning the poll still moves the sentence instead of quietly making it false.
 *
 * ⚠ "171 of 171 shown" was the original defect and the fraction is still only drawn when it says
 * something: a fraction whose halves are equal is one nobody needs to read, and that was every
 * unfiltered board. Filtered — including by D-LM23's viewport toggle, where the camera is the filter
 * — the reader does need to know how much of the fleet is off screen.
 *
 * ⚠ ONE function for BOTH renderings of this sentence. The rail's foot carries it at `lg`; below
 * that the rail is shut most of the time and a copy rides beside the Fleet button, which is the only
 * reason the disclosure survives a closed rail. Two templates composing "count + clause + cadence"
 * themselves is precisely the copy with a delay fuse this repo's register is about — and the old
 * cadence clause WAS written out twice, in `LiveMapRail.vue` and nowhere else, only because the
 * small-screen copy showed the paragraph instead.
 */
export function boardSummarySentence({ shown, total, scope, pollSeconds }: BoardSummary): string {
  const noun = total === 1 ? "truck" : "trucks";
  const count = shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
  return `${count} ${SCOPE_CLAUSE[scope]} · refreshes every ${pollSeconds}s`;
}

/**
 * The legend's sentence for the `offline` bound, built from what the response said it was.
 *
 * The board sends `bounds` precisely so no component holds a second copy of the numbers (LM6). A
 * legend reading "offline after 15 minutes" from a literal is telling the user something the
 * response can already prove, and it is wrong the first day somebody retunes the bound.
 */
export function offlineBoundSentence(bounds: LiveMapBoard["bounds"]): string {
  const minutes = Math.round(bounds.offlineBoundSeconds / 60);
  return `No fix for over ${minutes} min`;
}

/** The same, for the `stopped`/`parked` seam, which is a cadence rather than a stopwatch (D-LM9b). */
export function engineOnBoundSentence(bounds: LiveMapBoard["bounds"]): string {
  return `Not moving, heard from within ${bounds.engineOnBoundSeconds}s`;
}
