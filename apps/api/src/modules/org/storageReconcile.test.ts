import { describe, expect, it } from "vitest";
import {
  planStorageReconcile,
  reconcileApplicationCaptureOrphans,
  reconcileComplianceDocOrphans,
  reconcileHazmatStorageOrphans,
  reconcileLoadPhotoOrphans,
  reconcileChatFileOrphans,
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
 * The hazmat ORIGINAL of record (D-SCAN11, columns from 0327) is recorded at registration and
 * uploaded when the driver reaches an unmetered connection — days later, on a phone that spends its
 * week on cellular. Every path this planner knew about before was written before or with its row, so
 * "a row names it and it is not there" could only mean the object was lost.
 *
 * Both halves are asserted because the sweep runs nightly with `apply: true` and gets BOTH wrong
 * without this: it would flag every pending original as possible evidence loss, and — because
 * `orphanObjects` deletes any object no row path covers — delete the original 24 hours after it
 * finally landed. The evidence would have had a one-day life.
 */
describe("planStorageReconcile — a deferred upload (D-SCAN11)", () => {
  const YEAR_AGO = "2025-08-06T12:00:00Z"; // past the 30-day pending grace

  it("does not delete an original that has landed, though no storage_path names it", () => {
    const p = planStorageReconcile(
      [{ path: "o/l/a.original.jpg", createdAt: OLD }],
      [],
      NOW,
      DAY,
      [{ path: "o/l/a.original.jpg", since: RECENT }],
    );
    expect(p.orphanObjects).toEqual([]);
  });

  it("stays silent about an original that has not uploaded yet", () => {
    const p = planStorageReconcile([], [], NOW, DAY, [{ path: "o/l/a.original.jpg", since: RECENT }]);
    expect(p.missingObjects).toEqual([]);
    expect(p.orphanObjects).toEqual([]);
  });

  it("reports a deferred upload that never happened, once it is past the pending grace", () => {
    const p = planStorageReconcile([], [], NOW, DAY, [{ path: "o/l/a.original.jpg", since: YEAR_AGO }]);
    expect(p.missingObjects).toEqual(["o/l/a.original.jpg"]);
  });

  it("still flags a missing archive immediately — deferral is not contagious", () => {
    const p = planStorageReconcile(
      [],
      ["o/l/a.orig.jpg"],
      NOW,
      DAY,
      [{ path: "o/l/a.original.jpg", since: RECENT }],
    );
    expect(p.missingObjects).toEqual(["o/l/a.orig.jpg"]);
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
/**
 * A table read the way PostgREST answers it: `select().order().range()`, and never more than 1,000
 * rows a response whatever range is asked for. The cap is the point — an unpaged read of a larger
 * index is how this sweep deleted 1,947 filed documents' files in October 2026.
 */
const POSTGREST_CAP = 1000;
function indexTable(
  rows: Array<Record<string, string>> | { error: string },
  onSelect?: (columns: string) => void,
) {
  return {
    select(columns: string) {
      onSelect?.(columns);
      const answer = (from: number, to: number) =>
        "error" in rows
          ? { data: null, error: { message: rows.error } }
          : { data: rows.slice(from, Math.min(to + 1, from + POSTGREST_CAP)), error: null };
      const query = {
        order: () => query,
        range: async (from: number, to: number) => answer(from, to),
        // An unpaged `await select()` gets the first 1,000 — what production really does.
        then: (resolve: (v: unknown) => void) => resolve(answer(0, Number.MAX_SAFE_INTEGER)),
      };
      return query;
    },
  };
}

interface StubCall {
  /** The FIRST table read — the bucket's primary index. */
  table?: string;
  /** Every table read, in order, for a bucket indexed by more than one. */
  tables?: string[];
  bucket?: string;
  columns?: string;
}

function stubAdmin(calls: StubCall) {
  return {
    from(table: string) {
      calls.table ??= table;
      calls.tables = [...(calls.tables ?? []), table];
      return indexTable([], (columns) => {
        calls.columns = columns;
      });
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

  /**
   * D-AW15 (C3s1): an adopted signature is a PNG in `compliance-docs` with a `signature_adoptions` row
   * and no `documents` row. Swept against `documents` alone it is an orphan, deleted a day after the
   * driver made it.
   */
  it("compliance-docs also reads `signature_adoptions`, which names objects no `documents` row does", async () => {
    const calls: StubCall = {};
    await reconcileComplianceDocOrphans(stubAdmin(calls), { apply: false });
    expect(calls.tables).toEqual(["documents", "signature_adoptions"]);
  });

  it("keeps an adopted signature's object past the grace, and deletes a true orphan beside it", async () => {
    const removed: string[] = [];
    const admin = {
      from: (table: string) =>
        indexTable(table === "signature_adoptions" ? [{ storage_path: "org/driver/d/adopted.png" }] : []),
      storage: {
        from: () => ({
          list: async (prefix: string) =>
            prefix === ""
              ? { data: [{ name: "org", id: null }], error: null }
              : prefix === "org"
                ? { data: [{ name: "driver", id: null }], error: null }
                : prefix === "org/driver"
                  ? { data: [{ name: "d", id: null }], error: null }
                  : {
                      data: [
                        { name: "adopted.png", id: "o1", created_at: "2026-08-01T00:00:00Z" },
                        { name: "stray.png", id: "o2", created_at: "2026-08-01T00:00:00Z" },
                      ],
                      error: null,
                    },
          remove: async (paths: string[]) => {
            removed.push(...paths);
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
        }),
      },
    } as never;
    const r = await reconcileComplianceDocOrphans(admin, { apply: true, nowIso: "2026-08-21T00:00:00Z" });
    expect(removed).toEqual(["org/driver/d/stray.png"]);
    expect(r.deleted).toBe(1);
  });

  it("refuses to sweep when the second index cannot be read, rather than treating its objects as orphans", async () => {
    const admin = {
      from: (table: string) => indexTable(table === "signature_adoptions" ? { error: "permission denied" } : []),
      storage: {
        from: () => ({
          list: async () => ({ data: [], error: null }),
          remove: async () => {
            throw new Error("remove must not be called");
          },
        }),
      },
    } as never;
    await expect(reconcileComplianceDocOrphans(admin, { apply: true })).rejects.toThrow("permission denied");
  });

  it("hazmat reconciles against `hazmat_documents`", async () => {
    const calls: StubCall = {};
    await reconcileHazmatStorageOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("hazmat");
    expect(calls.table).toBe("hazmat_documents");
  });

  /**
   * The hazmat sweep is the only one that reads a second path column, and reading it is what stops
   * the nightly `apply: true` pass deleting every uploaded ORIGINAL as an orphan. A column name is
   * usually not worth an assertion; this one is the difference between evidence and a one-day file.
   */
  it("hazmat selects the ORIGINAL's path as well, or the sweep would delete it", async () => {
    const calls: StubCall = {};
    await reconcileHazmatStorageOrphans(stubAdmin(calls), { apply: false });
    expect(calls.columns).toContain("original_storage_path");
    expect(calls.columns).toContain("created_at"); // a deferral has to be able to expire
  });

  it("the other buckets have no deferred column and still select storage_path alone", async () => {
    const calls: StubCall = {};
    await reconcileLoadPhotoOrphans(stubAdmin(calls), { apply: false });
    expect(calls.columns).toBe("storage_path");
  });

  it("chat-files reconciles against `chat_attachments` (0539), so an upload nobody sent is swept", async () => {
    const calls: StubCall = {};
    await reconcileChatFileOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("chat-files");
    expect(calls.table).toBe("chat_attachments");
    expect(calls.columns).toBe("storage_path");
  });

  it("load-photos reconciles against `load_stop_photos`", async () => {
    const calls: StubCall = {};
    await reconcileLoadPhotoOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("load-photos");
    expect(calls.table).toBe("load_stop_photos");
  });

  /**
   * A8. The first bucket in this sweep that is NOT an evidence store, and it is here for the opposite
   * reason: staged captures are registered only after their bytes land, so orphan objects are the
   * routine failure — every upload whose confirm never arrived, every superseded re-shoot whose
   * removal failed. Without this pass a driver's four attempts at one licence photograph would be
   * billed indefinitely with nothing pointing at them.
   */
  it("application-captures reconciles against `application_captures`", async () => {
    const calls: StubCall = {};
    await reconcileApplicationCaptureOrphans(stubAdmin(calls), { apply: false });
    expect(calls.bucket).toBe("application-captures");
    expect(calls.table).toBe("application_captures");
  });

  /**
   * A11a's other half, as the composition it actually is.
   *
   * The retention rule deletes `application_captures` ROWS and nothing else — there is no code in it
   * that knows about Storage. What removes a pruned candidate's licence photograph is this sweep,
   * one pass later, finding an object no row references. Two mechanisms built for other reasons, and
   * the policy is the composition; this is the assertion that says so out loud, because a reader of
   * either half alone would reasonably conclude the bytes were being left behind.
   */
  it("collects the object of a capture row retention has deleted, once the grace has passed", async () => {
    const admin = {
      // The row is gone — retention pruned it — so the bucket's object references nothing.
      from: () => indexTable([]),
      storage: {
        from: () => ({
          list: async (prefix: string) =>
            prefix === ""
              ? { data: [{ name: "abandoned.webp", id: "obj-1", created_at: "2026-08-01T00:00:00Z" }], error: null }
              : { data: [], error: null },
          remove: async (paths: string[]) => ({ data: paths.map((p) => ({ name: p })), error: null }),
        }),
      },
    } as never;
    const r = await reconcileApplicationCaptureOrphans(admin, { apply: true, nowIso: "2026-08-21T00:00:00Z" });
    expect(r.orphanObjects).toEqual(["abandoned.webp"]);
    expect(r.deleted).toBe(1);
  });

  /** And the same object inside the 24-hour grace is an upload in flight, not an orphan. */
  it("leaves an object alone while it could still be an upload in progress", async () => {
    const admin = {
      from: () => indexTable([]),
      storage: {
        from: () => ({
          list: async (prefix: string) =>
            prefix === ""
              ? { data: [{ name: "inflight.webp", id: "obj-2", created_at: "2026-08-20T23:00:00Z" }], error: null }
              : { data: [], error: null },
          remove: async () => {
            throw new Error("remove must not be called inside the grace window");
          },
        }),
      },
    } as never;
    const r = await reconcileApplicationCaptureOrphans(admin, { apply: true, nowIso: "2026-08-21T00:00:00Z" });
    expect(r.orphanObjects).toEqual([]);
    expect(r.deleted).toBe(0);
  });

  it("never deletes a `documents` row — a missing object is flagged, the claim survives", async () => {
    const admin = {
      from: (table: string) => indexTable(table === "documents" ? [{ storage_path: "org/driver/d/gone.webp" }] : []),
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

  /**
   * The 2026-10-26 incident, as a test. 2,500 `documents` rows each with its object, every object
   * past the grace: nothing is an orphan. Read with one unpaged `select`, the sweep saw the first
   * 1,000 rows and deleted the other 1,500 files.
   */
  it("reads every documents row past PostgREST's 1,000-row cap, so no filed document is taken for an orphan", async () => {
    const paths = Array.from({ length: 2500 }, (_, i) => `org/tractor/t/${String(i).padStart(4, "0")}.pdf`);
    const removed: string[] = [];
    const admin = {
      from: (table: string) => indexTable(table === "documents" ? paths.map((p) => ({ storage_path: p })) : []),
      storage: {
        from: () => ({
          list: async (prefix: string, opts: { limit: number; offset: number }) => {
            if (prefix === "") return { data: [{ name: "org", id: null }], error: null };
            if (prefix === "org") return { data: [{ name: "tractor", id: null }], error: null };
            if (prefix === "org/tractor") return { data: [{ name: "t", id: null }], error: null };
            const page = paths.slice(opts.offset, opts.offset + opts.limit);
            return {
              data: page.map((p) => ({ name: p.split("/").pop(), id: p, created_at: "2026-10-01T00:00:00Z" })),
              error: null,
            };
          },
          remove: async (batch: string[]) => {
            removed.push(...batch);
            return { data: batch.map((p) => ({ name: p })), error: null };
          },
        }),
      },
    } as never;
    const r = await reconcileComplianceDocOrphans(admin, { apply: true, nowIso: "2026-10-26T12:00:00Z" });
    expect(r.scanned).toBe(2500);
    expect(r.orphanObjects).toEqual([]);
    expect(removed).toEqual([]);
  });
});
