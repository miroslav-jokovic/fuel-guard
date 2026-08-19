import { describe, expect, it } from "vitest";
import {
  planStorageReconcile,
  reconcileComplianceDocOrphans,
  reconcileHazmatStorageOrphans,
  reconcileLoadPhotoOrphans,
} from "./storageReconcile.js";

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

/**
 * Which bucket each reconciler actually points at (DQF plan B7).
 *
 * These read like trivia until you remember the bug they exist for: `compliance-docs` shipped with
 * 0146 and was never added to the sweep, so its orphans were billed indefinitely while two other
 * buckets were swept nightly. The binding between a bucket and the table that indexes it is the
 * whole safety property here — point `documents` at the wrong bucket and every object in it looks
 * like an orphan.
 */
interface StubCall {
  table?: string;
  bucket?: string;
}

function stubAdmin(calls: StubCall) {
  return {
    from(table: string) {
      calls.table = table;
      return { select: async () => ({ data: [], error: null }) };
    },
    storage: {
      from(bucket: string) {
        calls.bucket = bucket;
        return {
          list: async () => ({ data: [], error: null }),
          remove: async () => ({ error: null }),
        };
      },
    },
  } as never;
}

describe("bucket ↔ table bindings", () => {
  it("compliance-docs reconciles against `documents` (B7 — the bucket that had no sweep at all)", async () => {
    const calls: StubCall = {};
    await reconcileComplianceDocOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("compliance-docs");
    expect(calls.table).toBe("documents");
  });

  it("hazmat reconciles against `hazmat_documents`", async () => {
    const calls: StubCall = {};
    await reconcileHazmatStorageOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("hazmat");
    expect(calls.table).toBe("hazmat_documents");
  });

  it("load-photos reconciles against `load_stop_photos`", async () => {
    const calls: StubCall = {};
    await reconcileLoadPhotoOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("load-photos");
    expect(calls.table).toBe("load_stop_photos");
  });

  it("never deletes a `documents` row — a missing object is flagged, the claim survives", async () => {
    const admin = {
      from: () => ({ select: async () => ({ data: [{ storage_path: "org/driver/d/gone.webp" }], error: null }) }),
      storage: {
        from: () => ({
          list: async () => ({ data: [], error: null }),
          remove: async () => {
            throw new Error("remove must not be called when there are no orphan objects");
          },
        }),
      },
    } as never;
    const r = await reconcileComplianceDocOrphans(admin, { apply: true });
    expect(r.missingObjects).toEqual(["org/driver/d/gone.webp"]);
    expect(r.deleted).toBe(0);
  });
});
