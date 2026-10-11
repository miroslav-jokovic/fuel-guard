import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APPLICATION_CAPTURES_BUCKET, DOCUMENTS_BUCKET, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "../../../lib/stepUpToken.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Deleting an applicant outright (Q-AW40, P2) through the mount: who may, what must be true first,
 * how 0380's refusals are answered, and what happens to the files and the audit trail afterwards.
 * The SQL half — what is deleted, what refuses, the guards — is `supabase/tests/purge-applicant.test.mjs`.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const ROLES = ["admin", "fleet_manager", "safety_manager", "recruiter", "dispatcher", "auditor", "driver"];

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const STORAGE = {
  documents: [`${ORG}/driver/${DRIVER}/app.pdf`],
  application_captures: [`${ORG}/inv/cdl_front.jpg`],
  signature_adoptions: [`${ORG}/driver/${DRIVER}/sig.png`],
  drivers: [] as string[],
};
const COUNTS = { drivers: 1, application_invitations: 1, driver_applications: 1 };

function seed(over: {
  driver?: Record<string, unknown> | null;
  rpc?: unknown;
  storage?: Partial<typeof STORAGE>;
  removeError?: string;
  auditError?: boolean;
} = {}): SupabaseRecorder {
  const driver =
    over.driver === null ? [] : [{ id: DRIVER, full_name: "Ana Plicant", archived_at: "2026-09-20T00:00:00Z", ...(over.driver ?? {}) }];
  rec = createSupabaseRecorder({
    tables: {
      drivers: driver,
      audit_logs: over.auditError ? { error: { message: "down" } } : [],
    },
    rpc: { purge_applicant: over.rpc ?? { counts: COUNTS, storage: { ...STORAGE, ...(over.storage ?? {}) } } },
    storage: {
      remove: (paths: string[]) =>
        over.removeError && paths.some((p) => p.includes(over.removeError!))
          ? { data: null, error: { message: "nope" } }
          : { data: paths.map((name) => ({ name })), error: null },
    },
  });
  holder.client = rec.client;
  return rec;
}

const purge = (role: string | null, body: unknown = { confirm_name: "Ana Plicant" }, stepUp = true) =>
  fetch(`${baseUrl}/api/recruitment/applicants/${DRIVER}/purge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(role ? { Authorization: `Bearer ${role}` } : {}),
      ...(role && stepUp ? { [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, `u-${role}`, ORG)!.token } : {}),
    },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    if (!ROLES.includes(t)) throw new Error("bad token");
    return ctx(t);
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("who may delete an applicant", () => {
  it("an admin, with a fresh password, may", async () => {
    seed();
    expect((await purge("admin")).status).toBe(200);
    expect(rec.rpcs()).toEqual([{ fn: "purge_applicant", args: { p_org: ORG, p_driver: DRIVER, p_actor: "u-admin" } }]);
  });

  it("no other role may — not the recruiter who archives, not the fleet roles who hire", async () => {
    for (const role of ROLES.filter((r) => r !== "admin")) {
      seed();
      expect((await purge(role)).status).toBe(403);
      expect(rec.queries).toHaveLength(0);
    }
  });

  it("an admin without step-up is asked for their password, and nothing is read", async () => {
    seed();
    const res = await purge("admin", undefined, false);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect(rec.queries).toHaveLength(0);
  });

  it("the unauthenticated get 401", async () => {
    seed();
    expect((await purge(null)).status).toBe(401);
  });
});

describe("what must be true before the purge runs", () => {
  it("refuses an applicant who is not archived (409 not_archived), and never calls the purge", async () => {
    seed({ driver: { archived_at: null } });
    const res = await purge("admin");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_archived");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a name that is not the applicant's (400 name_mismatch), and never calls the purge", async () => {
    for (const confirm_name of ["Ana", "Bo Standing", "Ana Plicantt"]) {
      seed();
      const res = await purge("admin", { confirm_name });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("name_mismatch");
      expect(rec.rpcs()).toHaveLength(0);
    }
  });

  it("forgives case and spacing in the typed name", async () => {
    seed();
    expect((await purge("admin", { confirm_name: "  ana   PLICANT " })).status).toBe(200);
  });

  it("refuses an empty name at the contract (400)", async () => {
    seed();
    expect((await purge("admin", { confirm_name: "   " })).status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("answers 404 for a driver it cannot see, reading only this carrier's rows", async () => {
    seed({ driver: null });
    expect((await purge("admin")).status).toBe(404);
    expect(rec.rpcs()).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });
});

describe("0380's refusals, answered", () => {
  const cases: Array<[string, number, string]> = [
    ["PA010", 409, "was_hired"],
    ["PA011", 409, "has_records"],
    ["PA012", 409, "linked"],
    ["PA020", 404, "not_found"],
    ["PA030", 403, "forbidden"],
    ["XX000", 500, "purge_failed"],
  ];
  for (const [sqlstate, status, code] of cases) {
    it(`${sqlstate} → ${status} ${code}, with no file removed and no audit row`, async () => {
      seed({ rpc: { error: { code: sqlstate, message: "refused" } } });
      const res = await purge("admin");
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
      expect(rec.storageCalls()).toHaveLength(0);
      expect(rec.writtenRows("audit_logs")).toHaveLength(0);
    });
  }
});

describe("after the purge", () => {
  it("removes each file from its own bucket, and audits driver.purged with ids and counts — never the name", async () => {
    seed();
    const res = await purge("admin");
    const body = (await res.json()) as { counts: unknown; storageRemoved: number; storageNotRemoved: string[]; audited: boolean };
    expect(body).toEqual({ counts: COUNTS, storageRemoved: 3, storageNotRemoved: [], audited: true });

    const removes = rec.storageCalls().filter((c) => c.fn === "remove");
    expect(removes).toEqual(
      expect.arrayContaining([
        { bucket: DOCUMENTS_BUCKET, fn: "remove", args: [STORAGE.documents] },
        { bucket: DOCUMENTS_BUCKET, fn: "remove", args: [STORAGE.signature_adoptions] },
        { bucket: APPLICATION_CAPTURES_BUCKET, fn: "remove", args: [STORAGE.application_captures] },
      ]),
    );
    expect(removes).toHaveLength(3);

    const audit = rec.writtenRows("audit_logs");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ org_id: ORG, actor_id: "u-admin", action: "driver.purged", entity: "drivers", entity_id: DRIVER });
    expect(audit[0]!.meta).toEqual({ counts: COUNTS, storageRemoved: 3, storageNotRemoved: [] });
    expect(JSON.stringify(audit[0])).not.toMatch(/Ana|Plicant/i);
    expectOrgScoped(rec, ORG);
  });

  it("names a file it could not remove, in the answer and in the audit row", async () => {
    seed({ removeError: "cdl_front" });
    const body = (await (await purge("admin")).json()) as { storageRemoved: number; storageNotRemoved: string[] };
    expect(body.storageRemoved).toBe(2);
    expect(body.storageNotRemoved).toEqual(STORAGE.application_captures);
    expect((rec.writtenRows("audit_logs")[0]!.meta as { storageNotRemoved: string[] }).storageNotRemoved).toEqual(
      STORAGE.application_captures,
    );
  });

  it("reports a driver photo as not removed — no bucket owns drivers.photo_path — rather than guessing one", async () => {
    seed({ storage: { drivers: [`${ORG}/drivers/x.jpg`] } });
    const body = (await (await purge("admin")).json()) as { storageNotRemoved: string[] };
    expect(body.storageNotRemoved).toEqual([`${ORG}/drivers/x.jpg`]);
    expect(rec.storageCalls().filter((c) => c.fn === "remove")).toHaveLength(3);
  });

  it("calls no remove for a table with no files", async () => {
    seed({ storage: { documents: [], application_captures: [], signature_adoptions: [] } });
    const body = (await (await purge("admin")).json()) as { storageRemoved: number };
    expect(body.storageRemoved).toBe(0);
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("says audited: false when the audit row could not be written after the delete committed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    seed({ auditError: true });
    const res = await purge("admin");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { audited: boolean }).audited).toBe(false);
    expect(spy.mock.calls.some((c) => String(c[0]).includes("[purge]"))).toBe(true);
    spy.mockRestore();
  });
});
