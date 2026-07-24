import { describe, it, expect } from "vitest";
import { computeAttributionHealth } from "./attributionHealth.js";

const row = (over: Partial<{ vehicle_id: string | null; driver_id: string | null; card_ref: string | null; control_id: string | null }> = {}) => ({
  vehicle_id: "v1" as string | null,
  driver_id: "d1" as string | null,
  card_ref: "7083050030281917521" as string | null,
  control_id: null as string | null,
  ...over,
});

describe("computeAttributionHealth (WP3 — chronic unattribution escalates)", () => {
  it("fully attributed fills → nothing to report", () => {
    expect(computeAttributionHealth([row(), row()])).toEqual({ total: 0, clusters: [] });
  });
  it("counts fills missing a vehicle OR a driver", () => {
    const h = computeAttributionHealth([row({ vehicle_id: null }), row({ driver_id: null }), row()]);
    expect(h.total).toBe(2);
  });
  it("clusters ≥3 unattributed fills on one card, biggest first; masked label", () => {
    const h = computeAttributionHealth([
      ...Array.from({ length: 4 }, () => row({ vehicle_id: null })),
      ...Array.from({ length: 3 }, () => row({ vehicle_id: null, card_ref: "1111222233334444" })),
      row({ vehicle_id: null, card_ref: "9999" }), // only 1 — below the cluster floor
    ]);
    expect(h.total).toBe(8);
    expect(h.clusters).toEqual([
      { card: "•••• 7521", count: 4 },
      { card: "•••• 4444", count: 3 },
    ]);
  });
  it("masked last-4 clusters are disambiguated by control id; cardless fills are grouped honestly", () => {
    const h = computeAttributionHealth([
      ...Array.from({ length: 3 }, () => row({ vehicle_id: null, card_ref: "7521", control_id: "AAA" })),
      ...Array.from({ length: 3 }, () => row({ vehicle_id: null, card_ref: null })),
    ]);
    expect(new Set(h.clusters.map((c) => c.card))).toEqual(new Set(["•••• 7521 (driver AAA)", "no card recorded"]));
  });
});
