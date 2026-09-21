import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { isFleetpalSyncDue, orgsWithFleetpal } from "./index.js";
import { fleetpalSyncHandler } from "../../queue/handlers/fleetpal.js";
import { testEnv } from "../../testing/testEnv.js";
import { getHandler } from "../../queue/registry.js";
import { registerAllHandlers } from "../../queue/handlers/index.js";

/**
 * The FleetPal poller and its job kind (FLEETPAL-INTEGRATION-PLAN.md F8).
 *
 * The failure this file exists for is the one a kind in the union with no handler produces: the
 * scheduler dispatches, the consumer claims, the registry has nothing to run, and the sweep is
 * "queued" for ever while every dashboard says the integration is configured. That is the whole
 * reason F8's done-when names the registration.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const ENV = testEnv({ SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });

describe("the job kind is wired end to end", () => {
  it("⚠ has a registered handler — a kind with none queues for ever and looks healthy", () => {
    registerAllHandlers();
    expect(getHandler("fleetpal_sync")).toBeTypeOf("function");
  });
});

describe("which orgs are swept", () => {
  it("⚠ needs the switch ON *and* a key stored — neither half alone", async () => {
    // An enabled row with no key is a 401 per tick for ever; a key with the switch off is the kill
    // switch working, and a scheduler that ignored it would make the switch decorative.
    const rec = createSupabaseRecorder({
      tables: { fleetpal_credentials: [{ org_id: ORG, enabled: true, api_key_sealed: "sealed" }] },
    });
    expect(await orgsWithFleetpal(rec.client)).toEqual([ORG]);

    const filters = rec.queries.flatMap((q) => q.filters()).map((f) => f.col);
    expect(filters).toContain("enabled");
    const ops = rec.queries.flatMap((q) => q.ops).map((o) => o.method);
    expect(ops).toContain("not");
  });
});

describe("when a sweep is due", () => {
  const HOUR = 60 * 60 * 1000;
  const now = Date.parse("2026-09-21T12:00:00Z");

  it("is due when it has never run", () => {
    expect(isFleetpalSyncDue(null, now, HOUR)).toBe(true);
  });

  it("is not due again inside the interval", () => {
    expect(isFleetpalSyncDue("2026-09-21T11:30:00Z", now, HOUR)).toBe(false);
  });

  it("is due once the interval has passed", () => {
    expect(isFleetpalSyncDue("2026-09-21T10:59:00Z", now, HOUR)).toBe(true);
  });

  it("⚠ is due when the stored timestamp is unreadable rather than silently never running again", () => {
    expect(isFleetpalSyncDue("not-a-date", now, HOUR)).toBe(true);
  });
});

describe("the sweep handler", () => {
  it("⚠ stops, without failing, when the org has no usable credential", async () => {
    // Unconfigured, disabled, or an envelope that will not open under the current key — all three
    // mean STOP rather than sending an empty bearer token and reading the 401 as a revoked key.
    const rec = createSupabaseRecorder({ tables: { fleetpal_credentials: [] } });
    const result = await fleetpalSyncHandler(
      { admin: rec.client, env: ENV },
      { id: "j1", org_id: ORG, kind: "fleetpal_sync", payload: {}, attempts: 1, max_attempts: 3 },
      async () => {},
    );
    expect(result).toEqual({ ok: true, detail: "FleetPal is not configured for this organization" });
    expectOrgScoped(rec, ORG);
  });
});
