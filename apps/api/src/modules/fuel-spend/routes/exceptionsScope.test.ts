import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The ledger's truck scope, end to end (FUEL-P3, A3, D-FUI17).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 * `useSpendFilters` is shared with this page and carries `?trucks=`. The filter bar wrote it, the URL
 * preserved it, and **nothing underneath read it**: `ExceptionQuery` had no vehicle field, `qs()` never
 * sent one, and the API had no parameter. A filter that is accepted, preserved and ignored is worse
 * than an absent one — the address bar says the ledger is scoped and it is not.
 *
 * ── AND THE TRANSLATION THIS ROUTE OWNS ─────────────────────────────────────────────────────────
 * The section speaks vehicle IDS (`useSpendFilters`, the spend report, the fuel log's resolution) and
 * the ledger stores UNIT NUMBERS, because `fuel_exceptions.vehicle_id` has never been written by
 * anything. The route resolves one to the other against the caller's own roster, so a hand-edited id
 * cannot name another org's truck and the ledger keeps the column its producer fills.
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";
const V2 = "22222222-3333-4444-8555-666666666666";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const RECRUITER: AuthContext = { userId: "u-rec", email: "c@x.test", orgId: ORG, role: "recruiter" };

let server: Server;
let baseUrl = "";
let auth: AuthContext = ADMIN;

const FLEET = [{ id: V1, unit_number: "701" }, { id: V2, unit_number: "702" }];

/**
 * ⚠ The roster is a FUNCTION fixture, not a flat array.
 *
 * `supabaseRecorder` RECORDS filters and does not apply them, so a flat array answers `.in("id",[V1])`
 * with the whole fleet — and every assertion below about WHICH units a request resolved to would pass
 * for an implementation that ignored the parameter entirely. Honouring the filter here is what makes
 * "one truck in, one unit out" a test rather than a restatement.
 */
const seed = (fleet = FLEET) =>
  createSupabaseRecorder({
    tables: {
      vehicles: (q) => {
        const wanted = q.filters().find((f) => f.col === "id")?.val as string[] | undefined;
        return wanted ? fleet.filter((v) => wanted.includes(v.id)) : fleet;
      },
      fuel_exceptions: [],
      audit_logs: [],
    },
  });

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  auth = ADMIN;
  holder.rec = seed();
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });
const ledgerFilters = () =>
  holder.rec!.forTable("fuel_exceptions").at(-1)!.filters().map((f) => [f.col, f.val] as const);

describe("the ledger takes the trucks the page names", () => {
  it("turns vehicle ids into the unit numbers the findings carry", async () => {
    await get(`/api/fueling/exceptions?vehicles=${V1},${V2}`);
    expect(ledgerFilters()).toEqual(expect.arrayContaining([["unit_number", ["701", "702"]]]));
  });

  it("resolves them against the CALLER's roster, so a pasted id cannot reach another org's truck", async () => {
    await get(`/api/fueling/exceptions?vehicles=${V1}`);
    expect(holder.rec!.forTable("vehicles")[0]!.filters().map((f) => [f.col, f.val])).toEqual(
      expect.arrayContaining([["org_id", ORG], ["id", [V1]]]),
    );
  });

  /** A link naming trucks this org does not have answers with no findings, never with everybody's. */
  it("narrows to nothing for an id that is not this fleet's", async () => {
    holder.rec = seed([]);
    await get(`/api/fueling/exceptions?vehicles=${V1}`);
    expect(ledgerFilters()).toEqual(expect.arrayContaining([["unit_number", []]]));
  });

  it("ignores a value that is not a UUID rather than passing it to the database", async () => {
    await get("/api/fueling/exceptions?vehicles=not-a-uuid");
    expect(ledgerFilters().some(([col]) => col === "unit_number")).toBe(false);
  });

  it("gives the totals the same scope, so the tiles and the rows cover one set", async () => {
    await get(`/api/fueling/exceptions/totals?vehicles=${V1}&assignedTo=${V2}`);
    expect(ledgerFilters()).toEqual(
      expect.arrayContaining([["unit_number", ["701"]], ["assigned_to", V2]]),
    );
  });
});

describe("the ledger's export", () => {
  it("is a read, so the roles that read the ledger can produce it", async () => {
    expect((await get("/api/fueling/exceptions/export.csv")).status).toBe(200);
    auth = RECRUITER;
    expect((await get("/api/fueling/exceptions/export.csv")).status).toBe(403);
  });

  it("is matched as a route rather than read as a finding id", async () => {
    // ⚠ Express matches in order: declared after `/exceptions/:id`, this would have been read as an id
    // and answered 404. The packet route carries the same note for the same reason.
    const res = await get("/api/fueling/exceptions/export.csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("carries the page's filters into the file and leaves an audit row behind", async () => {
    await get(`/api/fueling/exceptions/export.csv?from=2026-08-01&to=2026-08-31&status=credited&vehicles=${V1}`);
    expect(ledgerFilters()).toEqual(
      expect.arrayContaining([["status", ["credited"]], ["unit_number", ["701"]]]),
    );
    const [row] = holder.rec!.writtenRows("audit_logs");
    expect(row).toMatchObject({ action: "export.generated", entity: "fuel_exceptions" });
    expect(row!.meta).toMatchObject({ report: "findings.csv", from: "2026-08-01", to: "2026-08-31" });
  });
});
