import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../env.js";

/**
 * The trailer pairing runs on a schedule (TRAILER-LINK-PLAN Q-TL2). Until 2026-10-19 it ran only from the
 * manual button, last on 2026-08-04. The tier runner is faked so the schedule itself is what is checked:
 * its cadence, and that a run takes the button's `sync_trailers` slot, so a press and a tick never overlap.
 */
const tier = vi.hoisted(() => ({ started: [] as unknown[][], kinds: [] as string[] }));
vi.mock("./lib/tierRunner.js", () => ({
  startTier: vi.fn((_env: unknown, label: string, firstDelayMs: number, intervalMs: number, run: (a: unknown) => Promise<void>) => {
    tier.started.push([label, firstDelayMs, intervalMs, run]);
  }),
  orgsToSync: vi.fn(async () => ["org-1"]),
  runOrgTier: vi.fn(async (_a: unknown, _e: unknown, _org: string, kind: string) => {
    tier.kinds.push(kind);
  }),
}));

const { startTrailerPairingTier } = await import("./samsaraTrailerSync.js");
const base = { NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };

describe("startTrailerPairingTier", () => {
  it("runs daily by default, after the deploy window, in the manual button's sync_trailers slot", async () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.SAMSARA_TRAILER_PAIRING_SYNC_HOURS).toBe(24);
    startTrailerPairingTier(env);
    const [label, firstDelayMs, intervalMs, run] = tier.started.at(-1)!;
    expect(label).toBe("trailers");
    expect(firstDelayMs).toBeGreaterThanOrEqual(15 * 60_000);
    expect(intervalMs).toBe(24 * 3_600_000);
    await (run as (a: unknown) => Promise<void>)({});
    expect(tier.kinds).toEqual(["sync_trailers"]);
  });

  it("can be switched off with 0", () => {
    expect(loadEnv({ ...base, SAMSARA_TRAILER_PAIRING_SYNC_HOURS: "0" } as NodeJS.ProcessEnv).SAMSARA_TRAILER_PAIRING_SYNC_HOURS).toBe(0);
  });
});
