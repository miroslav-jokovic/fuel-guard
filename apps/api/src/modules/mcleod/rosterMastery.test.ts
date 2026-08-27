import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { isTmsRosterMaster } from "./rosterMastery.js";

/**
 * Which system owns the roster — and every ambiguous answer means "Samsara", the arrangement that has
 * been running for a year. The failure mode of guessing "TMS" is a roster nobody updates, silently.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const row = (over: Record<string, unknown>) =>
  createSupabaseRecorder({ tables: { org_integrations: [{ org_id: ORG, provider: "mcleod", ...over }] } });

describe("who masters the roster", () => {
  it("is the TMS only when it is enabled AND explicitly declared master", async () => {
    expect(await isTmsRosterMaster(row({ enabled: true, config: { roster_master: true } }).client, ORG)).toBe(true);
  });

  it("is NOT the TMS merely because the integration is enabled", async () => {
    // An org can reasonably ingest movements and loads from McLeod while leaving Samsara in charge of
    // who is on the roster. Demoting their driver sync because they turned on load ingest would be a
    // surprise nobody asked for.
    expect(await isTmsRosterMaster(row({ enabled: true, config: {} }).client, ORG)).toBe(false);
  });

  it("is not the TMS when the integration is disabled, whatever the config says", async () => {
    expect(await isTmsRosterMaster(row({ enabled: false, config: { roster_master: true } }).client, ORG)).toBe(false);
  });

  it("is not the TMS for an org that has never connected one", async () => {
    const rec = createSupabaseRecorder({ tables: { org_integrations: [] } });
    expect(await isTmsRosterMaster(rec.client, ORG)).toBe(false);
  });

  it("fails CLOSED when the lookup throws", async () => {
    // The first version handled only a RETURNED error and was caught by a test stub whose client
    // lacked maybeSingle. A sync that cannot tell who owns the roster must not be the one that decides
    // to stop maintaining it.
    const broken = { from: () => { throw new Error("no such table"); } } as never;
    expect(await isTmsRosterMaster(broken, ORG)).toBe(false);
  });
});
