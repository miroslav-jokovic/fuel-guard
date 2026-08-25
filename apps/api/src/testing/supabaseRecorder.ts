/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A Supabase client fake that REMEMBERS what it was asked (audit 2026-08-09, Stage 2.5).
 *
 * WHY THIS EXISTS. Ten service tests in this app each hand-rolled a chainable Proxy whose fallthrough
 * was `return () => proxy`. That one line makes `.eq("org_id", orgId)` indistinguishable from never
 * calling it: the fake accepts the filter, discards it, and resolves the same fixture either way. So
 * a service that forgets its tenant filter — or filters on the wrong column, or the wrong value —
 * passes every one of those tests unchanged.
 *
 * That mattered more here than it would in most codebases, because of what sits on either side of it.
 * The API talks to Postgres with the SERVICE ROLE, which bypasses RLS entirely, so the database is
 * not a second line of defence for these queries. And the behavioural matrix (supabase/tests) proves
 * policies, not application code. Between the two there was no layer at which a missing `org_id`
 * filter in a service would be caught by anything — and `"org_id"` appeared in an assertion three
 * times across sixty-two test files.
 *
 * This recorder keeps the ergonomics of the fakes it replaces (chain anything, await the builder, get
 * a fixture back) and adds one thing: every call in the chain is recorded, so a test can assert on
 * the QUERY as well as on the result. `expectOrgScoped` below is the assertion that closes the gap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordedOp {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  table: string;
  ops: RecordedOp[];
  /** The `.eq()` / `.in()` / `.match()` filters this query actually applied. */
  filters(): Array<{ col: string; val: unknown }>;
  /** Payload of the write, when this query was an insert/update/upsert/delete. */
  write: { method: string; payload: unknown } | null;
}

export interface RecorderTable {
  /** Rows returned by an awaited query, and by `.single()` / `.maybeSingle()` (first row). */
  data?: unknown;
  error?: unknown;
  /**
   * Successive READS of this table drain this queue (page 0, page 1, …; `[]` once it is empty). Writes
   * never consume a page. This is how a test drives a service that pages until a select comes back
   * short — dataRetention's batch loop, the `readAll` helpers — without the fake having to guess.
   */
  pages?: unknown[][];
  /** PostgREST's `count`, for callers that ask for one (`.delete({ count: "exact" })`). */
  count?: number;
  /** Error for insert/update/upsert/delete only, when a table must READ fine and FAIL to write. */
  writeError?: unknown;
}

/** A fixture may be computed from the query, so a test can vary rows by the filters actually applied. */
export type RecorderFixture =
  | RecorderTable
  | unknown[]
  | ((query: RecordedQuery) => RecorderTable | unknown[]);

export interface RecordedAuthCall {
  fn: string;
  args: unknown[];
}

/** Id of the user `auth.admin.createUser` invents when a test does not script its own. */
export const RECORDER_AUTH_USER_ID = "auth-user-1";

export interface SupabaseRecorder {
  client: SupabaseClient;
  queries: RecordedQuery[];
  /** Every `auth.admin.*` call, in order — the second surface a credentials service writes to. */
  authCalls: RecordedAuthCall[];
  forTable(table: string): RecordedQuery[];
  writes(): RecordedQuery[];
  /** Rows written to `table`, flattened across chunked insert/update/upsert calls. */
  writtenRows(table: string): Record<string, unknown>[];
  /** Every `.rpc()` call, in order. */
  rpcs(): Array<{ fn: string; args: unknown }>;
  /**
   * Every Storage call, in order — the THIRD surface a service writes to, after PostgREST and GoTrue.
   * Added when the PSP order path filed a PDF: a fake with no `storage` makes `admin.storage.from()`
   * throw, and a test that works around that by injecting the upload proves nothing about the code
   * that ships.
   */
  storageCalls(): Array<{ bucket: string; fn: string; args: unknown[] }>;
  reset(): void;
}

const FILTER_METHODS = new Set(["eq", "in", "match", "is", "neq", "gt", "gte", "lt", "lte", "like", "ilike"]);
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);
/** Methods whose payload is a ROW (or rows) — `delete()`'s argument is options, not data. */
const ROW_WRITE_METHODS = new Set(["insert", "update", "upsert"]);

/** Defaults for the GoTrue admin surface; a test overrides any of them through `opts.auth`. */
const DEFAULT_AUTH: Record<string, (...args: any[]) => unknown> = {
  createUser: () => ({ data: { user: { id: RECORDER_AUTH_USER_ID } }, error: null }),
  updateUserById: () => ({ data: {}, error: null }),
  deleteUser: () => ({ data: {}, error: null }),
  getUserById: (id: string) => ({ data: { user: { id, email: `${id}@example.test` } }, error: null }),
  listUsers: () => ({ data: { users: [] }, error: null }),
};

export function createSupabaseRecorder(opts: {
  tables?: Record<string, RecorderFixture>;
  rpc?: Record<string, unknown> | ((fn: string, args: unknown) => unknown);
  /** Scripted `auth.admin.*` responses (e.g. a createUser that fails); everything is recorded either way. */
  auth?: Record<string, (...args: any[]) => unknown>;
  /** Scripted Storage responses, keyed by method (`upload`, `createSignedUrl`, …). */
  storage?: Record<string, (...args: any[]) => unknown>;
} = {}): SupabaseRecorder {
  const queries: RecordedQuery[] = [];
  const authCalls: RecordedAuthCall[] = [];
  const storageOps: Array<{ bucket: string; fn: string; args: unknown[] }> = [];
  /** Per-table read cursor for `pages` fixtures. */
  const pageCursor = new Map<string, number>();

  const normalize = (raw: RecorderTable | unknown[] | undefined): RecorderTable =>
    raw === undefined ? { data: [], error: null } : Array.isArray(raw) ? { data: raw, error: null } : raw;

  const fixtureFor = (table: string, query: RecordedQuery): RecorderTable => {
    const raw = opts.tables?.[table];
    return normalize(typeof raw === "function" ? raw(query) : raw);
  };

  function builder(table: string): any {
    const ops: RecordedOp[] = [];
    const record: RecordedQuery = {
      table,
      ops,
      write: null,
      filters() {
        const out: Array<{ col: string; val: unknown }> = [];
        for (const op of ops) {
          if (op.method === "match" && typeof op.args[0] === "object" && op.args[0]) {
            for (const [col, val] of Object.entries(op.args[0] as Record<string, unknown>)) {
              out.push({ col, val });
            }
          } else if (FILTER_METHODS.has(op.method) && typeof op.args[0] === "string") {
            out.push({ col: op.args[0], val: op.args[1] });
          }
        }
        return out;
      },
    };
    queries.push(record);

    // Resolved when the query SETTLES, not when it is built: by then the whole chain is recorded, so a
    // function fixture can answer on the filters, and a `pages` queue advances once per read.
    const settle = (single: boolean) => {
      const fx = fixtureFor(table, record);
      const isWrite = record.write !== null;
      let data: unknown;
      if (fx.pages && !isWrite) {
        const i = pageCursor.get(table) ?? 0;
        pageCursor.set(table, i + 1);
        data = fx.pages[i] ?? [];
      } else {
        data = fx.data ?? [];
      }
      const rows = Array.isArray(data) ? data : data == null ? [] : [data];
      return {
        data: single ? (rows[0] ?? null) : data,
        error: (isWrite ? (fx.writeError ?? fx.error) : fx.error) ?? null,
        count: fx.count ?? null,
      };
    };

    const proxy: any = new Proxy(function () {}, {
      get(_t, prop: string | symbol) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) => resolve(settle(false));
        }
        if (prop === "single" || prop === "maybeSingle") {
          return async () => {
            ops.push({ method: String(prop), args: [] });
            return settle(true);
          };
        }
        if (prop === "csv" || prop === "throwOnError") return () => proxy;
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          ops.push({ method: prop, args });
          if (WRITE_METHODS.has(prop)) record.write = { method: prop, payload: args[0] ?? null };
          return proxy;
        };
      },
      apply: () => proxy,
    });
    return proxy;
  }

  const client = {
    from: (table: string) => builder(table),
    /**
     * `.rpc()` is THENABLE rather than async, so a caller may chain the PostgREST modifiers a function
     * returning `setof` accepts — `.range()` above all, which is how a service pages an RPC the same
     * way it pages a table. Awaiting it directly still works, so every existing call site is unchanged.
     *
     * It returned a bare promise until the spend report started paging `fuel_spend_lines`, at which
     * point every test of that path died on `admin.rpc(...).range is not a function` — a limitation of
     * the fake, not of the code it was standing in for.
     */
    rpc: (fn: string, args: unknown) => {
      queries.push({
        table: `rpc:${fn}`,
        ops: [{ method: "rpc", args: [args] }],
        write: null,
        filters: () => [],
      });
      const settle = () => {
        const r = typeof opts.rpc === "function" ? opts.rpc(fn, args) : opts.rpc?.[fn];
        // A scripted `{ error }` passes through as a FAILED call, the same shape a table fixture uses.
        // Added when the hire path had to prove it turns the transaction's own refusal (SQLSTATE
        // HA010, "somebody hired them first") into an answer rather than a 500 — a recorder that can
        // only succeed forces that test to hand-roll a client, and then it is not testing this one.
        if (r !== null && typeof r === "object" && "error" in r && (r as { error?: unknown }).error) {
          return { data: null, error: (r as { error: unknown }).error };
        }
        return { data: r ?? null, error: null };
      };
      // Every modifier records itself and returns the same chainable object; only awaiting resolves.
      const chain: Record<string, unknown> = {};
      for (const m of ["range", "order", "limit", "eq", "in", "gte", "lte", "select", "filter", "single", "maybeSingle"]) {
        chain[m] = (...a: unknown[]) => {
          queries[queries.length - 1]!.ops.push({ method: m, args: a });
          return chain;
        };
      }
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(res, rej);
      return chain;
    },
    storage: {
      from: (bucket: string) =>
        new Proxy(
          {},
          {
            get(_t, prop: string | symbol) {
              if (typeof prop === "symbol") return undefined;
              return async (...args: unknown[]) => {
                storageOps.push({ bucket, fn: prop, args });
                const handler = opts.storage?.[prop];
                // Default is SUCCESS with no body — the shape `upload` returns on the happy path.
                return handler ? await handler(...args) : { data: { path: String(args[0] ?? "") }, error: null };
              };
            },
          },
        ),
    },
    auth: {
      // Any admin method is accepted and recorded — a credentials service writes to GoTrue as well as to
      // PostgREST, and "which auth call happened, with what" is exactly the kind of fact the old fakes
      // had to re-implement by hand in every file.
      admin: new Proxy(
        {},
        {
          get(_t, prop: string | symbol) {
            if (typeof prop === "symbol") return undefined;
            return async (...args: unknown[]) => {
              authCalls.push({ fn: prop, args });
              const handler = opts.auth?.[prop] ?? DEFAULT_AUTH[prop];
              return handler ? await handler(...args) : { data: {}, error: null };
            };
          },
        },
      ),
    },
  } as unknown as SupabaseClient;

  return {
    client,
    queries,
    authCalls,
    storageCalls: () => storageOps,
    forTable: (table: string) => queries.filter((q) => q.table === table),
    writes: () => queries.filter((q) => q.write !== null),
    writtenRows: (table: string) =>
      queries
        .filter((q) => q.table === table && q.write && ROW_WRITE_METHODS.has(q.write.method))
        .flatMap((q) => {
          const p = q.write!.payload;
          return (Array.isArray(p) ? p : [p]) as Record<string, unknown>[];
        }),
    rpcs: () =>
      queries
        .filter((q) => q.table.startsWith("rpc:"))
        .map((q) => ({ fn: q.table.slice(4), args: q.ops[0]?.args[0] })),
    reset: () => {
      queries.length = 0;
      authCalls.length = 0;
      pageCursor.clear();
    },
  };
}

/**
 * Assert that every query this recorder saw was scoped to one organization.
 *
 * This is the assertion the hand-rolled fakes could not express. A service that drops
 * `.eq("org_id", orgId)`, filters on the wrong column, or passes the wrong org id fails here — and
 * fails naming the table and the filters it actually applied, so the diagnosis is in the failure
 * message rather than in a debugger.
 *
 * `exempt` is for tables that legitimately are not org-scoped: global reference data, a scheduler
 * loop that deliberately iterates every tenant, or a lookup by a primary key whose ownership was
 * already established. Each exemption is a claim the test author is making — keep the list short and
 * say why in the test.
 *
 * A row WRITE carries its tenant in the payload rather than in a filter (`insert`/`upsert` name
 * `org_id` in the row; the conflict target is `org_id,…`), so a write whose every row names this org
 * counts as scoped. A row that omits `org_id`, or names a different one, still fails — which is the
 * case that would silently plant another tenant's data.
 */
export function expectOrgScoped(
  rec: SupabaseRecorder,
  orgId: string,
  opts: { exempt?: string[] } = {},
): void {
  const exempt = new Set(opts.exempt ?? []);
  const offenders = rec.queries
    .filter((q) => !q.table.startsWith("rpc:") && !exempt.has(q.table))
    .filter(
      (q) =>
        !q.filters().some((f) => f.col === "org_id" && matchesOrg(f.val, orgId)) &&
        !writeNamesOrg(q, orgId),
    );

  if (offenders.length > 0) {
    const detail = offenders
      .map((q) => `  ${q.table}: ${q.ops.map((o) => `${o.method}(${fmt(o.args)})`).join(".") || "(no filters)"}`)
      .join("\n");
    throw new Error(
      `${offenders.length} query/queries were not scoped to org ${orgId}:\n${detail}\n` +
        `If a table here is legitimately not org-scoped, pass it in \`exempt\` and say why.`,
    );
  }
}

/** True when this is a row write and EVERY row it carries names this org. */
function writeNamesOrg(q: RecordedQuery, orgId: string): boolean {
  if (!q.write || !ROW_WRITE_METHODS.has(q.write.method)) return false;
  const payload = q.write.payload;
  const rows = (Array.isArray(payload) ? payload : [payload]).filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
  );
  return rows.length > 0 && rows.every((r) => r["org_id"] === orgId);
}

function matchesOrg(val: unknown, orgId: string): boolean {
  if (val === orgId) return true;
  return Array.isArray(val) && val.includes(orgId); // .in("org_id", [...])
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? `"${a}"` : Array.isArray(a) ? `[${a.length}]` : typeof a === "object" && a ? "{…}" : String(a)))
    .join(", ");
}
