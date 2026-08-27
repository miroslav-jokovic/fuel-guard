import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLoadDetail } from "./detail.js";

/**
 * The load point-read (LD1). Three properties are worth pinning, and each of them is a bug this
 * codebase actually shipped:
 *
 *   1. Stop photos reach dispatch AT ALL. Rows, bytes and permissions have existed since 0085 and
 *      nothing ever read them, so the office has never seen a driver's proof of work.
 *   2. A signing failure degrades to `url: null` rather than taking the whole page down. Storage is
 *      the least reliable dependency here and the stops, timeline and checklist are still worth showing.
 *   3. The org boundary is a filter on the read, not a check afterwards — a load id from another
 *      tenant returns null.
 *   4. The hazmat record rides along (H-C1). Before the link existed, hazmat was a parallel load
 *      entity reached from its own navigation section; this field is what lets it be a section of
 *      the load instead.
 *
 * A hand-rolled Supabase stub, like `dutySessions.test.ts`: the SQL itself is covered by the
 * behavioural matrices against real Postgres.
 */

type TableRows = Record<string, unknown[]>;

interface StubOptions {
  tables?: TableRows;
  /** Simulate Storage refusing to sign — the whole call throws, as the client does on a network fault. */
  signThrows?: boolean;
  /** Simulate the photo table read failing. */
  photoQueryError?: boolean;
  /** Record the filters applied per table so a test can assert the org scope. */
  filters?: { table: string; column: string; value: unknown }[];
}

function stubAdmin(opts: StubOptions): SupabaseClient {
  const tables = opts.tables ?? {};
  const builder = (table: string, rows: unknown[], error: { message: string } | null): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "order", "in", "is", "not", "limit", "or", "lte", "gte"]) self[m] = () => self;
    self.eq = (column: string, value: unknown) => {
      opts.filters?.push({ table, column, value });
      return self;
    };
    self.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error });
    self.then = (resolve: (v: { data: unknown[]; error: { message: string } | null }) => unknown) =>
      resolve({ data: rows, error });
    return self;
  };
  return {
    from: (table: string) =>
      builder(
        table,
        tables[table] ?? [],
        table === "load_stop_photos" && opts.photoQueryError ? { message: "boom" } : null,
      ),
    storage: {
      from: () => ({
        createSignedUrls: (paths: string[]) => {
          if (opts.signThrows) throw new Error("storage unreachable");
          return Promise.resolve({
            data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}` })),
            error: null,
          });
        },
      }),
    },
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null } }) } },
  } as unknown as SupabaseClient;
}

const ORG = "00000000-0000-4000-8000-0000000000f0";
const LOAD = "00000000-0000-4000-8000-00000000a001";
const STOP = "00000000-0000-4000-8000-00000000b001";

const loadRow = {
  id: LOAD,
  ref: "LD-1001",
  status: "in_transit",
  approved_by: "00000000-0000-4000-8000-00000000c001",
  approved_at: "2026-08-07T10:00:00.000Z",
  released_at: "2026-08-07T10:05:00.000Z",
  drivers: { full_name: "Marcus Hale" },
  vehicles: { unit_number: "214" },
  trailers: null,
};

const stopRow = { id: STOP, seq: 1, kind: "pickup", name: "Shipper", status: "completed", skip_reason: null };

const photoRow = {
  id: "00000000-0000-4000-8000-00000000e001",
  stop_id: STOP,
  slot: "bol",
  storage_path: `${ORG}/driver/${LOAD}/photo.jpg`,
  captured_at: "2026-08-07T11:00:00.000Z",
  uploaded_at: "2026-08-07T11:30:00.000Z",
};

const fullTables: TableRows = {
  loads: [loadRow],
  load_stops: [stopRow],
  load_stop_photos: [photoRow],
  load_events: [],
};

const hazmatRow = {
  id: "00000000-0000-4000-8000-00000000d001",
  status: "cleared",
  tank_state: "loaded",
  created_at: "2026-08-07T09:00:00.000Z",
  updated_at: "2026-08-07T12:00:00.000Z",
};

const runRow = { outcome: "green", created_at: "2026-08-07T11:45:00.000Z" };

describe("getLoadDetail", () => {
  it("returns null when the load is not this organization's", async () => {
    const detail = await getLoadDetail(stubAdmin({ tables: { loads: [] } }), ORG, LOAD);
    expect(detail).toBeNull();
  });

  it("scopes every read by org_id — the boundary is the query, not a check afterwards", async () => {
    const filters: StubOptions["filters"] = [];
    await getLoadDetail(stubAdmin({ tables: fullTables, filters }), ORG, LOAD);
    for (const table of ["loads", "load_stops", "load_stop_photos"]) {
      expect(filters.filter((f) => f.table === table && f.column === "org_id" && f.value === ORG)).toHaveLength(1);
    }
  });

  it("nests each stop's captured photos with signed URLs — the thing dispatch has never been able to see", async () => {
    const detail = (await getLoadDetail(stubAdmin({ tables: fullTables }), ORG, LOAD)) as {
      stops: { id: string; photos: { slot: string; url: string | null }[] }[];
    };
    expect(detail.stops).toHaveLength(1);
    expect(detail.stops[0]!.photos).toHaveLength(1);
    expect(detail.stops[0]!.photos[0]!.slot).toBe("bol");
    expect(detail.stops[0]!.photos[0]!.url).toContain("https://signed.example/");
  });

  it("flattens the joins and keeps every lifecycle timestamp the list type used to drop", async () => {
    const detail = (await getLoadDetail(stubAdmin({ tables: fullTables }), ORG, LOAD)) as Record<string, unknown>;
    expect(detail.driver_name).toBe("Marcus Hale");
    expect(detail.vehicle_unit).toBe("214");
    expect(detail.trailer_unit).toBeNull();
    expect(detail.approved_by).toBe(loadRow.approved_by);
    expect(detail.released_at).toBe(loadRow.released_at);
    expect(detail).not.toHaveProperty("drivers");
  });

  it("degrades to url: null when Storage will not sign, rather than failing the page", async () => {
    const detail = (await getLoadDetail(stubAdmin({ tables: fullTables, signThrows: true }), ORG, LOAD)) as {
      stops: { photos: { url: string | null }[] }[];
    };
    expect(detail.stops[0]!.photos[0]!.url).toBeNull();
  });

  it("carries no hazmat record for an ordinary load — the common case, and the correct shape", async () => {
    const detail = (await getLoadDetail(stubAdmin({ tables: fullTables }), ORG, LOAD)) as Record<string, unknown>;
    expect(detail.hazmat_record).toBeNull();
  });

  it("surfaces the linked hazmat record and its newest analysis outcome (H-C1)", async () => {
    const detail = (await getLoadDetail(
      stubAdmin({ tables: { ...fullTables, hazmat_loads: [hazmatRow], hazmat_runs: [runRow] } }),
      ORG,
      LOAD,
    )) as { hazmat_record: { id: string; status: string; latest_outcome: string | null; latest_run_at: string | null } };
    expect(detail.hazmat_record.id).toBe(hazmatRow.id);
    expect(detail.hazmat_record.status).toBe("cleared");
    expect(detail.hazmat_record.latest_outcome).toBe("green");
    expect(detail.hazmat_record.latest_run_at).toBe(runRow.created_at);
  });

  it("reports no outcome for a hazmat record that has never been analysed", async () => {
    const detail = (await getLoadDetail(
      stubAdmin({ tables: { ...fullTables, hazmat_loads: [hazmatRow], hazmat_runs: [] } }),
      ORG,
      LOAD,
    )) as { hazmat_record: { latest_outcome: string | null } };
    expect(detail.hazmat_record.latest_outcome).toBeNull();
  });

  it("still returns the load when the photo table read fails outright", async () => {
    const detail = (await getLoadDetail(stubAdmin({ tables: fullTables, photoQueryError: true }), ORG, LOAD)) as {
      ref: string;
      stops: { photos: unknown[] }[];
    };
    expect(detail.ref).toBe("LD-1001");
    expect(detail.stops[0]!.photos).toEqual([]);
  });
});
