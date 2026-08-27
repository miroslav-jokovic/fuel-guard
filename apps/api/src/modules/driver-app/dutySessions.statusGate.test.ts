import { describe, it, expect } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { resolveDriverId } from "./dutySessions.js";

/**
 * Only a currently employed driver may act as one.
 *
 * This is the one-line fix to a gap that survived because it LOOKED covered. `auth_driver_id()` (0083)
 * does require `status = 'active'` — but it reads the caller's JWT, so it guards direct client reads,
 * and the driver app takes a different path: every /api/me route resolves through `resolveDriverId`
 * and then queries with the service role, which bypasses RLS. 0141 moved the driver load mutations
 * onto that same path claiming the safety was "made explicit", while `assert_driver_load` checks only
 * that the driver is in the org.
 *
 * The assertion that matters is the FILTER, not the returned row: the recorder records filters rather
 * than applying them, and the thing a service can get wrong here is failing to ask.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const filtersOf = (rec: ReturnType<typeof createSupabaseRecorder>) =>
  rec.queries.filter((q) => q.table === "drivers").flatMap((q) => q.filters());

describe("resolving the driver behind a session", () => {
  it("asks for org, user AND active status — the third is the gate", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: [{ id: "d-1", org_id: ORG, user_id: USER, status: "active" }] },
    });
    await resolveDriverId(rec.client, ORG, USER);
    const f = filtersOf(rec);
    expect(f).toContainEqual(expect.objectContaining({ col: "org_id", val: ORG }));
    expect(f).toContainEqual(expect.objectContaining({ col: "user_id", val: USER }));
    // Deliberately 'active' and not "not terminated": it mirrors auth_driver_id() exactly, so the two
    // paths give identical answers rather than merely similar ones.
    expect(f).toContainEqual(expect.objectContaining({ col: "status", val: "active" }));
  });

  it("still resolves an active driver", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: [{ id: "d-1", org_id: ORG, user_id: USER, status: "active" }] },
    });
    expect(await resolveDriverId(rec.client, ORG, USER)).toBe("d-1");
  });

  it("returns null when the driver row is gone, which every caller renders as 404", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: [] } });
    expect(await resolveDriverId(rec.client, ORG, USER)).toBeNull();
  });
});
