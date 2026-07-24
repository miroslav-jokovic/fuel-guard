import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestReport, computeShortfall, type IngestDeps, type IngestInput } from "./efsIngest.js";
import { loadEnv, type Env } from "../env.js";

// ── A tiny in-memory Supabase stand-in ───────────────────────────────────────────────────────────
// Supports exactly the query chains efsIngest.ts uses: select/eq/in/limit/single/maybeSingle,
// insert().select().single(), upsert(rows,{onConflict,ignoreDuplicates}), update().eq(), and
// select("id",{count,head}).eq(). It is data-backed so the test proves REAL dedup + shortfall, not
// canned answers. The house style keeps DB plumbing untested (see efsSync.ts); we make an exception
// for ingest because it runs unattended, where a silent write regression would go unnoticed.

type Row = Record<string, unknown>;
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number;
}

type Tables = {
  imports: Row[];
  efs_transactions: Row[];
  fuel_transactions: Row[];
  declined_transactions: Row[];
  vehicles: Row[];
  drivers: Row[];
};

class FakeDb {
  tables: Tables & Record<string, Row[]> = {
    imports: [],
    efs_transactions: [],
    fuel_transactions: [],
    declined_transactions: [],
    vehicles: [],
    drivers: [],
  };
  seq = 0;
  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  private op: "select" | "insert" | "upsert" | "update" = "select";
  private cols = "*";
  private counting = false;
  private singleMode: "" | "single" | "maybe" = "";
  private filters: { col: string; kind: "eq" | "in"; val: unknown }[] = [];
  private payload: Row[] = [];
  private onConflict = "";
  private ignoreDup = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols: string, opts?: { count?: string; head?: boolean }): this {
    this.cols = cols;
    if (opts?.count) this.counting = true;
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.op = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.onConflict = opts?.onConflict ?? "";
    this.ignoreDup = !!opts?.ignoreDuplicates;
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = [patch];
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, kind: "eq", val });
    return this;
  }
  in(col: string, val: unknown[]): this {
    this.filters.push({ col, kind: "in", val });
    return this;
  }
  limit(_n: number): this {
    return this;
  }
  single(): this {
    this.singleMode = "single";
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) =>
      f.kind === "eq" ? row[f.col] === f.val : (f.val as unknown[]).includes(row[f.col]),
    );
  }

  private project(row: Row): Row {
    if (this.cols === "*" || this.cols === "") return row;
    const out: Row = {};
    for (const c of this.cols.split(",").map((s) => s.trim())) out[c] = row[c];
    return out;
  }

  private run(): QueryResult {
    const t = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    if (this.op === "insert") {
      const inserted = this.payload.map((r) => ({ ...r, id: r.id ?? `id_${++this.db.seq}` }));
      t.push(...inserted);
      const data = this.singleMode ? { id: inserted[0]?.id } : inserted.map((r) => ({ id: r.id }));
      return { data, error: null };
    }
    if (this.op === "upsert") {
      const keys = this.onConflict ? this.onConflict.split(",").map((s) => s.trim()) : [];
      for (const r of this.payload) {
        const dup = keys.length > 0 && t.some((e) => keys.every((k) => e[k] === r[k]));
        if (dup && this.ignoreDup) continue;
        t.push({ ...r, id: r.id ?? `id_${++this.db.seq}` });
      }
      return { data: null, error: null };
    }
    if (this.op === "update") {
      for (const row of t) if (this.matches(row)) Object.assign(row, this.payload[0]);
      return { data: null, error: null };
    }
    const rows = t.filter((r) => this.matches(r));
    if (this.counting) return { data: null, error: null, count: rows.length };
    const projected = rows.map((r) => this.project(r));
    if (this.singleMode) return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }

  then<TR1 = QueryResult, TR2 = never>(
    onfulfilled?: ((value: QueryResult) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): Promise<TR1 | TR2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

// ── Fixtures — real Silvicom EFS column headers + a real multi-line invoice (docs/08 §0) ──────────
const TXN_HEADERS = [
  "Card #", "Tran Date", "Invoice", "Unit", "Driver Name", "Odometer", "Location Name",
  "City", "State/ Prov", "Fees", "Item", "Unit Price", "Qty", "Amt", "DB", "Currency",
];
const txnRows = [
  {
    "Card #": "94507", "Tran Date": "2026-06-29", Invoice: "0801987714", Unit: "691",
    "Driver Name": "DONOVAN BOOTHE", Odometer: "293580", "Location Name": "PILOT JAMESTOWN 305",
    City: "JAMESTOWN", "State/ Prov": "NM", Fees: "0.0", Item: "ULSD", "Unit Price": "4.227",
    Qty: "141.7", Amt: "598.91", DB: "Y", Currency: "USD/Gallons",
  },
  {
    "Card #": "94507", "Tran Date": "2026-06-29", Invoice: "0801987714", Unit: "691",
    "Driver Name": "DONOVAN BOOTHE", Odometer: "293580", "Location Name": "PILOT JAMESTOWN 305",
    City: "JAMESTOWN", "State/ Prov": "NM", Fees: "0.0", Item: "DEFD", "Unit Price": "4.999",
    Qty: "5.24", Amt: "26.18", DB: "Y", Currency: "USD/Gallons",
  },
  {
    "Card #": "94036", "Tran Date": "2026-06-29", Invoice: "0482599384", Unit: "704",
    "Driver Name": "DANTE CORTES", Odometer: "220772", Item: "SCLE", "Unit Price": "0.0",
    Qty: "1.0", Amt: "15.25", Currency: "USD/Gallons",
  },
];

const REJECT_HEADERS = [
  "Date", "Time", "Card Number", "Invoice", "Location ID", "Location Name", "Location City",
  "State/Prov", "Error Code", "Error Description", "Unit", "Driver ID", "Driver Name", "Policy", "Policy Name",
];
const rejectRows = [
  {
    Date: "2026-06-29", Time: "14:32:00", "Card Number": "94507", Invoice: "0801987714",
    "Location ID": "305", "Location Name": "PILOT JAMESTOWN 305", "Location City": "JAMESTOWN",
    "State/Prov": "NM", "Error Code": "51", "Error Description": "DECLINE - INSUFFICIENT FUNDS",
    Unit: "691", "Driver ID": "D1", "Driver Name": "DONOVAN BOOTHE", Policy: "P", "Policy Name": "PN",
  },
];

const env: Env = loadEnv({});

function spyDeps() {
  const calls = { scoreImport: [] as string[], scoreDeclined: [] as string[] };
  const deps: IngestDeps = {
    scoreImport: async (_a, _e, _o, importId) => {
      calls.scoreImport.push(importId);
    },
    scoreDeclined: async (_a, _e, _o, importId) => {
      calls.scoreDeclined.push(importId);
    },
  };
  return { calls, deps };
}

function txnInput(fileHash: string, channel?: IngestInput["channel"]): IngestInput {
  return {
    orgId: "org1",
    requestedBy: null,
    source: "xlsx",
    filename: "efs-transactions.xlsx",
    fileHash,
    headers: TXN_HEADERS,
    rows: txnRows,
    channel,
  };
}

describe("computeShortfall", () => {
  it("is zero when everything landed, positive on a gap, never negative, null when unknown", () => {
    expect(computeShortfall(5, 5)).toBe(0);
    expect(computeShortfall(5, 3)).toBe(2);
    expect(computeShortfall(3, 5)).toBe(0);
    expect(computeShortfall(4, null)).toBeNull();
  });
});

describe("ingestReport — transaction report", () => {
  it("stores every line faithfully, derives fuel-only events, reconciles a zero shortfall, and scores", async () => {
    const db = new FakeDb();
    const { calls, deps } = spyDeps();
    const res = await ingestReport(db as unknown as SupabaseClient, env, txnInput("HASH_A", "manual"), deps);

    expect(res.kind).toBe("transaction");
    expect(res.efsLines).toBe(3); // faithful store: ULSD + DEFD + SCLE, every line
    expect(res.newFuel).toBe(1); // fuel-only, merged: just the ULSD line
    expect(res.duplicateEfs).toBe(0);
    expect(res.shortfallRows).toBe(0);
    expect(res.scoreError).toBeNull();

    expect(db.tables.efs_transactions).toHaveLength(3);
    expect(db.tables.fuel_transactions).toHaveLength(1);
    expect(db.tables.imports).toHaveLength(1);
    expect(db.tables.imports[0]!.file_hash).toBe("HASH_A");
    expect((db.tables.imports[0]!.summary as Row).channel).toBe("manual");

    expect(calls.scoreImport).toEqual([res.importId]); // scored exactly once, for this import
  });

  it("is idempotent at the ROW level: re-ingesting the same rows under a new file writes nothing new", async () => {
    const db = new FakeDb();
    const { deps } = spyDeps();
    await ingestReport(db as unknown as SupabaseClient, env, txnInput("HASH_A"), deps);

    const { calls, deps: deps2 } = spyDeps();
    const res = await ingestReport(db as unknown as SupabaseClient, env, txnInput("HASH_B"), deps2);

    expect(res.newFuel).toBe(0);
    expect(res.duplicateEfs).toBe(3);
    expect(res.shortfallRows).toBe(0);
    expect(db.tables.efs_transactions).toHaveLength(3); // unchanged
    expect(db.tables.fuel_transactions).toHaveLength(1); // unchanged
    expect(calls.scoreImport).toEqual([]); // nothing new to score
  });

  it("is idempotent at the FILE level: the same file hash is a no-op", async () => {
    const db = new FakeDb();
    const { deps } = spyDeps();
    await ingestReport(db as unknown as SupabaseClient, env, txnInput("HASH_A"), deps);

    const { calls, deps: deps2 } = spyDeps();
    const res = await ingestReport(db as unknown as SupabaseClient, env, txnInput("HASH_A"), deps2);

    expect(res.alreadyImported).toBe(true);
    expect(res.importId).toBeNull();
    expect(db.tables.imports).toHaveLength(1); // no second import row
    expect(calls.scoreImport).toEqual([]);
  });

  it("channel defaults to 'auto' for an unattended run", async () => {
    const db = new FakeDb();
    const { deps } = spyDeps();
    await ingestReport(db as unknown as SupabaseClient, env, txnInput("HASH_A"), deps);
    expect((db.tables.imports[0]!.summary as Row).channel).toBe("auto");
  });
});

describe("ingestReport — safety", () => {
  it("writes NOTHING for an unrecognized report kind", async () => {
    const db = new FakeDb();
    const { calls, deps } = spyDeps();
    const res = await ingestReport(
      db as unknown as SupabaseClient,
      env,
      { ...txnInput("HASH_X"), headers: ["foo", "bar"] },
      deps,
    );
    expect(res.kind).toBe("unknown");
    expect(res.importId).toBeNull();
    expect(db.tables.imports).toHaveLength(0);
    expect(db.tables.efs_transactions).toHaveLength(0);
    expect(calls.scoreImport).toEqual([]);
  });
});

describe("ingestReport — reject report", () => {
  it("stores declined attempts and scores them", async () => {
    const db = new FakeDb();
    const { calls, deps } = spyDeps();
    const res = await ingestReport(
      db as unknown as SupabaseClient,
      env,
      {
        orgId: "org1",
        requestedBy: null,
        source: "csv",
        filename: "efs-rejects.csv",
        fileHash: "HASH_R",
        headers: REJECT_HEADERS,
        rows: rejectRows,
      },
      deps,
    );

    expect(res.kind).toBe("reject");
    expect(res.newDeclined).toBe(1);
    expect(res.shortfallRows).toBe(0);
    expect(db.tables.declined_transactions).toHaveLength(1);
    expect(calls.scoreDeclined).toEqual([res.importId]);
  });

  it("WP1 D2: attributes the decline to a vehicle (pump Unit) and driver at ingest", async () => {
    const db = new FakeDb();
    // Same matcher/tolerance as fuel lines: unit "0691" matches pump unit "691"; driver by EFS Driver ID.
    db.tables.vehicles.push({ id: "veh-691", org_id: "org1", unit_number: "0691" });
    db.tables.drivers.push({ id: "drv-boothe", org_id: "org1", full_name: "Donovan Boothe", efs_driver_id: "D1" });
    const { deps } = spyDeps();
    await ingestReport(
      db as unknown as SupabaseClient,
      env,
      {
        orgId: "org1",
        requestedBy: null,
        source: "csv",
        filename: "efs-rejects.csv",
        fileHash: "HASH_R2",
        headers: REJECT_HEADERS,
        rows: rejectRows,
      },
      deps,
    );
    const d = db.tables.declined_transactions[0]!;
    expect(d.vehicle_id).toBe("veh-691");
    expect(d.driver_id).toBe("drv-boothe");
    // Standard reject export carries no EFS alert fields — stored as null, never fabricated.
    expect(d.card_assigned_unit).toBeNull();
    expect(d.efs_proximity_miles).toBeNull();
  });
});
