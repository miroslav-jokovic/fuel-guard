import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
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
 * Recording the MVR, the Clearinghouse query and the drug test from the hire — D1, D-HM6.
 *
 * ⚠ **The recruiter is the reason this router exists**, so every gate test names the role rather
 * than looping over a set: `recruiter` is `roster: "view"` and therefore cannot reach the compliance
 * doors at all, and `recruiter` is ALSO refused the two §382.401(a) testing kinds here. One role,
 * two opposite answers, which is precisely what a single section gate could not express.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_DRIVER = "99999999-8888-4999-8aaa-bbbbbbbbbbbb";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const DOC = "11111111-2222-4333-8444-555555555555";
const SHA = "a".repeat(64);

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);

const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  safety: ctx("safety_manager"),
  fleet: ctx("fleet_manager"),
  recruiter: ctx("recruiter"),
  auditor: ctx("auditor"),
  dispatcher: ctx("dispatcher"),
};

let server: Server;
let baseUrl: string;

const call = (path: string, opts: { token?: string; body?: unknown } = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
  });

const FILING = { occurred_on: "2026-09-10", result: "clean", performed_by: "SambaSafety" };

/** The refusal in words — `apiError`'s envelope, which is what a client actually shows. */
const message = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";

/** The scan as the register step leaves it: this driver's, filed under the step's own kind. */
const doc = (over: Record<string, unknown> = {}) => ({
  id: DOC, org_id: ORG, subject_type: "driver", subject_id: DRIVER, kind: "mvr", ...over,
});

/** One signature as `driver_authorizations` holds it — a grant unless `revokes` names another. */
const auth = (purpose: string, over: Record<string, unknown> = {}) => ({
  id: `${purpose}-1`, org_id: ORG, driver_id: DRIVER, purpose,
  accepted_at: "2026-09-01T10:00:00Z", revokes: null, ...over,
});

/**
 * ⚠ Function fixtures, not flat arrays. The recorder does not apply filters, so a flat
 * `qualification_records: [row]` answers the idempotency lookup for EVERY document id — and the
 * "a second POST replays" test would then pass against a service that never looked.
 *
 * ⚠ The default applicant has signed the FCRA disclosure, because since AF1 an MVR cannot be
 * recorded without it and every test below that is about something else would otherwise be a test
 * of that refusal. `driver_authorizations` answers by `driver_id` for the same reason as above.
 */
const seed = (over: {
  drivers?: unknown[];
  documents?: unknown[];
  records?: Array<{ id: string; document_id: string }>;
  authorizations?: Array<ReturnType<typeof auth>>;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [{ id: DRIVER, org_id: ORG }],
      driver_authorizations: (q: RecordedQuery) => {
        const driverId = q.filters().find((f) => f.col === "driver_id")?.val;
        return (over.authorizations ?? [auth("fcra_disclosure"), auth("mvr")]).filter((a) => a.driver_id === driverId);
      },
      documents: (q: RecordedQuery) => {
        const id = q.filters().find((f) => f.col === "id")?.val;
        return (over.documents ?? []).filter((d) => (d as { id: string }).id === id);
      },
      qualification_records: (q: RecordedQuery) => {
        const docId = q.filters().find((f) => f.col === "document_id")?.val;
        return (over.records ?? []).filter((r) => r.document_id === docId);
      },
      audit_logs: [],
    },
    storage: {
      createSignedUploadUrl: (path: string) => ({
        data: { signedUrl: `https://storage.test/${path}`, token: "upload-token", path },
        error: null,
      }),
    },
  });

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
});

afterAll(async () => closeTestServer(server));

describe("who may record an act", () => {
  /**
   * ⚠ THE WHOLE POINT OF THE ROUTER. A recruiter manages `recruitment` and only VIEWS `roster`, so
   * `POST /api/compliance/qualification-records` refuses them — and the checklist's lead action for
   * most applicants is *"Order the driving record"*. If this ever goes red, the board has a step its
   * own audience cannot perform, which is `CLAUDE.md`'s worked example of a workaround.
   */
  it("lets a recruiter record the driving record", async () => {
    holder.client = seed().client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "recruiter", body: FILING });
    expect(res.status).toBe(201);
  });

  it("refuses a recruiter the drug test and the Clearinghouse query — §382.401(a) custody", async () => {
    for (const step of ["drug_test", "clearinghouse"]) {
      const rec = seed();
      holder.client = rec.client;
      const res = await call(`/applicants/${DRIVER}/records/${step}`, {
        token: "recruiter",
        body: FILING,
      });
      expect(res.status, step).toBe(403);
      // Refused in middleware: nothing about this applicant was read, and nothing was written.
      expect(rec.queries).toHaveLength(0);
    }
  });

  it("lets the safety manager record all three", async () => {
    for (const step of ["mvr", "clearinghouse", "drug_test"]) {
      holder.client = seed().client;
      const res = await call(`/applicants/${DRIVER}/records/${step}`, {
        token: "safety",
        body: FILING,
      });
      expect(res.status, step).toBe(201);
    }
  });

  /**
   * ⚠ The fleet manager is the mirror of the recruiter and belongs here for the same reason PSP's
   * router names them: they manage the section and are NOT a §382.401(a) reader, so they may record
   * the driving record and not the drug test.
   */
  it("refuses the fleet manager a testing record while allowing the driving record", async () => {
    holder.client = seed().client;
    expect((await call(`/applicants/${DRIVER}/records/mvr`, { token: "fleet", body: FILING })).status)
      .toBe(201);
    holder.client = seed().client;
    expect((await call(`/applicants/${DRIVER}/records/drug_test`, { token: "fleet", body: FILING })).status)
      .toBe(403);
  });

  it("refuses a reader, a role outside the section, and the unauthenticated", async () => {
    for (const token of ["auditor", "dispatcher"]) {
      const rec = seed();
      holder.client = rec.client;
      expect((await call(`/applicants/${DRIVER}/records/mvr`, { token, body: FILING })).status, token)
        .toBe(403);
      expect(rec.queries).toHaveLength(0);
    }
    holder.client = seed().client;
    expect((await call(`/applicants/${DRIVER}/records/mvr`, { body: FILING })).status).toBe(401);
  });
});

describe("which steps this door files", () => {
  /**
   * ⚠ A 400 and not a 403, and the distinction is the reason the kind gate lets an unknown step
   * through: nobody may file a PSP report here — it has its own door with a consent attestation — so
   * "you lack permission" would be a lie told to an admin.
   */
  it("refuses PSP, which has its own door, even for an admin", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/psp`, { token: "admin", body: FILING });
    expect(res.status).toBe(400);
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses the road test (D2), the medical certificate (Q-HM11) and a made-up step", async () => {
    for (const step of ["road_test", "medical_certificate", "handbook", "cdl"]) {
      holder.client = seed().client;
      const res = await call(`/applicants/${DRIVER}/records/${step}`, { token: "admin", body: FILING });
      expect(res.status, step).toBe(400);
    }
  });
});

/**
 * ⚠ AF1 (`APPLICANT-FLOW-PLAN.md` §2.5). `SCREENING_PREREQUISITES.mvr_order` has named the FCRA
 * disclosure since A4, and until 2026-09-24 nothing asked it: PSP's order was the fold's only
 * caller, so a driving record could be put on file for somebody who had signed nothing.
 */
describe("what makes recording the act lawful", () => {
  it("refuses an MVR for an applicant with no FCRA authorization, naming it, and writes nothing", async () => {
    const rec = seed({ authorizations: [] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(400);
    expect(await message(res)).toContain("Consumer report disclosure and authorization");
    expect(rec.writes()).toHaveLength(0);
  });

  /**
   * ⚠ The fixture that discriminates: the applicant HAS signed things, just not the one that
   * matters. A check that asked "has this person signed anything" would pass the empty case above
   * and let this one through.
   */
  it("is not satisfied by the other permissions", async () => {
    holder.client = seed({
      authorizations: [auth("psp"), auth("previous_employer"), auth("drug_alcohol"), auth("clearinghouse")],
    }).client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(400);
  });

  /**
   * ⚠ D-MVR3 (2026-09-25): the MVR needs its OWN release as well as the FCRA one. Until then FCRA
   * alone opened it, because the carrier's page 19 release had nowhere to go. Each half is refused on
   * its own, so a gate that checked either one would fail one of these.
   */
  it("is not satisfied by the FCRA authorization alone — the MVR release is its own permission", async () => {
    holder.client = seed({ authorizations: [auth("fcra_disclosure")] }).client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(400);
  });

  it("nor by the MVR release alone", async () => {
    holder.client = seed({ authorizations: [auth("mvr")] }).client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(400);
  });

  it("is not satisfied by an FCRA authorization that has been revoked", async () => {
    holder.client = seed({
      authorizations: [
        auth("mvr"),
        auth("fcra_disclosure"),
        auth("fcra_disclosure", { id: "revocation-1", revokes: "fcra_disclosure-1" }),
      ],
    }).client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(400);
  });

  /** Refused before the upload too — otherwise the office uploads a scan the filing then refuses. */
  it("refuses to register the MVR's scan on the same grounds", async () => {
    const rec = seed({ authorizations: [] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr/document`, {
      token: "admin",
      body: { document_id: DOC, sha256: SHA, content_type: "application/pdf" },
    });
    expect(res.status).toBe(400);
    expect(rec.writes()).toHaveLength(0);
  });

  /**
   * ⚠ The other two acts are NOT gated, deliberately (`HIRING_RECORDED_ACT_PREREQUISITE`): the full
   * Clearinghouse query is consented to in FMCSA's portal, and a lab result must reach the file
   * whatever was signed. Pinned so a "helpful" blanket gate cannot creep in.
   */
  it("records the Clearinghouse query and the drug test with nothing signed", async () => {
    for (const step of ["clearinghouse", "drug_test"]) {
      holder.client = seed({ authorizations: [] }).client;
      const res = await call(`/applicants/${DRIVER}/records/${step}`, { token: "safety", body: FILING });
      expect(res.status, step).toBe(201);
    }
  });
});

describe("what gets written", () => {
  it("files the kind the catalogue names for the step, with the act's provenance", async () => {
    const rec = seed();
    holder.client = rec.client;
    await call(`/applicants/${DRIVER}/records/clearinghouse`, { token: "admin", body: FILING });

    const [row] = rec.writtenRows("qualification_records");
    expect(row).toMatchObject({
      org_id: ORG,
      driver_id: DRIVER,
      // ⚠ `clearinghouse_full`, from `hiringSteps.ts`' evidence table — NOT the step key. A door that
      // wrote the step name would file a kind `dqCatalogue` cannot read and no gate would notice.
      kind: "clearinghouse_full",
      occurred_on: "2026-09-10",
      result: "clean",
      performed_by: "SambaSafety",
      created_by: "u-admin",
    });
    expect(row?.detail).toMatchObject({ source: "recorded_act", hiring_step: "clearinghouse" });
    // ⚠ No `covers_until`: the §391.25 annual clock is a separate kind and does not start here (Q-HM10).
    expect(row?.covers_until).toBeNull();
  });

  it("writes the jurisdiction an MVR came from onto its detail, where the checklist reads it (AF7)", async () => {
    const rec = seed();
    holder.client = rec.client;
    await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: { ...FILING, jurisdiction: " IL " } });
    expect(rec.writtenRows("qualification_records")[0]?.detail).toMatchObject({
      hiring_step: "mvr",
      jurisdiction: "IL",
    });
  });

  it("scopes every read and write to the caller's org", async () => {
    const rec = seed({ documents: [doc()] });
    holder.client = rec.client;
    await call(`/applicants/${DRIVER}/records/mvr`, {
      token: "admin",
      body: { ...FILING, document_id: DOC },
    });
    expectOrgScoped(rec, ORG);
  });

  it("audits the filing as a recorded act, naming the step and the kind", async () => {
    const rec = seed();
    holder.client = rec.client;
    await call(`/applicants/${DRIVER}/records/drug_test`, { token: "safety", body: FILING });
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.hiring_act_recorded" });
    expect(audit?.meta).toMatchObject({ step: "drug_test", kind: "drug_test", driverId: DRIVER });
  });

  it("refuses a record dated tomorrow, and says which field", async () => {
    const rec = seed();
    holder.client = rec.client;
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await call(`/applicants/${DRIVER}/records/mvr`, {
      token: "admin",
      body: { occurred_on: future },
    });
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/future/i);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("404s for a driver who is not this org's, before writing anything", async () => {
    const rec = seed({ drivers: [] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(404);
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("the scan it cites", () => {
  it("registers the document under the step's kind, not the caller's word", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/drug_test/document`, {
      token: "safety",
      body: { document_id: DOC, sha256: SHA, content_type: "application/pdf" },
    });
    expect(res.status).toBe(201);
    const [row] = rec.writtenRows("documents");
    // ⚠ The kind IS the read restriction (0217). A registration that took it from the body would let
    // a drug-test result be filed as something anybody in the section can open.
    expect(row).toMatchObject({ kind: "drug_test", subject_id: DRIVER, org_id: ORG });
    expect(((await res.json()) as { uploadUrl: string }).uploadUrl).toContain("storage.test");
  });

  it("refuses a content type the bucket does not take", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr/document`, {
      token: "admin",
      body: { document_id: DOC, sha256: SHA, content_type: "application/zip" },
    });
    expect(res.status).toBe(400);
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a record citing another driver's document", async () => {
    const rec = seed({ documents: [doc({ subject_id: OTHER_DRIVER })] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, {
      token: "admin",
      body: { ...FILING, document_id: DOC },
    });
    expect(res.status).toBe(400);
    expect(await message(res)).toMatch(/different driver/i);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("refuses a record citing a document filed for another step", async () => {
    const rec = seed({ documents: [doc({ kind: "drug_test" })] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, {
      token: "admin",
      body: { ...FILING, document_id: DOC },
    });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("replays rather than filing one act twice — a §391.51 review counts records", async () => {
    const rec = seed({ documents: [doc()], records: [{ id: "rec-1", document_id: DOC }] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, {
      token: "admin",
      body: { ...FILING, document_id: DOC },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { recordId: string }).recordId).toBe("rec-1");
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("files without a scan, because an act is recordable before its printout is to hand", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/records/mvr`, { token: "admin", body: FILING });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("qualification_records")[0]?.document_id).toBeNull();
    // Nothing was looked up in `documents`: there was no citation to check.
    expect(rec.forTable("documents")).toHaveLength(0);
  });
});
