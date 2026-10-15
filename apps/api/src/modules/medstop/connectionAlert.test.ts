import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The Med-Stop connection alert (MEDSTOP-PLAN §7A.20). What it can get wrong: stay silent on a key
 * about to expire or a sweep that stopped, tell somebody who cannot fix it, or repeat itself every
 * hour instead of once per threshold / once a day.
 */

const sent: { userId: string; category: string; title: string; severity: string; dedupeKey?: string }[] = [];
vi.mock("../messaging/index.js", () => ({
  notify: vi.fn(async (_admin: unknown, input: (typeof sent)[number]) => {
    sent.push(input);
    return `n-${sent.length}`;
  }),
}));
const rolesAsked: string[][] = [];
vi.mock("../org/index.js", () => ({
  usersInRoles: vi.fn(async (_admin: unknown, _org: string, roles: string[]) => {
    rolesAsked.push([...roles]);
    return ["u-admin"];
  }),
}));

const { alertMedstopConnection, medstopConnectionNotices } = await import("./connectionAlert.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-15T18:00:00Z"); // 13:00 in Chicago, 10/15
const TZ = "America/Chicago";
const credential = (o: Record<string, unknown> = {}) => ({
  base_url: "https://api.med-stop.com", enabled: true, api_key_sealed: "v1.x", key_expires_on: "2026-12-28",
  last_synced_at: "2026-10-15T17:30:00Z", last_error: null, orders_enabled: false, order_contact_email: null,
  order_contact_phone: null, ...o,
});
const recorder = (row: Record<string, unknown> | null) =>
  createSupabaseRecorder({
    tables: {
      medstop_credentials: row ? [row] : [],
      organizations: [{ operating_hours: { tz: TZ } }],
    },
  });

beforeEach(() => {
  sent.length = 0;
  rolesAsked.length = 0;
});

describe("the Med-Stop connection alert", () => {
  it("says nothing while the key is far off and the last sweep worked", async () => {
    const rec = recorder(credential());
    expect(await alertMedstopConnection(rec.client, ORG, NOW)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("tells the admins once per threshold per key — a new key starts over", async () => {
    const rec = recorder(credential({ key_expires_on: "2026-10-25" })); // 10 days left
    expect(await alertMedstopConnection(rec.client, ORG, NOW)).toBe(1);
    expect(rolesAsked).toEqual([["admin"]]);
    expect(sent.map((n) => [n.userId, n.category, n.severity, n.dedupeKey])).toEqual([
      ["u-admin", "medstop_connection", "warning", "medstop-key:2026-10-25:14"],
    ]);
    expect(sent[0]!.title).toBe("Med-Stop API key expires soon");
    expectOrgScoped(rec, ORG);
  });

  it("says the key expired once the day has passed, and that the sweep failed, separately", async () => {
    const rec = recorder(credential({ key_expires_on: "2026-10-14", last_error: "Med-Stop (401) S_NOTAUTHENTICATED" }));
    await alertMedstopConnection(rec.client, ORG, NOW);
    expect(sent.map((n) => n.dedupeKey)).toEqual(["medstop-key:2026-10-14:expired", "medstop-sweep:failed:2026-10-15"]);
    expect(sent.every((n) => n.severity === "critical")).toBe(true);
  });

  it("calls a sweep that has not run for more than three hours stopped, once a day", () => {
    const notices = medstopConnectionNotices(
      { keyExpiresOn: null, lastSyncedAt: "2026-10-15T14:00:00Z", lastError: null },
      "2026-10-15",
      NOW.getTime(),
      TZ,
    );
    expect(notices.map((n) => [n.title, n.dedupeKey])).toEqual([["Med-Stop has not been read", "medstop-sweep:stopped:2026-10-15"]]);
    expect(notices[0]!.body).toContain("10/15/2026");
  });

  it("is silent with no connection, and never throws into the scheduler", async () => {
    expect(await alertMedstopConnection(recorder(null).client, ORG, NOW)).toBe(0);
    const broken = createSupabaseRecorder({ tables: { medstop_credentials: { data: null, error: { message: "boom" } } } });
    expect(await alertMedstopConnection(broken.client, ORG, NOW)).toBe(0);
  });
});
