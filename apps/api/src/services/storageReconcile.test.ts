import { describe, expect, it } from "vitest";
import { planStorageReconcile } from "./storageReconcile.js";

const NOW = "2026-08-06T12:00:00Z";
const OLD = "2026-08-04T12:00:00Z"; // 48h old
const RECENT = "2026-08-06T11:30:00Z"; // 30 min old
const DAY = 24 * 60 * 60 * 1000;

describe("planStorageReconcile (§13.5)", () => {
  it("deletes an object with no row once past the 24h grace", () => {
    const p = planStorageReconcile([{ path: "o/l/a.webp", createdAt: OLD }], [], NOW, DAY);
    expect(p.orphanObjects).toEqual(["o/l/a.webp"]);
    expect(p.missingObjects).toEqual([]);
  });
  it("does NOT delete a recent orphan (within the grace window)", () => {
    const p = planStorageReconcile([{ path: "o/l/a.webp", createdAt: RECENT }], [], NOW, DAY);
    expect(p.orphanObjects).toEqual([]);
  });
  it("keeps an object that has a matching row", () => {
    const p = planStorageReconcile([{ path: "o/l/a.webp", createdAt: OLD }], ["o/l/a.webp"], NOW, DAY);
    expect(p.orphanObjects).toEqual([]);
  });
  it("flags a row whose object is missing, and never puts it in orphanObjects", () => {
    const p = planStorageReconcile([], ["o/l/gone.webp"], NOW, DAY);
    expect(p.missingObjects).toEqual(["o/l/gone.webp"]);
    expect(p.orphanObjects).toEqual([]);
  });
});
