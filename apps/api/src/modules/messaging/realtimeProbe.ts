import { randomUUID } from "node:crypto";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";

/**
 * The Realtime probe (OFFICE-CHAT-PLAN CHA4, migration 0515): every fifteen minutes, prove that a
 * signal written by the database reaches a subscriber through Supabase Realtime, and record the answer.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 * Office chat's "instant" is a Broadcast from a trigger (0513) that a tab hears and answers with one
 * API call. Every part of that path fails QUIETLY by design: a `realtime.send` that raises is
 * swallowed so the message commits, a Realtime service that is down leaves every tab on its poll, and
 * a join refused for a missing partition is retried by realtime-js without a word. The product then
 * delivers in a minute instead of a second and nobody can see it. The staging load test of 2026-10-23
 * met the real case (`MissingPartition` after an idle spell), and only the test script could tell.
 *
 * ── WHAT ONE PROBE DOES ─────────────────────────────────────────────────────────────────────────
 * Join the private topic `platform:realtime-probe` with the service role (which bypasses RLS on
 * `realtime.messages`, so the topic needs no policy and nobody else can hear it); once SUBSCRIBED,
 * ask `realtime_probe_send(nonce)` to broadcast the nonce from inside Postgres — the same
 * `realtime.send` the chat trigger uses; wait for that nonce to come back on the websocket. The time
 * between the ask and the arrival is the latency a chat signal pays. No arrival within the timeout, a
 * refused join or a refused announcement is a failed probe, and each says which.
 *
 * The result is one row in `platform_realtime_health`; `GET /api/version` reads the latest and folds
 * it into `ok` (`realtimeHealth.ts`), so `platform-health.yml` pages on it the way it pages on a lane
 * nobody holds. Runs in the `general` lane: one process fleet-wide, so the probe is one websocket and
 * one broadcast, not one per replica.
 */

export const REALTIME_PROBE_TOPIC = "platform:realtime-probe";
export const REALTIME_PROBE_EVENT = "probe";
export const REALTIME_PROBE_TIMEOUT_MS = 10_000;
export const REALTIME_PROBE_INTERVAL_MS = 15 * 60_000;

type SubscribeStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

/** The slice of a Realtime channel this file uses, so a test can stand in for Supabase. */
export interface ProbeChannel {
  on(type: "broadcast", filter: { event: string }, callback: (message: { payload?: unknown }) => void): ProbeChannel;
  subscribe(callback: (status: SubscribeStatus, err?: Error) => void): ProbeChannel;
}

/** The slice of the Supabase client this file uses. */
export interface ProbeClient {
  channel(topic: string, opts: { config: { private: true } }): ProbeChannel;
  removeChannel(channel: ProbeChannel): Promise<unknown>;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

export interface ProbeResult {
  ok: boolean;
  /** Ask → arrival, when it arrived. */
  latencyMs: number | null;
  /** The nonce on success; what went wrong otherwise. Never anything tenant-scoped. */
  detail: string;
}

/**
 * One probe, start to finish. Never throws: whatever goes wrong is the result, because "could not
 * probe" is a health state too.
 */
export async function probeRealtimeOnce(
  client: ProbeClient,
  nonce: string,
  timeoutMs: number = REALTIME_PROBE_TIMEOUT_MS,
  now: () => number = () => Date.now(),
): Promise<ProbeResult> {
  let channel: ProbeChannel | null = null;
  const result = await new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let askedAt: number | null = null;
    const finish = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          latencyMs: null,
          detail: askedAt === null
            ? `join did not complete within ${timeoutMs} ms`
            : `no signal within ${timeoutMs} ms of the announcement`,
        }),
      timeoutMs,
    );
    try {
      channel = client
        .channel(REALTIME_PROBE_TOPIC, { config: { private: true } })
        .on("broadcast", { event: REALTIME_PROBE_EVENT }, (message) => {
          const p = message.payload as { nonce?: unknown } | undefined;
          if (p?.nonce !== nonce || askedAt === null) return;
          finish({ ok: true, latencyMs: Math.max(0, now() - askedAt), detail: nonce });
        })
        .subscribe((status, err) => {
          if (settled) return;
          if (status === "SUBSCRIBED") {
            askedAt = now();
            Promise.resolve(client.rpc("realtime_probe_send", { p_nonce: nonce })).then(
              ({ error }) => {
                if (error) finish({ ok: false, latencyMs: null, detail: `announcement refused: ${error.message}` });
              },
              (e: unknown) => finish({ ok: false, latencyMs: null, detail: `announcement failed: ${e instanceof Error ? e.message : String(e)}` }),
            );
            return;
          }
          // CLOSED, TIMED_OUT or CHANNEL_ERROR before the nonce came back: the join itself is the failure.
          finish({ ok: false, latencyMs: null, detail: `join ${status}${err ? `: ${err.message}` : ""}` });
        });
    } catch (e) {
      finish({ ok: false, latencyMs: null, detail: `probe threw: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
  if (channel) {
    try {
      await client.removeChannel(channel);
    } catch {
      // Leaving the topic is housekeeping; the verdict is already in hand.
    }
  }
  return result;
}

/** Probe once and record the row. Throws only when the ROW cannot be written: a probe nobody can read is no probe. */
export async function runRealtimeProbe(
  client: ProbeClient & { from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }> } },
  nonce: string = randomUUID(),
): Promise<ProbeResult> {
  const r = await probeRealtimeOnce(client, nonce);
  const { error } = await client.from("platform_realtime_health").insert({
    kind: "probe", ok: r.ok, latency_ms: r.latencyMs, detail: r.detail,
  });
  if (error) throw new Error(`platform_realtime_health: ${error.message}`);
  return r;
}

/** Every fifteen minutes, in exactly ONE process: the `general` lane's lease. */
export function startRealtimeProbeScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const admin = getSupabaseAdmin(env) as unknown as Parameters<typeof runRealtimeProbe>[0];

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await runRealtimeProbe(admin);
      if (r.ok) console.log(`[realtime-probe] ok in ${r.latencyMs} ms`);
      else console.error(`[realtime-probe] FAILED: ${r.detail}`);
    } catch (e) {
      console.error(`[realtime-probe] could not record: ${e instanceof Error ? e.message : e}`);
    } finally {
      inFlight = false;
    }
  };
  // Ninety seconds after boot, not at once: the boot minute is this process's busiest, and a probe
  // that races the schedulers' own start-up would measure the wrong thing.
  setTimeout(() => void run(), 90_000).unref?.();
  setInterval(() => void run(), REALTIME_PROBE_INTERVAL_MS).unref?.();
  console.log("[realtime-probe] enabled (every 15 min)");
}
