import { describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "./supabaseRecorder.js";
import { postgrestFixture } from "./postgrestFixture.js";

/**
 * The fixture narrows the way PostgREST does, operator by operator. Pinned because until C2d a range
 * filter was compared for EQUALITY and matched nothing, so a drain test could pass by draining nothing.
 */
const ROWS = [
  { id: "a", org_id: "o1", at: "2027-01-01T00:00:00Z", detail: { source: "road_test" } },
  { id: "b", org_id: "o1", at: "2027-01-02T00:00:00Z", detail: { source: "dq" } },
  { id: "c", org_id: "o2", at: "2027-01-03T00:00:00Z", detail: null },
];

const ids = async (build: (q: ReturnType<ReturnType<typeof createSupabaseRecorder>["client"]["from"]>) => PromiseLike<{ data: unknown }>) => {
  const rec = createSupabaseRecorder({ tables: { t: postgrestFixture(ROWS) } });
  const { data } = await build(rec.client.from("t"));
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
};

describe("postgrestFixture", () => {
  it("applies each range operator as its operator, not as equality", async () => {
    expect(await ids((q) => q.select("id").lte("at", "2027-01-02T00:00:00Z"))).toEqual(["a", "b"]);
    expect(await ids((q) => q.select("id").lt("at", "2027-01-02T00:00:00Z"))).toEqual(["a"]);
    expect(await ids((q) => q.select("id").gte("at", "2027-01-02T00:00:00Z"))).toEqual(["b", "c"]);
    expect(await ids((q) => q.select("id").gt("at", "2027-01-02T00:00:00Z"))).toEqual(["c"]);
    expect(await ids((q) => q.select("id").neq("org_id", "o1"))).toEqual(["c"]);
  });

  it("still applies eq, is, match and a JSON path", async () => {
    expect(await ids((q) => q.select("id").eq("org_id", "o1").lte("at", "2027-01-01T00:00:00Z"))).toEqual(["a"]);
    expect(await ids((q) => q.select("id").is("detail", null))).toEqual(["c"]);
    expect(await ids((q) => q.select("id").match({ org_id: "o2" }))).toEqual(["c"]);
    expect(await ids((q) => q.select("id").eq("detail->>source", "road_test"))).toEqual(["a"]);
  });
});
