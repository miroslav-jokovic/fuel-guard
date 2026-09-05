/**
 * How stale is each Samsara feed, against a stated bound? (SAM-S5, D-SAM6)
 *
 * ── WHY "IS OUR DATA FRESH?" HAD NO ANSWER ───────────────────────────────────────────────────────
 * The collector runs seven tiers on seven different intervals — stats every 20 minutes, identity every
 * 12 hours, IFTA daily — and until now the only evidence any of them ran was a line in a server log.
 * §1.1 of the plan puts the reason plainly: no mechanism gives "always fresh", so the honest product
 * is a *stated, per-feed staleness bound, monitored, and shown on the surfaces that depend on it*.
 * A single global "fresh" adjective would over-poll most feeds and under-serve one — fuel-theft
 * detection tolerates an hour; a dispatcher looking at a live map does not.
 *
 * ── WHERE THE NUMBERS COME FROM, AND WHY TWO KINDS OF THEM ───────────────────────────────────────
 * **Q-SAM1, answered 2026-09-05 (owner ruling): adopt the proposal.** stats/telematics 1 h, identity
 * 24 h, driver-scores 12 h, IFTA 48 h. Those four are RULED, and a breach of a ruled target is
 * allowed to alert.
 *
 * The ruling did not name the odometer, HOS or idle tiers, and inventing a number for them here would
 * be exactly what Q-SAM1's own fallback forbids — *"no alert fires on a guessed threshold"*. So those
 * feeds take a bound DERIVED from the cadence they already promise, reusing
 * `FEED_LATE_AFTER_PASSES` — the answer this repo already gave to this question for the EFS pollers,
 * where the argument is written out: "late" is not an opinion, it is a multiple of the interval the
 * poller promises; a fixed hour would call a 5-minute feed healthy after twelve missed passes.
 * A derived bound is SHOWN, and never alerts. The distinction is `targetSource`, and it is on the
 * wire so a surface can say which kind of number the reader is looking at.
 *
 * Worth noting rather than hiding: the ruled numbers sit in the same band the derived rule produces —
 * identity, driver-scores and IFTA are all exactly 2× their configured interval, and stats is 3×. The
 * ruling and the existing convention agree; they are kept separate anyway, because one of them is a
 * decision somebody made and the other is arithmetic, and only the first may page a person.
 *
 * ── A TARGET SHORTER THAN THE CADENCE IS UNREACHABLE, AND SAYS SO ────────────────────────────────
 * The ruled targets are ABSOLUTE and the intervals are environment variables. Raise
 * `SAMSARA_STATS_SYNC_MINUTES` past 60 and the 1-hour bound is breached the moment it is met — a feed
 * working exactly as configured, permanently red. That is how an alert becomes wallpaper, so
 * `targetUnreachable` is computed and surfaced instead of being discovered during an incident. It is
 * not a silent override: the bound stays what the owner set, and the product says the two settings
 * disagree.
 *
 * ── FIVE STATES, BECAUSE THEY NEED FIVE DIFFERENT ACTIONS ────────────────────────────────────────
 *   • **disabled** — the tier is switched off (its interval is 0). Nothing is wrong and nothing is
 *     coming; waiting is not a plan.
 *   • **never** — configured, and nothing has ever arrived. Somebody has to look at credentials.
 *   • **failing** — the tier ran and the run recorded an error. Alive and refused, which no "last
 *     seen" timestamp can express on its own.
 *   • **late** — nothing successful inside the bound. May resolve itself; worth watching.
 *   • **fresh** — inside the bound.
 *
 * This module is PURE. It reads no clock of its own: `now` is a parameter, so a test can place a feed
 * either side of its bound without waiting.
 */
import { FEED_LATE_AFTER_PASSES } from "../fuelSpend/feedFreshness.js";

export const SAMSARA_FEED_IDS = [
  "stats",
  "telematics",
  "identity",
  "driver_scores",
  "ifta",
  "odometer",
  "hos",
  "idle",
] as const;
export type SamsaraFeedId = (typeof SAMSARA_FEED_IDS)[number];

/**
 * The bounds Q-SAM1 ruled, in hours. A feed absent from this map is not unmonitored — it takes a
 * cadence-derived bound instead, and does not alert. Adding a key here is a decision, not a tidy-up.
 */
export const SAMSARA_RULED_TARGET_HOURS: Partial<Record<SamsaraFeedId, number>> = {
  // "stats/telematics 1 h" is one entry in the ruling: the live vehicle stats and the per-fill
  // reconciliation are the same promise to the same reader, and fuel-theft detection reads both.
  stats: 1,
  telematics: 1,
  identity: 24,
  driver_scores: 12,
  ifta: 48,
};

/** Plain word first, industry term behind it — the register `finance-reader-is-a-non-native-speaker` sets. */
const COPY: Record<SamsaraFeedId, { label: string; what: string }> = {
  stats: { label: "Live vehicle stats", what: "Fuel level and odometer as they change. Late here weakens every theft check." },
  telematics: { label: "Per-fill corroboration", what: "What the truck's own sensors say about each fill. Late here leaves fills unchecked." },
  identity: { label: "Trucks and drivers", what: "The roster itself. Late here means a new truck's fills belong to nobody." },
  driver_scores: { label: "Driver safety scores", what: "Samsara's own scoring. Late here dates the safety page." },
  ifta: { label: "IFTA jurisdiction miles", what: "Miles per state for the quarterly filing. Late here dates the mileage tie-out." },
  odometer: { label: "Daily odometer readings", what: "One reading per truck per day. Late here weakens cost per mile." },
  hos: { label: "Hours of service", what: "Duty status. Late here dates the driver-home checks." },
  idle: { label: "Idle time", what: "Engine idling by truck. Late here dates the idle report." },
};

export interface SamsaraFeedSpec {
  id: SamsaraFeedId;
  label: string;
  what: string;
  /** The interval the tier promises, in ms. 0 means the tier is switched off. */
  cadenceMs: number;
  /** The staleness bound in ms; null when the tier is disabled and there is nothing to bound. */
  targetMs: number | null;
  /** `ruling` — Q-SAM1 set it and a breach may alert. `cadence` — arithmetic; shown, never alerts. */
  targetSource: "ruling" | "cadence";
}

const HOUR_MS = 3_600_000;

/**
 * Build the catalogue from the intervals this deployment is actually configured with.
 *
 * The cadences are NOT hard-coded here. They are environment variables in `apps/api`, and a copy of
 * them in shared would be a second source of truth that reads correctly right up until somebody
 * changes one — the failure `targetUnreachable` exists to catch would then be invisible to the code
 * meant to catch it.
 */
export function samsaraFeedSpecs(cadenceMs: Record<SamsaraFeedId, number>): SamsaraFeedSpec[] {
  return SAMSARA_FEED_IDS.map((id) => {
    const cadence = cadenceMs[id] ?? 0;
    const ruled = SAMSARA_RULED_TARGET_HOURS[id];
    const target = cadence <= 0 ? null : ruled != null ? ruled * HOUR_MS : cadence * FEED_LATE_AFTER_PASSES;
    return {
      id,
      label: COPY[id].label,
      what: COPY[id].what,
      cadenceMs: cadence,
      targetMs: target,
      targetSource: ruled != null ? "ruling" : "cadence",
    };
  });
}

export interface SamsaraFeedObservation {
  id: SamsaraFeedId;
  /** When this feed last actually DELIVERED. Never the attempt stamp — see `feedFreshness.ts`. */
  lastSuccessAt: string | null;
  /** When it was last tried, success or not. Only used to tell `failing` from `never`. */
  lastAttemptAt: string | null;
  /** Error text from the most recent attempt; null when the most recent attempt succeeded. */
  lastError: string | null;
}

export type SamsaraFeedState = "fresh" | "late" | "failing" | "never" | "disabled";

export interface SamsaraFeedHealth extends SamsaraFeedSpec {
  lastSuccessAt: string | null;
  /** Whole minutes since the last successful collection. Null when there has never been one. */
  ageMinutes: number | null;
  targetMinutes: number | null;
  cadenceMinutes: number;
  lastError: string | null;
  state: SamsaraFeedState;
  /** The bound is shorter than the interval the tier is configured to run on — see the header. */
  targetUnreachable: boolean;
  /** A breach of THIS feed may page somebody. False for every cadence-derived bound (Q-SAM1). */
  alertable: boolean;
  /** True for any state but `fresh`, so a surface can tone once rather than reason about which. */
  needsAttention: boolean;
  /** One sentence, plain word first, ending in what it means for the figures downstream. */
  lead: string;
}

const humanAge = (m: number): string => {
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.floor(h / 24)} days ago`;
};

const humanSpan = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} minutes`;
  const h = m / 60;
  if (h < 48) return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`;
  return `${Math.round(h / 24)} days`;
};

/** One feed's verdict. Exported so a caller can score a single feed without building the catalogue. */
export function describeSamsaraFeed(
  spec: SamsaraFeedSpec,
  obs: SamsaraFeedObservation | undefined,
  now: string | number | Date = Date.now(),
): SamsaraFeedHealth {
  const nowMs = new Date(now).getTime();
  const lastSuccessAt = obs?.lastSuccessAt ?? null;
  const lastError = obs?.lastError ?? null;
  const ageMs = lastSuccessAt == null ? null : Math.max(0, nowMs - new Date(lastSuccessAt).getTime());
  const ageMinutes = ageMs == null ? null : Math.floor(ageMs / 60_000);
  const cadenceMinutes = Math.round(spec.cadenceMs / 60_000);
  const targetMinutes = spec.targetMs == null ? null : Math.round(spec.targetMs / 60_000);
  const targetUnreachable = spec.targetMs != null && spec.cadenceMs > spec.targetMs;

  let state: SamsaraFeedState;
  if (spec.targetMs == null) state = "disabled";
  else if (lastError != null) state = "failing";
  else if (lastSuccessAt == null) state = obs?.lastAttemptAt != null ? "failing" : "never";
  else state = ageMs != null && ageMs > spec.targetMs ? "late" : "fresh";

  // Only a RULED bound may page somebody, and only when the bound is actually meetable. A derived
  // number is arithmetic about a cadence, not a promise anybody made — Q-SAM1's fallback in one line.
  const alertable = spec.targetSource === "ruling" && !targetUnreachable && (state === "late" || state === "failing" || state === "never");

  const bound = spec.targetMs == null ? "" : humanSpan(spec.targetMs);
  let lead: string;
  switch (state) {
    case "disabled":
      lead = `${spec.label} is switched off, so nothing is arriving and nothing is late.`;
      break;
    case "never":
      lead = `${spec.label} has never arrived. Nothing downstream of it has ever been checked.`;
      break;
    case "failing":
      // Three different sentences, because "refused" is a claim about Samsara and only the error text
      // supports it. A tier that has run and delivered nothing, with no error recorded, is a fact
      // about US — the first pass may still be in flight — and saying the vendor refused it would
      // send somebody to check a token that is fine.
      lead = lastSuccessAt != null
        ? `${spec.label} is being refused by Samsara — the last that arrived was ${humanAge(ageMinutes!)}.`
        : lastError != null
          ? `${spec.label} is being refused by Samsara and has never arrived.`
          : `${spec.label} has been tried and nothing has arrived yet.`;
      break;
    case "late":
      lead = `${spec.label} last arrived ${humanAge(ageMinutes!)}, past the ${bound} this feed is held to.`;
      break;
    default:
      lead = `${spec.label} arrived ${humanAge(ageMinutes!)}, inside the ${bound} this feed is held to.`;
  }
  if (targetUnreachable) {
    lead += ` ⚠ It is polled every ${humanSpan(spec.cadenceMs)}, so the ${bound} target cannot be met as configured.`;
  }

  return {
    ...spec,
    lastSuccessAt,
    ageMinutes,
    targetMinutes,
    cadenceMinutes,
    lastError,
    state,
    targetUnreachable,
    alertable,
    needsAttention: state !== "fresh",
    lead,
  };
}

/** The whole catalogue, worst first, so the answer to "is our data fresh?" is the top of the list. */
export function describeSamsaraFeeds(
  specs: readonly SamsaraFeedSpec[],
  observations: readonly SamsaraFeedObservation[],
  now: string | number | Date = Date.now(),
): SamsaraFeedHealth[] {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const rank: Record<SamsaraFeedState, number> = { never: 0, failing: 1, late: 2, fresh: 3, disabled: 4 };
  return specs
    .map((s) => describeSamsaraFeed(s, byId.get(s.id), now))
    .sort((a, b) => rank[a.state] - rank[b.state] || (b.ageMinutes ?? 0) - (a.ageMinutes ?? 0));
}

/** The one-line answer a strip above a figure needs: the worst thing true of the feeds it depends on. */
export function worstSamsaraFeed(
  health: readonly SamsaraFeedHealth[],
  feeds?: readonly SamsaraFeedId[],
): SamsaraFeedHealth | null {
  const scope = feeds ? health.filter((h) => feeds.includes(h.id)) : health;
  const bad = scope.filter((h) => h.needsAttention && h.state !== "disabled");
  return bad[0] ?? null;
}
