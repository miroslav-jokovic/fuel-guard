/**
 * Scheduler LANES — named, disjoint sets of background schedulers, each owned by exactly one process
 * at a time through a database lease (0506, `lib/schedulerLease.ts`). PLATFORM-RELIABILITY-PLAN D-RLY2.
 *
 * ── WHY LANES, AND WHY THESE TWO ──────────────────────────────────────────────────────────────
 * Until 2026-10-20 every scheduler ran in the one `@fleetguard/api` process that also serves every
 * person, the driver app and the McLeod connector. Measured that day: the event loop's worst stall per
 * minute had a median of 279 ms and a max of 3.3 s, and that is time every request waits behind.
 * The fix is to move background work into its own service — except that part of it cannot move.
 *
 * WEX's firewall is per operation group (docs/22-EFS-CARD-CONTROL.md, status 2026-08-11): login and
 * the transaction feeds pass from any address, but CARD MANAGEMENT checks the source IP, and only
 * `@fleetguard/api`'s three static outbound IPs are allowlisted. Railway assigns static IPs per
 * service, shared by every replica of it — so a new worker service would be a new set of addresses
 * for WEX to allowlist, and every EFS-calling scheduler would fail until they did.
 *
 *   · `egress`  — everything that dials EFS: the SOAP feed poller, the card mirror sync and status
 *                 poll, the mTLS certificate watcher, and the drain of queued EFS window re-fetches.
 *                 Runs on `@fleetguard/api` (the whitelisted service). Light: a posted poll is 4 s
 *                 median (lib/shutdown.ts). The feeds would work from anywhere, but they share the one
 *                 EFS account's login circuit breaker, which is per process (app.ts) — so all EFS
 *                 traffic stays in one lane, and one process.
 *   · `general` — everything else: Samsara, scoring, digests, reconciles, rollups, FleetPal, Med-Stop,
 *                 SMS, push, sweeps. Runs on the worker service, away from the people.
 *
 * A single-service deploy (local, tests, or before the worker exists) runs both lanes in one process,
 * exactly as before — `SCHEDULER_LANES` defaults to every lane.
 */
export const SCHEDULER_LANES = ["egress", "general"] as const;
export type SchedulerLane = (typeof SCHEDULER_LANES)[number];

export function isSchedulerLane(value: string): value is SchedulerLane {
  return (SCHEDULER_LANES as readonly string[]).includes(value);
}

/**
 * Parse `SCHEDULER_LANES`: `all` (or empty) = every lane; otherwise a comma list of lane names.
 * An unknown name is an ERROR, never ignored — a typo that silently ran nothing is the failure this
 * whole design exists to make visible. Pure; exported for env.ts and its test.
 */
export function parseSchedulerLanes(raw: string | undefined): SchedulerLane[] {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "" || text === "all") return [...SCHEDULER_LANES];
  const names = [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = names.filter((n) => !isSchedulerLane(n));
  if (unknown.length) {
    throw new Error(`SCHEDULER_LANES: unknown lane(s) ${unknown.join(", ")} — expected "all" or any of ${SCHEDULER_LANES.join(", ")}`);
  }
  if (names.length === 0) throw new Error(`SCHEDULER_LANES: no lane named — expected "all" or any of ${SCHEDULER_LANES.join(", ")}`);
  return names as SchedulerLane[];
}
