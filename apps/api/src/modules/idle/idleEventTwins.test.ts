import { describe, it, expect } from "vitest";
import { resolveIdleEventTwins, repairIdleEventTwins } from "./idleEventTwins.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * The idle_events twin clean-up (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md I0). Ids are real production pairs
 * (2026-10-01): a UUID and the hex of the uppercase ASCII of its first sixteen digits.
 */
const ORG = "org1";

const P1 = "3411b05c-3d84-4ad3-bcbe-4c6d819a6f15";
const H1 = "33343131-4230-3543-3344-383434414433";
const P2 = "28f44530-8860-4088-9d0c-5e57addbc476";
const H2 = "32384634-3435-3330-3838-363034303838";
const S3 = "2560e36b-3501-42b5-bdeb-19d8c91ec3ce"; // a single, no twin
const P4 = "ddf15eb8-1d3e-458c-b0fa-35679ef2825f";
const H4 = "44444631-3545-4238-3144-334534353843";

const row = (id: string, sid: string, started: string, created: string, key: string | null = null) => ({
  id,
  samsara_event_id: sid,
  started_at: started,
  created_at: created,
  event_key: key,
});

/** `idle_events` answers the unkeyed read (`.is()`) and the by-key lookup (`.in()`) apart. */
const recorder = (unkeyed: unknown[], keyed: unknown[]) =>
  createSupabaseRecorder({
    tables: {
      idle_events: (q: RecordedQuery) => (q.ops.some((o) => o.method === "is") ? unkeyed : keyed),
      audit_logs: [],
    },
    rpc: (_fn, args) => {
      const a = args as { p_delete: string[]; p_keys: unknown[] };
      return { deleted: a.p_delete.length, keyed: a.p_keys.length };
    },
  });

describe("resolveIdleEventTwins", () => {
  const unkeyed = [
    row("r-p1", P1, "2026-08-15T14:07:36Z", "2026-08-16T00:00:00Z"),
    row("r-h1", H1, "2026-08-15T14:07:36Z", "2026-09-14T14:13:10Z"),
    row("r-p2", P2, "2026-09-02T19:10:32Z", "2026-09-03T00:00:00Z"),
    row("r-s3", S3, "2026-09-20T08:00:00Z", "2026-09-21T00:00:00Z"),
    row("r-h4", H4, "2026-09-28T01:00:00Z", "2026-09-30T02:00:00Z"),
  ];
  const keyed = [
    // H2's spelling was keyed first; the real-UUID spelling still wins.
    row("r-h2", H2, "2026-09-02T19:10:32Z", "2026-09-15T00:00:00Z", "28f4453088604088"),
    // P4 was keyed first, and IS the real UUID: it survives without being re-keyed.
    row("r-p4", P4, "2026-09-28T01:00:00Z", "2026-09-28T02:00:00Z", "ddf15eb81d3e458c"),
  ];

  it("keeps the real-UUID spelling of each event, deletes the other, keys every survivor that had no key", async () => {
    const rec = recorder(unkeyed, keyed);
    const r = await resolveIdleEventTwins(rec.client, ORG);

    const calls = rec.rpcs();
    expect(calls.map((c) => c.fn)).toEqual(["resolve_idle_event_twins"]);
    const args = calls[0]!.args as { p_org: string; p_delete: string[]; p_keys: { id: string; event_key: string }[] };
    expect(args.p_org).toBe(ORG);
    expect(new Set(args.p_delete)).toEqual(new Set(["r-h1", "r-h2", "r-h4"]));
    expect(new Set(args.p_keys.map((k) => `${k.id}=${k.event_key}`))).toEqual(
      new Set(["r-p1=3411b05c3d844ad3", "r-p2=28f4453088604088", "r-s3=2560e36b350142b5"]),
    );

    expect(r).toMatchObject({ unkeyed: 5, deleted: 3, keyed: 3 });
    expect(r.earliestTwinStartedAt).toBe("2026-08-15T14:07:36Z");
    expect(r.latestTwinStartedAt).toBe("2026-09-28T01:00:00Z");
    // When the first DELETED row was written — the 09/14 sync that started storing the second spelling.
    expect(r.earliestTwinCreatedAt).toBe("2026-09-14T14:13:10Z");
  });

  it("asks for keyed rows only by the keys it computed, and scopes every read to the org", async () => {
    const rec = recorder(unkeyed, keyed);
    await resolveIdleEventTwins(rec.client, ORG);
    const lookup = rec.forTable("idle_events").find((q) => q.ops.some((o) => o.method === "in"));
    const asked = lookup?.filters().find((f) => f.col === "event_key")?.val as string[];
    expect(new Set(asked)).toEqual(
      new Set(["3411b05c3d844ad3", "28f4453088604088", "2560e36b350142b5", "ddf15eb81d3e458c"]),
    );
    expectOrgScoped(rec, ORG);
  });

  it("writes one audit row saying what it removed", async () => {
    const rec = recorder(unkeyed, keyed);
    await resolveIdleEventTwins(rec.client, ORG);
    const audits = rec.writtenRows("audit_logs");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ org_id: ORG, action: "idle.event_twins_removed", entity: "idle_events" });
    expect(audits[0]!.meta).toMatchObject({ deleted: 3, keyed: 3, earliestTwinStartedAt: "2026-08-15T14:07:36Z" });
  });

  it("never splits a pair across two calls, so a twin is deleted in the statement that keys its survivor", async () => {
    // 400 pairs = 800 ids, past one call's 500.
    const many = Array.from({ length: 400 }, (_, i) => {
      const hex = (0x10000000 + i).toString(16); // 8 hex digits, never in the ASCII-code range
      const plain = `${hex}-aaaa-4bbb-8ccc-dddddddddddd`;
      const encoded = [...`${hex}aaaa4bbb`.toUpperCase()]
        .map((c) => c.charCodeAt(0).toString(16))
        .join("")
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
      return [
        row(`p${i}`, plain, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
        row(`h${i}`, encoded, "2026-09-01T00:00:00Z", "2026-09-20T00:00:00Z"),
      ];
    }).flat();
    // One single in front, so a call boundary can land BETWEEN a survivor's key and its twin's delete.
    const rec = recorder([row("single", S3, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"), ...many], []);
    const r = await resolveIdleEventTwins(rec.client, ORG);
    expect(r.deleted).toBe(400);
    const calls = rec.rpcs().map((c) => c.args as { p_delete: string[]; p_keys: { id: string }[] });
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      const keyedIds = new Set(c.p_keys.map((k) => k.id));
      for (const d of c.p_delete) expect(keyedIds.has(`p${d.slice(1)}`)).toBe(true);
    }
  });

  it("does nothing — no write, no audit — once every row is keyed", async () => {
    const rec = recorder([], []);
    const r = await resolveIdleEventTwins(rec.client, ORG);
    expect(r).toMatchObject({ unkeyed: 0, keyed: 0, deleted: 0 });
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});

describe("repairIdleEventTwins", () => {
  const NOW = Date.parse("2026-10-01T18:00:00Z");

  it("rebuilds the rollup back to the earliest twinned day and re-freezes from the twins' span", async () => {
    const rec = recorder(
      [
        row("r-p1", P1, "2026-08-15T14:07:36Z", "2026-08-16T00:00:00Z"),
        row("r-h1", H1, "2026-08-15T14:07:36Z", "2026-09-14T14:13:10Z"),
      ],
      [],
    );
    const rollups: number[] = [];
    const spans: unknown[] = [];
    const r = await repairIdleEventTwins(rec.client, ORG, {
      nowMs: NOW,
      rollup: async (d) => void rollups.push(d),
      refreeze: async (span) => (spans.push(span), ["2026-08-17", "2026-08-24"]),
    });
    // 08/15 14:07 → 10/01 18:00 is 47.2 days; the rollup window reaches back past it.
    expect(rollups).toEqual([49]);
    expect(spans).toEqual([{ windowFromIso: "2026-08-15T14:07:36Z", settledSinceIso: "2026-09-14T14:13:10Z" }]);
    expect(r.weeksRefrozen).toEqual(["2026-08-17", "2026-08-24"]);
    expect(r.rollupDays).toBe(49);
  });

  it("owes nothing downstream when it only keyed rows", async () => {
    const rec = recorder([row("r-s3", S3, "2026-09-20T08:00:00Z", "2026-09-21T00:00:00Z")], []);
    let called = false;
    const r = await repairIdleEventTwins(rec.client, ORG, {
      nowMs: NOW,
      rollup: async () => void (called = true),
      refreeze: async () => ((called = true), []),
    });
    expect(r.keyed).toBe(1);
    expect(called).toBe(false);
    expect(r.rollupDays).toBeNull();
  });
});
