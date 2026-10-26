import { describe, expect, it } from "vitest";
import { probeRealtimeOnce, REALTIME_PROBE_TOPIC, runRealtimeProbe, type ProbeChannel, type ProbeClient } from "./realtimeProbe.js";

/**
 * The Realtime probe (OFFICE-CHAT-PLAN CHA4). What it can get wrong: call a signal that never came back
 * a success, accept somebody else's nonce, hang when the join fails, leave the channel open, or lose
 * the result when the row cannot be written.
 */

type Status = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

function fakeClient(script: {
  join?: Status;
  /** What the announcement RPC answers; `deliver` broadcasts the given nonce after it. */
  rpcError?: string | null;
  deliver?: (nonce: string) => string | null;
  insertError?: string | null;
}) {
  const calls: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  let onBroadcast: ((m: { payload?: unknown }) => void) | null = null;
  let onStatus: ((s: Status, e?: Error) => void) | null = null;
  const channel: ProbeChannel = {
    on(_t, filter, cb) {
      calls.push(`on:${filter.event}`);
      onBroadcast = cb;
      return channel;
    },
    subscribe(cb) {
      calls.push("subscribe");
      onStatus = cb;
      // Realtime answers asynchronously; so does the fake.
      queueMicrotask(() => onStatus?.(script.join ?? "SUBSCRIBED", script.join === "CHANNEL_ERROR" ? new Error("Unauthorized") : undefined));
      return channel;
    },
  };
  const client: ProbeClient & { from(table: string): { insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }> } } = {
    channel(topic, opts) {
      calls.push(`channel:${topic}:${opts.config.private}`);
      return channel;
    },
    async removeChannel() {
      calls.push("removeChannel");
    },
    rpc(fn, args) {
      calls.push(`rpc:${fn}`);
      const nonce = String(args.p_nonce);
      if (script.rpcError) return Promise.resolve({ error: { message: script.rpcError } });
      const back = script.deliver ? script.deliver(nonce) : nonce;
      if (back !== null) queueMicrotask(() => onBroadcast?.({ payload: { nonce: back, at: "x" } }));
      return Promise.resolve({ error: null });
    },
    from(table) {
      return {
        async insert(row) {
          inserted.push({ table, ...row });
          return { error: script.insertError ? { message: script.insertError } : null };
        },
      };
    },
  };
  return { client, calls, inserted };
}

const NONCE = "7f3c2a10-aaaa-4bbb-8ccc-1234567890ab";

describe("probeRealtimeOnce", () => {
  it("joins the private probe topic, announces its nonce from the database, and times its return", async () => {
    let t = 1_000;
    const f = fakeClient({});
    const r = await probeRealtimeOnce(f.client, NONCE, 1_000, () => (t += 37));
    expect(r).toEqual({ ok: true, latencyMs: 37, detail: NONCE });
    expect(f.calls).toEqual([`channel:${REALTIME_PROBE_TOPIC}:true`, "on:probe", "subscribe", "rpc:realtime_probe_send", "removeChannel"]);
  });

  it("ignores a broadcast carrying another nonce and fails when its own never arrives", async () => {
    const f = fakeClient({ deliver: () => "someone-elses-nonce" });
    const r = await probeRealtimeOnce(f.client, NONCE, 30);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("no signal within 30 ms of the announcement");
    expect(f.calls.at(-1)).toBe("removeChannel");
  });

  it("fails at once, naming the status, when the join is refused", async () => {
    const f = fakeClient({ join: "CHANNEL_ERROR" });
    const r = await probeRealtimeOnce(f.client, NONCE, 1_000);
    expect(r).toEqual({ ok: false, latencyMs: null, detail: "join CHANNEL_ERROR: Unauthorized" });
    expect(f.calls).not.toContain("rpc:realtime_probe_send");
  });

  it("fails, naming the database's sentence, when the announcement is refused", async () => {
    const f = fakeClient({ rpcError: 'relation "realtime.messages_2026_10_24" does not exist' });
    const r = await probeRealtimeOnce(f.client, NONCE, 1_000);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('announcement refused: relation "realtime.messages_2026_10_24" does not exist');
  });

  it("fails when the join never completes, and says so rather than hanging", async () => {
    const f = fakeClient({});
    // A channel that never answers its subscribe.
    f.client.channel = () => ({ on() { return this as ProbeChannel; }, subscribe() { return this as ProbeChannel; } }) as ProbeChannel;
    const r = await probeRealtimeOnce(f.client, NONCE, 20);
    expect(r.detail).toBe("join did not complete within 20 ms");
  });
});

describe("runRealtimeProbe", () => {
  it("records the probe as one platform row", async () => {
    const f = fakeClient({});
    const r = await runRealtimeProbe(f.client, NONCE);
    expect(r.ok).toBe(true);
    expect(f.inserted).toEqual([{ table: "platform_realtime_health", kind: "probe", ok: true, latency_ms: r.latencyMs, detail: NONCE }]);
  });

  it("records a failed probe as a failed row — and throws when even that cannot be written", async () => {
    const bad = fakeClient({ join: "TIMED_OUT" });
    await runRealtimeProbe(bad.client, NONCE);
    expect(bad.inserted[0]).toMatchObject({ kind: "probe", ok: false, latency_ms: null, detail: "join TIMED_OUT" });

    const unwritable = fakeClient({ insertError: "permission denied" });
    await expect(runRealtimeProbe(unwritable.client, NONCE)).rejects.toThrow("platform_realtime_health: permission denied");
  });

  it("uses a fresh uuid nonce when none is given", async () => {
    let seen: string | null = null;
    const f = fakeClient({ deliver: (nonce) => (seen = nonce) });
    const r = await runRealtimeProbe(f.client);
    expect(r.ok).toBe(true);
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });
});
