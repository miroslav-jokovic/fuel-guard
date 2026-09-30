import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITABLE_SECTIONS, type AuthContext, type SectionClaim, type UserRole } from "@silvicom/shared";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createSupabaseRecorder } from "./testing/supabaseRecorder.js";
import { closeTestServer } from "./testing/httpServer.js";

/**
 * SP11 (SETTINGS-PERMISSIONS-PLAN.md §4b.2 item 10; Q-SET11 (a), owner 2026-09-30) — the role
 * literals that became either a SECTION read or a NAMED grant, asserted through the real app.
 *
 * Each block pins two things, because each change claimed two things:
 *  · **Nothing moved for a token with no overrides.** Every token in existence has that shape until
 *    an admin edits the matrix, so this is the proof the swap was behaviour-preserving.
 *  · **The org's answer now moves the section gates — and does NOT move the named ones.** A section
 *    read that ignored an override would be the spread-list defect SP11 removed; a named grant that
 *    followed one would be a credential an org can hand out through the matrix, which is exactly
 *    what "named" rules out.
 *
 * A request that passes the gate reaches its handler and fails there on the empty database (400,
 * 404 or 422); only the gate answers 403 with "Insufficient role". The assertions read that line.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("./lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKENS = new Map<string, AuthContext>();
const token = (role: UserRole, sections: SectionClaim | null = null): string => {
  const t = `${role}:${JSON.stringify(sections)}`;
  TOKENS.set(t, { userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role, sections } as AuthContext);
  return t;
};
/** Every editable section at manage — the widest grant an org can make. */
const EVERYTHING: SectionClaim = Object.fromEntries(EDITABLE_SECTIONS.map((s) => [s, "manage"]));

let server: Server;
let baseUrl: string;

/** A fresh app, and so fresh rate-limit stores — see the Ask AI block for why that matters. */
async function listen(): Promise<void> {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = TOKENS.get(t);
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}
beforeAll(listen);
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  holder.client = createSupabaseRecorder({ tables: { drivers: [], driver_employment_history: [], audit_logs: [] } }).client;
});

/** True when the GATE refused — the only 403 these routes produce before their handler runs. */
async function refused(method: string, path: string, t: string, body: unknown = {}): Promise<boolean> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  if (res.status !== 403) return false;
  const json = (await res.json()) as { error?: { message?: string } };
  return json.error?.message === "Insufficient role";
}

describe("the §391.23 inquiry routes: recruitment manage AND the investigation reader test", () => {
  const PREVIEW = "/api/recruitment/employment/emp-1/inquiry-preview";

  it("admits exactly admin, safety_manager and recruiter with no overrides — the list it replaced", async () => {
    for (const r of ["admin", "safety_manager", "recruiter"] as const) expect(await refused("GET", PREVIEW, token(r)), r).toBe(false);
    for (const r of ["fleet_manager", "dispatcher", "auditor", "accountant", "technician", "driver"] as const)
      expect(await refused("GET", PREVIEW, token(r)), r).toBe(true);
  });

  it("follows the org's Recruitment answer: a recruiter whose org took it away is refused", async () => {
    expect(await refused("GET", PREVIEW, token("recruiter", { recruitment: "view" }))).toBe(true);
    expect(await refused("GET", PREVIEW, token("safety_manager", { recruitment: "none" }))).toBe(true);
  });

  it("does not let a Recruitment grant widen the §391.23(k)(2) reader test", async () => {
    // A fleet manager already manages Recruitment; a dispatcher can be granted it. Neither may read
    // a former employer's answer, whatever the org decides (D-PERM9).
    expect(await refused("GET", PREVIEW, token("dispatcher", { recruitment: "manage" }))).toBe(true);
    expect(await refused("GET", PREVIEW, token("fleet_manager", EVERYTHING))).toBe(true);
  });
});

describe("creating and editing a driver row: roster manage OR recruitment manage", () => {
  it("admits the union of the two shipped manage sets with no overrides, and nobody else", async () => {
    for (const r of ["admin", "fleet_manager", "safety_manager", "recruiter"] as const)
      expect(await refused("POST", "/api/roster/drivers", token(r)), r).toBe(false);
    for (const r of ["dispatcher", "auditor", "accountant", "technician", "driver"] as const)
      expect(await refused("POST", "/api/roster/drivers", token(r)), r).toBe(true);
  });

  it("follows the org: widened in either section admits, narrowed out of both refuses", async () => {
    expect(await refused("POST", "/api/roster/drivers", token("dispatcher", { roster: "manage" }))).toBe(false);
    expect(await refused("POST", "/api/roster/drivers", token("technician", { recruitment: "manage" }))).toBe(false);
    expect(await refused("POST", "/api/roster/drivers", token("recruiter", { recruitment: "view" }))).toBe(true);
    expect(await refused("PATCH", "/api/roster/drivers/d-1", token("safety_manager", { roster: "view", recruitment: "none" }))).toBe(true);
  });

  it("asks the org's roster answer before a lifecycle edit, not the shipped one", async () => {
    const lifecycle = async (t: string) => {
      const res = await fetch(`${baseUrl}/api/roster/drivers/d-1`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ status: "terminated" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      return res.status === 403 && /employment status is a fleet action/.test(json.error?.message ?? "");
    };
    expect(await lifecycle(token("recruiter"))).toBe(true);
    expect(await lifecycle(token("safety_manager"))).toBe(false);
    // A safety manager narrowed to roster: view keeps the row edit through Recruitment, and loses
    // the lifecycle half with the section; a recruiter granted roster: manage gains it.
    expect(await lifecycle(token("safety_manager", { roster: "view" }))).toBe(true);
    expect(await lifecycle(token("recruiter", { roster: "manage" }))).toBe(false);
  });
});

describe("driver identity acts are granted by NAME (DRIVER_IDENTITY_ROLES)", () => {
  const ACTS: Array<[string, string]> = [
    ["POST", "/api/roster/drivers/reconcile"],
    ["POST", "/api/roster/drivers/d-1/merge"],
    ["POST", "/api/roster/drivers/d-1/credentials"],
  ];

  it("admits admin and fleet_manager only — narrower than roster manage, which holds safety_manager", async () => {
    for (const [m, p] of ACTS) {
      expect(await refused(m, p, token("admin")), p).toBe(false);
      expect(await refused(m, p, token("fleet_manager")), p).toBe(false);
      expect(await refused(m, p, token("safety_manager")), p).toBe(true);
    }
  });

  it("does not follow the matrix: every section granted still does not reach them, and none revoked still does", async () => {
    for (const [m, p] of ACTS) {
      expect(await refused(m, p, token("safety_manager", EVERYTHING)), p).toBe(true);
      expect(await refused(m, p, token("fleet_manager", { roster: "none" })), p).toBe(false);
    }
  });
});

describe("requireAdminOnly: the integration acts Q-SET11 ruled the admin's alone", () => {
  const ACTS: Array<[string, string]> = [
    ["POST", "/api/integrations/samsara/diagnostics"],
    ["POST", "/api/integrations/mcleod/enable"],
    ["POST", "/api/integrations/driver-performance/snapshot"],
    ["POST", "/api/fueling/networks/kwiktrip/sync"],
    ["POST", "/api/fuel-cards/unit-mileage"],
  ];

  it("refuses every other role, with every editable section granted at manage", async () => {
    for (const [m, p] of ACTS)
      for (const r of ["fleet_manager", "dispatcher", "safety_manager", "auditor", "recruiter", "accountant", "technician"] as const)
        expect(await refused(m, p, token(r, EVERYTHING)), `${r} ${p}`).toBe(true);
  });

  it("admits the admin, whose role no org answer can narrow", async () => {
    for (const [m, p] of ACTS) expect(await refused(m, p, token("admin", {})), p).toBe(false);
  });
});

describe("Ask AI: the Fuel section, and a screen that starts admin-only (Q-SET14 (b), Q-SET15)", () => {
  const ASK = "/api/ai/ask";

  // `/api/ai` shares `strictLimiter` — one store, 30 requests in 15 minutes — with `/api/integrations`,
  // which the admin-only block above spends 24 of. Past the limit every call answers 429, which would
  // read as "not refused", and the refusal cases would fail for a reason that is not the gate.
  // A fresh app gives this block its own budget, so the result does not depend on test order.
  beforeAll(async () => {
    await closeTestServer(server);
    await listen();
  });

  type Row = { role?: string; user_id?: string; surface_key: string; allowed: boolean };
  /** The org's stored screen answers, filtered the way PostgREST would (the recorder does not filter). */
  function answers(roleRows: Row[], userRows: Row[] = []): void {
    const by = (rows: Row[], col: "role" | "user_id") => (q: { filters(): Array<{ col: string; val: unknown }> }) => {
      const want = q.filters().find((f) => f.col === col)?.val;
      return rows.filter((r) => r[col] === want);
    };
    holder.client = createSupabaseRecorder({
      tables: { org_role_surface_access: by(roleRows, "role"), user_surface_access: by(userRows, "user_id"), audit_logs: [] },
    }).client;
  }
  /** Which gate answered: "section" (fuel), "screen" (ask-ai), or null when the request got through. */
  async function gate(t: string): Promise<"section" | "screen" | null> {
    const res = await fetch(`${baseUrl}${ASK}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ question: "q" }),
    });
    if (res.status !== 403) return null;
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    if (json.error?.message === "Insufficient role") return "section";
    return json.error?.code === "surface_denied" ? "screen" : null;
  }

  it("with nothing stored, only the admin gets through — every other role stops at the screen or the section", async () => {
    answers([]);
    expect(await gate(token("admin"))).toBe(null);
    for (const r of ["fleet_manager", "dispatcher", "safety_manager", "auditor", "accountant"] as const) expect(await gate(token(r)), r).toBe("screen");
    for (const r of ["recruiter", "technician"] as const) expect(await gate(token(r)), r).toBe("section");
  });

  it("an admin turning the screen on for a role or one person lets them through; the section still has to allow it", async () => {
    answers([{ role: "dispatcher", surface_key: "ask-ai", allowed: true }], [{ user_id: "u-auditor", surface_key: "ask-ai", allowed: true }]);
    expect(await gate(token("dispatcher"))).toBe(null);
    expect(await gate(token("auditor"))).toBe(null);
    expect(await gate(token("fleet_manager")), "a grant to another role reaches nobody else").toBe("screen");
    // A screen grant cannot reach past its section (D-SURF2): the dispatcher's org took Fuel away.
    expect(await gate(token("dispatcher", { fuel: "none" }))).toBe("section");
  });

  it("follows the org's Fuel answer, and NOT its HazmatGuard one — the coincidence the old list equalled", async () => {
    answers([{ role: "recruiter", surface_key: "ask-ai", allowed: true }]);
    expect(await gate(token("recruiter", { fuel: "view" }))).toBe(null);
    expect(await gate(token("recruiter", { hazmat: "manage" }))).toBe("section");
    expect(await gate(token("admin", { fuel: "none" }))).toBe(null);
  });
});
