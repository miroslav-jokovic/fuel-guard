import { describe, it, expect } from "vitest";
import { anomalyStatusesIn } from "@silvicom/shared";
import { flaggedCasesLink } from "./flaggedCasesLink";

/**
 * Chunk 11a (AUDIT.md N5). The tile counts fills with an open case (migration 0446) and this is the one
 * address that opens them. Every assertion reads the link back through `URLSearchParams`, the way the
 * Alerts page's `useQueryState` will, so a test cannot pass on a string that only looks right.
 */
const params = (to: string | null) => {
  expect(to).not.toBeNull();
  const [path, query] = (to as string).split("?");
  return { path, q: new URLSearchParams(query) };
};

describe("flaggedCasesLink", () => {
  it("opens the Alerts work queue for the window, with the status the queue calls open", () => {
    const { path, q } = params(flaggedCasesLink({ from: "2026-09-01", to: "2026-09-30" }));
    expect(path).toBe("/anomalies");
    expect(q.get("status")).toBe(anomalyStatusesIn("open")[0]);
    expect(q.get("from")).toBe("2026-09-01");
    expect(q.get("to")).toBe("2026-09-30");
    expect(q.has("vehicle")).toBe(false);
  });

  it("carries the trucks as the Alerts page's comma list, so a filtered tile opens those trucks' cases", () => {
    const { q } = params(flaggedCasesLink({ from: "2026-09-01", to: "2026-09-30", vehicleIds: ["v1", "v2"] }));
    expect(q.get("vehicle")?.split(",")).toEqual(["v1", "v2"]);
    // A link that names trucks without a status opens their WHOLE history on the Alerts page, dismissed
    // cases included — the exact set the tile no longer counts.
    expect(q.get("status")).toBe("open");
  });

  it("omits an unset end rather than sending an empty one", () => {
    const { q } = params(flaggedCasesLink({ from: "2026-09-01" }));
    expect(q.get("from")).toBe("2026-09-01");
    expect(q.has("to")).toBe(false);
  });

  it.each([
    ["a driver", { driverId: "d1" }],
    ["a fuel type", { tankType: "reefer" as const }],
    ["a search term", { search: "Pilot" }],
  ])("offers no link under %s, which the Alerts page cannot narrow by", (_label, facet) => {
    expect(flaggedCasesLink({ from: "2026-09-01", to: "2026-09-30", ...facet })).toBeNull();
  });

  it("offers no link when the units named are in no fleet — an empty list is nothing, not everything", () => {
    expect(flaggedCasesLink({ from: "2026-09-01", vehicleIds: [] })).toBeNull();
  });
});
