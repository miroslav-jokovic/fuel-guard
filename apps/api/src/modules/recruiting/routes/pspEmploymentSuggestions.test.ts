import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext, PspEmploymentSuggestions } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * HW6b — the PSP employment suggestions, over HTTP, against a REAL UAT response.
 *
 * Litton's record (`psp/__fixtures__/uat/litton.json`, verbatim from 2026-08-20) has inspections under
 * DOT 113693 (09/2024, 10/2024) and 113529 (10/2024, 04/2025), and crashes under 227058 and 513264. A
 * hand-built fixture is how the MMDDYYYY defect stayed green for a week (`uatResponses.test.ts`), so
 * the dates here are the vendor's.
 *
 * The recorder does not filter, so the `psp_requests` fixture below applies the query's own `eq` /
 * `in` / `order` / `limit` — the test that the newest READABLE report is the one read has to fail when
 * the query stops asking for it, not pass because the fake handed back the right row anyway.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "9f9f9f9f-0000-4000-8000-000000000000";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITATION = "33333333-4444-4555-8666-777777777777";

const LITTON = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../../psp/__fixtures__/uat/litton.json"), "utf8"),
) as unknown;

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  fleet: ctx("fleet_manager"),
  safety: ctx("safety_manager"),
  dispatcher: ctx("dispatcher"),
  auditor: ctx("auditor"),
  recruiter: ctx("recruiter"),
  driver: ctx("driver"),
};

type Row = Record<string, unknown>;

/** The query's own filters, order and limit, applied — a fake that answers what was asked. */
function answer(rows: Row[]) {
  return (q: RecordedQuery): Row[] => {
    let out = rows.filter((r) =>
      q.ops.every((op) => {
        const [col, val] = op.args as [string, unknown];
        if (op.method === "eq") return r[col] === val;
        if (op.method === "in") return (val as unknown[]).includes(r[col]);
        return true;
      }),
    );
    for (const op of q.ops) {
      if (op.method === "order") {
        const [col, opts] = op.args as [string, { ascending?: boolean } | undefined];
        const dir = opts?.ascending === false ? -1 : 1;
        out = [...out].sort((a, b) => dir * String(a[col]).localeCompare(String(b[col])));
      }
      if (op.method === "limit") out = out.slice(0, op.args[0] as number);
    }
    return out;
  };
}

const PSP_ROW = (over: Row = {}): Row => ({
  id: "psp-1",
  org_id: ORG,
  driver_id: DRIVER,
  status: "succeeded",
  // A day after PSP's own `requestDate` (2026-08-20T18:37:51), so a report dated by our settle time
  // rather than by the vendor's fails below.
  settled_at: "2026-08-21T09:00:00Z",
  response_raw: LITTON,
  ...over,
});

const HISTORY = (over: Row = {}): Row => ({
  id: "job-1",
  org_id: ORG,
  driver_id: DRIVER,
  employer_name: "Insp Carrier",
  usdot_number: "113693",
  started_on: "2024-01-01",
  ended_on: "2024-12-31",
  ...over,
});

function seed(opts: {
  psp?: Row[];
  history?: Row[];
  hireDate?: string | null;
  dot?: string | null;
  invitations?: Row[];
  draft?: unknown[] | null;
} = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      drivers: answer([{ id: DRIVER, org_id: ORG, hire_date: opts.hireDate ?? null }]),
      organizations: [{ id: ORG, dot_number: opts.dot === undefined ? "227058" : opts.dot }],
      psp_requests: answer(opts.psp ?? [PSP_ROW()]),
      driver_employment_history: answer(opts.history ?? [HISTORY()]),
      application_invitations: answer(
        opts.invitations ?? [{ id: INVITATION, org_id: ORG, driver_id: DRIVER }],
      ),
      application_drafts: opts.draft === null ? [] : [{ employers: opts.draft ?? [] }],
    },
  });
}

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const get = async (token: string | null, query = ""): Promise<Response> =>
  fetch(`${baseUrl}/api/recruitment/drivers/${DRIVER}/psp-employment${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
const read = async (token: string, query = ""): Promise<PspEmploymentSuggestions> => {
  const res = await get(token, query);
  expect(res.status).toBe(200);
  return (await res.json()) as PspEmploymentSuggestions;
};
const use = (r: SupabaseRecorder): SupabaseRecorder => {
  rec = r;
  holder.client = r.client;
  return r;
};

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  // Only Date: the windows are measured from today, and a test that passes this year and fails next
  // November is not a test. Timers stay real so the HTTP round trip still runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
});

afterAll(async () => {
  vi.useRealTimers();
  await closeTestServer(server);
});

afterEach(() => {
  // Every read in every case below names this org, and nothing is ever written (PSP-PLAN Q10).
  expectOrgScoped(rec, ORG);
  expect(rec.writes()).toHaveLength(0);
});

describe("who is told what the PSP record suggests", () => {
  it("serves the §391.53(a)(1) readers of the PSP report", async () => {
    for (const token of ["admin", "safety", "recruiter"]) {
      use(seed());
      expect((await get(token)).status).toBe(200);
    }
  });

  /**
   * The fleet_manager manages recruitment, so every employment route admits them — and may not read
   * a PSP report. A carrier name and the dates the driver was inspected in its truck ARE the report.
   */
  it("refuses the fleet_manager, who manages recruitment but may not read a PSP report, before any read", async () => {
    use(seed());
    expect((await get("fleet")).status).toBe(403);
    expect(rec.queries).toHaveLength(0);
  });

  it("refuses the roles outside the section, and an unauthenticated caller", async () => {
    for (const token of ["dispatcher", "driver"]) {
      use(seed());
      expect((await get(token)).status).toBe(403);
      expect(rec.queries).toHaveLength(0);
    }
    use(seed());
    expect((await get(null)).status).toBe(401);
  });
});

describe("against the driver's filed record", () => {
  it("names the carriers PSP saw that the list does not, newest first, and backs up the one it does", async () => {
    use(seed());
    const out = await read("recruiter");
    expect(out.report).toEqual({ requestId: "psp-1", pulledOn: "2026-08-20" });
    // 113693 is listed; 227058 is OUR DOT (inspections run for us are not an unlisted employer).
    expect(out.unlisted.map((u) => [u.usdotNumber, u.firstSeen, u.lastSeen, u.inspections, u.crashes])).toEqual([
      ["113529", "2024-10-06", "2025-04-03", 2, 0],
      ["513264", "2024-09-11", "2024-11-15", 0, 2],
    ]);
    expect(out.employers).toEqual([
      { key: "job-1", index: 0, match: "corroborated", inspections: 2, crashes: 0 },
    ]);
    expect(out.inspectionWindowStart).toBe("2023-08-20");
    expect(out.crashWindowStart).toBe("2021-08-20");
  });

  it("measures what the applicant owed from the hire date, not from today", async () => {
    use(seed());
    expect((await read("recruiter")).unlisted.map((u) => u.owedTo)).toEqual(["b10", "b10"]);
    // Hired 2028-06-01: the three-year list starts 2025-06-01, so both carriers fall to (b)(11).
    use(seed({ hireDate: "2028-06-01" }));
    expect((await read("recruiter")).unlisted.map((u) => u.owedTo)).toEqual(["b11", "b11"]);
  });

  it("reads the newest report that holds a driver record, never a failed one or another driver's", async () => {
    use(seed({
      psp: [
        PSP_ROW({ id: "older", settled_at: "2026-01-01T00:00:00Z", response_raw: [] }),
        PSP_ROW(),
        PSP_ROW({ id: "failed", status: "failed", settled_at: "2026-10-01T00:00:00Z", response_raw: [] }),
        PSP_ROW({ id: "theirs", driver_id: "someone-else", settled_at: "2026-10-02T00:00:00Z", response_raw: [] }),
      ],
    }));
    expect((await read("recruiter")).report?.requestId).toBe("psp-1");
  });

  it("answers 'nothing to compare' when no machine-readable report exists", async () => {
    use(seed({ psp: [PSP_ROW({ status: "sent", response_raw: null })] }));
    expect(await read("recruiter")).toEqual({
      report: null, unlisted: [], employers: [], inspectionWindowStart: null, crashWindowStart: null,
    });
  });

  /**
   * A settled report whose stored response is gone (a purge that keeps the ledger row) must read as
   * "nothing to compare". Parsed, a missing response is a report with no inspections — and that would
   * tell the office every carrier PSP names is on the list, a claim about the driver nobody made.
   */
  it("treats a settled report with no stored response as nothing to compare, never as a clean record", async () => {
    use(seed({ psp: [PSP_ROW({ response_raw: null })] }));
    expect((await read("recruiter")).report).toBeNull();
  });

  it("refuses a driver from another carrier", async () => {
    const r = use(createSupabaseRecorder({ tables: { drivers: answer([{ id: DRIVER, org_id: OTHER_ORG }]) } }));
    expect((await get("recruiter")).status).toBe(404);
    expect(r.forTable("psp_requests")).toHaveLength(0);
  });
});

describe("against the application's draft", () => {
  it("reads the draft's jobs, by key and by position, and treats a typed DOT as the digits PSP prints", async () => {
    use(seed({
      draft: [
        { key: "k-1", employer_name: "Insp Carrier", usdot_number: "DOT 113 529", started_on: "2024-06-01", ended_on: "" },
        "not a job",
        { employer_name: "Old row", usdot_number: "113693", started_on: "2023-01-01", ended_on: "2023-06-30" },
      ],
    }));
    const out = await read("recruiter", `?invitationId=${INVITATION}`);
    expect(out.unlisted.map((u) => u.usdotNumber)).toEqual(["513264"]);
    expect(out.employers).toEqual([
      { key: "k-1", index: 0, match: "corroborated", inspections: 2, crashes: 0 },
      { key: null, index: 1, match: "no_psp_activity", inspections: 0, crashes: 0 },
    ]);
    // The draft is read, not the record.
    expect(rec.forTable("driver_employment_history")).toHaveLength(0);
  });

  /**
   * A job typed in without its start date was still LISTED. Its carrier must not come back as "not on
   * their list", and PSP cannot back up a period that has no beginning, so it gets no check either.
   */
  it("counts a job with no start date as listed and checks no period for it", async () => {
    use(seed({ draft: [{ key: "k-1", employer_name: "Half typed", usdot_number: "113529", started_on: "" }] }));
    const out = await read("recruiter", `?invitationId=${INVITATION}`);
    expect(out.unlisted.map((u) => u.usdotNumber)).toEqual(["513264", "113693"]);
    expect(out.employers).toEqual([]);
  });

  it("refuses an invitation that is not this driver's", async () => {
    use(seed({ invitations: [{ id: INVITATION, org_id: ORG, driver_id: "someone-else" }] }));
    expect((await get("recruiter", `?invitationId=${INVITATION}`)).status).toBe(404);
    expect(rec.forTable("psp_requests")).toHaveLength(0);
  });
});
