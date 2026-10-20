import * as Sentry from "@sentry/node";
import type { SchedulerLane } from "../schedulerLanes.js";

/**
 * What a production process does when a scheduler lane's lease is taken away (D-RLY2): it EXITS.
 *
 * A `setInterval` scheduler has no stop handle, so a process that has started a lane cannot be trusted
 * to have stopped it — the only stop that is certain is the process's own. Railway restarts it
 * (`restartPolicyType: ON_FAILURE`), and it comes back as a clean standby that competes again. Every
 * job kind is idempotent and leased (lib/shutdown.ts, P0-4), so a job cut short is re-run, not lost.
 *
 * This is not expected in normal operation — a lease is lost only when this process could not renew
 * for most of a minute (a database outage, or an event loop frozen that long), and then exiting is
 * also the correct response to a process that has stopped being able to do its work.
 */
export function exitOnLostLease(service: string): (lane: SchedulerLane, reason: string) => void {
  return (lane, reason) => {
    const message = `[${service}] scheduler lane ${lane} lost (${reason}) — exiting so this process restarts as a standby`;
    console.error(message);
    Sentry.captureMessage(message, "error");
    void Sentry.flush(2_000).finally(() => process.exit(1));
  };
}
