import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { AUDIT_LOG_PAGE_SIZE, USER_ROLES, rolesThatCanView, type AuditLogPage, type UserRole } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "./testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "./testing/postgrestFixture.js";
import { closeTestServer } from "./testing/httpServer.js";

/**
 * The Audit log, read through the API (SETTINGS-PERMISSIONS-PLAN.md SP4).
 *
 * Until SP4 the page read `audit_logs` through PostgREST and `audit_select` let only the admin and
 * auditor ROLES see a row, so a fleet manager the admin gave the screen opened it to an empty table.
 * The read now asks what the screen asks — the section, then the screen — so the cases are the four
 * that tell those gates apart (`settingsWrites.test.ts` has the same four for the saves), and the
 * roles in them come from the shared matrix, not from this file.
 *
 * Only `requireAuth` is replaced; `requireOrg`, `requireSection` and `requireSurface` are the shipped
 * middleware, reached through the router `app.ts` mounts.
 */
const ORG = "org-1";
const OTHER_ORG = "org-2";
const USER = "00000000-0000-4000-8000-000000000041";
const SCREEN = "admin.settings.audit";

const HOLDERS = rolesThatCanView("settings").filter((r) => r !== "admin");
const OUTSIDERS = USER_ROLES.filter((r) => !rolesThatCanView("settings").includes(r));

let rec: SupabaseRecorder;
let grants: Record<string, Record<string, boolean>> = {};

vi.mock("./lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("./lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("./middleware/auth.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./middleware/auth.js")>();
  return {
    ...real,
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: USER, orgId: ORG, role: req.header("x-role") as UserRole, email: "t@example.test", sections: null } as never;
      next();
    },
  };
});

const { auditRouter } = await import("./modules/org/index.js");

/** `uuid` for row `n`, so ids sort the way the timestamps do. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number): string => `2026-09-30T12:${String(n % 60).padStart(2, "0")}:00.123456+00:00`;
const row = (n: number, org: string, action: string): FixtureRow => ({
  id: uuid(n), org_id: org, actor_id: null, action, entity: null, entity_id: null, meta: {}, created_at: at(n),
});

/**
 * 55 of this org's rows (a page and then some), and the NEWEST rows in the table belong to another
 * org — so a read that lost its tenant filter shows them first rather than passing by luck.
 */
const ROWS: FixtureRow[] = [
  ...Array.from({ length: 55 }, (_, i) => row(i, ORG, i % 5 === 0 ? "user.invited" : "anomaly.flagged")),
  row(1000, ORG, "a_b.saved"),
  row(1001, ORG, "axb.saved"),
  row(1002, ORG, "100%.saved"),
  row(1003, ORG, "1000.saved"),
  // Exactly one page's worth: the edge at which "is there more?" is answered wrongly by an off-by-one.
  ...Array.from({ length: AUDIT_LOG_PAGE_SIZE }, (_, i) => row(1100 + i, ORG, "exact.page")),
  ...[59, 58, 57].map((n) => ({ ...row(n + 2000, OTHER_ORG, "user.invited"), created_at: at(n) })),
];

beforeEach(() => {
  grants = {};
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: (q) => {
        const role = q.filters().find((f) => f.col === "role")?.val as string;
        return Object.entries(grants[role] ?? {}).map(([surface_key, allowed]) => ({ role, surface_key, allowed }));
      },
      user_surface_access: [],
      audit_logs: postgrestFixture(ROWS),
    },
  });
});

let lastCode: string | undefined;

async function get(role: UserRole, query = ""): Promise<{ status: number; body: AuditLogPage | null }> {
  const app = express();
  app.use("/api/audit", auditRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/audit/log${query}`, {
      headers: { "x-role": role },
    });
    const json = (await res.json()) as AuditLogPage & { error?: { code?: string } };
    lastCode = res.ok ? undefined : json.error?.code;
    return { status: res.status, body: res.ok ? json : null };
  } finally {
    await closeTestServer(server);
  }
}

const reads = () => rec.forTable("audit_logs");

describe("the Audit log reads obey its screen's permission (SP4)", () => {
  it("reads for the admin, scoped to the caller's own org", async () => {
    const { status, body } = await get("admin");
    expect(status).toBe(200);
    expect(body!.rows.length).toBeGreaterThan(0);
    expect(body!.rows.every((r) => r.org_id === ORG)).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  for (const holder of HOLDERS) {
    it(`refuses ${holder} nobody has turned the screen on for — it starts off (#1140)`, async () => {
      expect((await get(holder)).status).toBe(403);
      expect(reads()).toEqual([]);
    });

    it(`reads for ${holder} once the org turns the screen on for the role`, async () => {
      grants = { [holder]: { [SCREEN]: true } };
      const { status, body } = await get(holder);
      expect(status).toBe(200);
      expect(body!.rows.length).toBeGreaterThan(0);
      expectOrgScoped(rec, ORG);
    });
  }

  for (const outsider of OUTSIDERS) {
    it(`refuses ${outsider} even when granted, because they do not hold the section (D-SURF2)`, async () => {
      grants = { [outsider]: { [SCREEN]: true } };
      expect((await get(outsider)).status).toBe(403);
      // The SECTION gate's code: `requireSurface` re-checks the section too, so a 403 alone could not
      // tell whether the endpoint had lost its `requireSection` (see settingsWrites.test.ts).
      expect(lastCode).toBe("forbidden");
      expect(reads()).toEqual([]);
    });
  }
});

describe("the Audit log pages and filters like the page always did", () => {
  it("returns a page of 50, newest first, with a cursor to the next", async () => {
    const { body } = await get("admin");
    expect(body!.rows).toHaveLength(AUDIT_LOG_PAGE_SIZE);
    expect(body!.hasNext).toBe(true);
    const last = body!.rows.at(-1)!;
    expect(body!.nextCursor).toBe(`${last.created_at}|${last.id}`);
    const times = body!.rows.map((r) => r.created_at);
    expect(times).toEqual([...times].sort().reverse());
    // One over the page, which is how it knows there is more without counting (Q-SET5).
    expect(reads()[0]!.ops.find((o) => o.method === "limit")!.args[0]).toBe(AUDIT_LOG_PAGE_SIZE + 1);
    expect(reads()[0]!.ops.some((o) => o.method === "select" && (o.args[1] as { count?: string } | undefined)?.count)).toBe(false);
  });

  it("hands the cursor back as the keyset filter, ties on created_at broken by id", async () => {
    const first = await get("admin");
    const cursor = first.body!.nextCursor!;
    const [createdAt, id] = cursor.split("|");
    await get("admin", `?cursor=${encodeURIComponent(cursor)}`);
    const or = reads().at(-1)!.ops.find((o) => o.method === "or");
    expect(or?.args[0]).toBe(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
    expectOrgScoped(rec, ORG);
  });

  it("says there is no next page on the last one", async () => {
    const { body } = await get("admin", "?action=user.");
    expect(body!.hasNext).toBe(false);
    expect(body!.nextCursor).toBeNull();
  });

  it("says there is no next page when exactly one page matches", async () => {
    const { body } = await get("admin", "?action=exact.");
    expect(body!.rows).toHaveLength(AUDIT_LOG_PAGE_SIZE);
    expect(body!.hasNext).toBe(false);
    expect(body!.nextCursor).toBeNull();
  });

  it("filters on an action prefix", async () => {
    const { body } = await get("admin", "?action=user.");
    expect(body!.rows.length).toBe(11);
    expect(body!.rows.every((r) => r.action.startsWith("user.") && r.org_id === ORG)).toBe(true);
  });

  it("finds a typed _ or % as itself, not as a wildcard", async () => {
    expect((await get("admin", "?action=a_b")).body!.rows.map((r) => r.action)).toEqual(["a_b.saved"]);
    expect((await get("admin", `?action=${encodeURIComponent("100%")}`)).body!.rows.map((r) => r.action)).toEqual(["100%.saved"]);
  });

  for (const [what, cursor] of [
    ["not a cursor at all", "garbage"],
    ["an id that is not a uuid", `${at(1)}|not-a-uuid`],
    ["a filter smuggled into the timestamp", `${at(1)},id.gt.0|${uuid(1)}`],
    ["a third part", `${at(1)}|${uuid(1)}|x`],
  ] as const) {
    it(`refuses ${what} with 400, and reads nothing`, async () => {
      expect((await get("admin", `?cursor=${encodeURIComponent(cursor)}`)).status).toBe(400);
      expect(reads()).toEqual([]);
    });
  }
});
