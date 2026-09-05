/**
 * When does a stale feed page somebody, and — the harder half — when does it stop? (SAM-S5, D-SAM6)
 *
 * ── THE PROBLEM IS NOT DETECTION, IT IS REPETITION ───────────────────────────────────────────────
 * `describeSamsaraFeeds` already says which feeds are breached. Emailing that list every evaluation
 * would report a standing outage once per tick until somebody fixed it, and a carrier who gets the
 * same email forty times stops reading the forty-first. That is the same failure `targetUnreachable`
 * prevents one level down, and it is why this decision needs a memory (`samsara_feed_alerts`, 0321).
 *
 * ── THE COOLDOWN IS THE FEED'S OWN TARGET, WHICH IS NOT A NUMBER CHOSEN HERE ─────────────────────
 * "How often may we speak about this feed?" has an answer already in the data: no more often than the
 * bound the feed is held to. A feed allowed to be an hour late cannot meaningfully change state more
 * than hourly; one held to 48 hours cannot change twice a day. So the cooldown IS `targetMs`, and a
 * feed with a tighter promise is allowed to be noisier — proportionately, and without anybody picking
 * a figure. Q-SAM1's fallback applies here as much as to the thresholds themselves.
 *
 * ── WHY A RECOVERY DOES NOT DELETE THE MEMORY ────────────────────────────────────────────────────
 * A `late` feed guards its own flapping: it can only go late again after its whole target window
 * passes with no delivery. A `failing` feed cannot — `failing` comes from the most recent run's
 * error, and a tier that fails, succeeds and fails again flaps as fast as it polls. Measured on
 * production 2026-09-05: `sync_idle` has 268 failed runs against 486 done, `sync_ifta` 181 against
 * 400. Throwing the row away on recovery would let those email on every raise. So a recovery sets
 * `clearedAt` and the row — and therefore `notifiedAt` — survives.
 *
 * ── WHAT IS DELIBERATELY NOT ALERTED ─────────────────────────────────────────────────────────────
 * Only `alertable` feeds, which is `describeSamsaraFeed`'s own judgement: a bound the owner RULED
 * (Q-SAM1), that the configured cadence can actually meet, and that is breached. A cadence-derived
 * bound is shown on the card and never mailed; an unreachable bound is a misconfiguration and mailing
 * it hourly would be the wallpaper this file exists to prevent.
 *
 * Pure. `now` is a parameter, and the caller supplies both the health and the memory.
 */
import type { SamsaraFeedHealth, SamsaraFeedId, SamsaraFeedState } from "./feedHealth.js";

/** The states an alert can stand in. `fresh` and `disabled` are never alertable, so never stored. */
export type SamsaraAlertState = Extract<SamsaraFeedState, "late" | "failing" | "never">;

/** One `samsara_feed_alerts` row, as the decision needs it. */
export interface SamsaraFeedAlertMemory {
  feed: SamsaraFeedId;
  state: SamsaraAlertState;
  /** Last time we said ANYTHING about this feed — a raise or a recovery. */
  notifiedAt: string;
  /** Set when we told them it recovered; null while the alert stands. */
  clearedAt: string | null;
}

export interface SamsaraFeedAlertDecision {
  feed: SamsaraFeedId;
  action: "raise" | "clear";
  /** The state to record on a raise; null on a recovery, which only stamps `clearedAt`. */
  state: SamsaraAlertState | null;
  health: SamsaraFeedHealth;
  subject: string;
  /** Plain sentences. What is wrong, what it costs, and what to do — in that order. */
  body: string;
}

export interface SamsaraFeedAlertPlan {
  send: SamsaraFeedAlertDecision[];
  /** Why each candidate was NOT sent, so a log can say "held 3" rather than going quiet. */
  held: { feed: SamsaraFeedId; why: "unchanged" | "cooldown" | "not alertable" }[];
}

const isAlertState = (s: SamsaraFeedState): s is SamsaraAlertState =>
  s === "late" || s === "failing" || s === "never";

export function decideSamsaraFeedAlerts(
  health: readonly SamsaraFeedHealth[],
  memory: readonly SamsaraFeedAlertMemory[],
  now: string | number | Date = Date.now(),
): SamsaraFeedAlertPlan {
  const nowMs = new Date(now).getTime();
  const byFeed = new Map(memory.map((m) => [m.feed, m]));
  const send: SamsaraFeedAlertDecision[] = [];
  const held: SamsaraFeedAlertPlan["held"] = [];

  for (const f of health) {
    const mem = byFeed.get(f.id);
    const standing = mem != null && mem.clearedAt == null;
    // The cooldown is the feed's own bound; a feed with no bound has nothing to be late against.
    const cooling = mem != null && f.targetMs != null && nowMs - new Date(mem.notifiedAt).getTime() < f.targetMs;

    if (f.alertable && isAlertState(f.state)) {
      // Nothing new to say: they were told about this exact state and it has not changed. The single
      // most important branch in this file — it is what turns forty emails into one.
      if (standing && mem!.state === f.state) {
        held.push({ feed: f.id, why: "unchanged" });
        continue;
      }
      if (cooling) {
        held.push({ feed: f.id, why: "cooldown" });
        continue;
      }
      send.push({
        feed: f.id,
        action: "raise",
        state: f.state,
        health: f,
        subject: `⚠ ${f.label} is ${f.state === "late" ? "late" : f.state === "failing" ? "being refused" : "not arriving"}`,
        body: [
          f.lead,
          f.what,
          f.lastError ? `Samsara's answer to the last attempt: ${f.lastError}` : null,
          "Every figure that reads this feed is being computed from older data until it recovers.",
          "Check Settings → Data & sync for the current state of every feed.",
        ]
          .filter(Boolean)
          .join(" "),
      });
      continue;
    }

    // Recovered. Only worth saying if we raised it and have not already said so.
    if (standing) {
      if (cooling) {
        held.push({ feed: f.id, why: "cooldown" });
        continue;
      }
      send.push({
        feed: f.id,
        action: "clear",
        state: null,
        health: f,
        subject: `${f.label} is back on time`,
        body: `${f.lead} Nothing further is needed.`,
      });
      continue;
    }
    held.push({ feed: f.id, why: "not alertable" });
  }

  return { send, held };
}
