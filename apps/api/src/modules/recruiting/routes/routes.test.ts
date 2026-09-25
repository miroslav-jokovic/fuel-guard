import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { APPLICATION_RELEASE_ORDER, DISCLOSURES } from "@silvicom/shared";
import { PSP_VERSION } from "../defaultWording.js";
import { PSP_MANDATED_INTENT, pspDisclosure } from "../pspDisclosure.js";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * Recruitment routes — §391.21(b)(10) employment history (0208).
 *
 * Two things are pinned here and they are the two that regress silently. First the SECURITY
 * boundary: who is refused before a query runs, decided entirely in middleware, which is what breaks
 * when somebody copies a router. Second ORG SCOPING: this router reads with the service role, which
 * bypasses RLS, so `expectOrgScoped` is the only layer that can catch a missing tenant filter here —
 * the behavioural matrix proves policies, not application code.
 *
 * The roster case additionally proves the fleet table's arithmetic comes from `employmentCoverage`
 * rather than from a second approximation of it in SQL, which is the way a fleet queue and a driver
 * page come to disagree about one driver.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const ROW = "22222222-3333-4444-8555-666666666666";
/** The scan of a paper-signed permission (MV3): this org's, filed against DRIVER. */
const SCAN = "33333333-4444-4555-8666-777777777777";
const OTHERS_SCAN = "33333333-4444-4555-8666-000000000000";
const SCANS = () =>
  postgrestFixture([
    { id: SCAN, org_id: ORG, subject_type: "driver", subject_id: DRIVER },
    { id: OTHERS_SCAN, org_id: ORG, subject_type: "driver", subject_id: "99999999-8888-4777-8666-555555555555" },
  ]);

const ctx = (role: string, orgId: string | null = ORG): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId, role } as AuthContext);

const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  fleet: ctx("fleet_manager"),
  safety: ctx("safety_manager"),
  dispatcher: ctx("dispatcher"),
  auditor: ctx("auditor"),
  recruiter: ctx("recruiter"),
  driver: ctx("driver"),
};

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const { token, ...rest } = init;
  return fetch(`${baseUrl}/api/recruitment${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
};

/** A driver hired 2026-01-01 whose only declared employer left a year-long hole before the hire. */
const seed = (
  over: {
    drivers?: unknown[];
    history?: unknown[];
    auths?: unknown[];
    /** The live invitation, for the stages that exist before an application is filed (F5). */
    invitations?: unknown[];
    /** Whether anything has been typed — the only evidence a driver has started. */
    drafts?: unknown[];
    /** §391.51 records, for the checklist the board folds (AF7 reads an MVR's jurisdiction). */
    records?: unknown[];
  } = {},
): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [
        {
          id: DRIVER,
          full_name: "An Applicant",
          status: "applicant",
          hire_date: null,
          date_of_birth: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      driver_employment_history: over.history ?? [
        {
          id: ROW,
          driver_id: DRIVER,
          employer_name: "Old Carrier",
          started_on: "2022-01-01",
          ended_on: "2024-06-01",
          dot_regulated: true,
          inquiry_status: "pending",
        },
      ],
      // The recorder returns this row from `.select().single()` after an insert, the same way the
      // employment fixture does — the assertions below read the WRITE, not this.
      driver_authorizations: over.auths ?? [{ id: ROW, driver_id: DRIVER, purpose: "psp", revokes: null }],
      // Same reason as the row above: the route reads its own insert back through `.select()`, and a
      // fixture-less table hands it null, which the route correctly treats as a failed write.
      applicant_dispositions: [{ id: ROW, driver_id: DRIVER, outcome: "declined", decided_on: "2026-08-20" }],
      // The name FMCSA's "I authorize ___" blanks are filled from (D-WORD1). Without it the
      // instrument renders underscores — which is the safe failure, and not what this suite is about.
      organizations: [{ name: "Silvicom Inc" }],
      documents: SCANS(),
      application_invitations: over.invitations ?? [],
      application_drafts: over.drafts ?? [],
      qualification_records: over.records ?? [],
      audit_logs: [],
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
afterEach(() => vi.restoreAllMocks());

describe("gating — the fleet section matrix decides, not a hand-written role list", () => {
  it("refuses an unauthenticated request", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call("/pipeline")).status).toBe(401);
  });

  it("lets the hiring roles and the auditor read", async () => {
    for (const token of ["admin", "fleet", "safety", "recruiter", "auditor"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/pipeline", { token })).status).toBe(200);
    }
  });

  /**
   * The reason `recruitment` is its own section rather than a corner of `fleet`. A dispatcher reads
   * Fleet to see who is on which truck; that is not a reason to read where somebody worked in 2022,
   * and §391.53(a)(1) puts the investigation history with those making the hiring decision. Gated on
   * `fleet` — how this first shipped — both of these were 200.
   */
  it("refuses the dispatcher and the driver, who can both read Fleet", async () => {
    for (const token of ["dispatcher", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call("/pipeline", { token })).status).toBe(403);
      expect((await call(`/drivers/${DRIVER}/employment`, { token })).status).toBe(403);
      // Refused in middleware — no query ran at all.
      expect(rec.queries).toHaveLength(0);
    }
  });

  /**
   * ⚠ The preview is a READ, and its guard has to say so. Printing an application changes nothing
   * about it, and an auditor who may read the answers in the drawer may read them on paper — a route
   * gated `manage` here would have looked defensible and locked out the reader it is built for.
   */
  it("lets a viewer print the application, and refuses a section they cannot read", async () => {
    for (const token of ["auditor", "recruiter"]) {
      rec = seed();
      holder.client = rec.client;
      // 404, not 403: the guard passed and the service found no invitation in this fixture.
      expect((await call(`/applications/${ROW}/preview.pdf`, { token })).status).toBe(404);
    }
    for (const token of ["dispatcher", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      expect((await call(`/applications/${ROW}/preview.pdf`, { token })).status).toBe(403);
      expect(rec.queries).toHaveLength(0);
    }
  });

  it("lets the recruiter write — this is their section", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ driver_id: DRIVER, employer_name: "X", started_on: "2024-01-01" }),
    });
    expect(res.status).toBe(201);
  });

  it("refuses a WRITE from a role that may only view", async () => {
    for (const token of ["dispatcher", "auditor", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call("/employment", {
        method: "POST",
        token,
        body: JSON.stringify({ driver_id: DRIVER, employer_name: "X", started_on: "2024-01-01" }),
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("org scoping — the service role bypasses RLS, so the query must scope itself", () => {
  it("scopes every read behind the pipeline", async () => {
    rec = seed();
    holder.client = rec.client;
    await call("/pipeline", { token: "admin" });
    expectOrgScoped(rec, ORG);
  });

  it("scopes one driver's employment read", async () => {
    rec = seed();
    holder.client = rec.client;
    await call(`/drivers/${DRIVER}/employment`, { token: "admin" });
    expectOrgScoped(rec, ORG);
    const q = rec.forTable("driver_employment_history")[0]!;
    expect(q.filters()).toContainEqual({ col: "driver_id", val: DRIVER });
  });

  it("refuses to hang an employer off another org's driver", async () => {
    // The driver lookup comes back empty because it is org-filtered — which is the point: without
    // that filter the insert would succeed and produce an org-scoped row about somebody else's driver.
    rec = createSupabaseRecorder({ tables: { drivers: [], driver_employment_history: [], audit_logs: [] } });
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ driver_id: DRIVER, employer_name: "X", started_on: "2024-01-01" }),
    });
    expect(res.status).toBe(404);
    expect(rec.writtenRows("driver_employment_history")).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });

  it("stamps the caller's org on the insert rather than trusting the body", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "fleet",
      body: JSON.stringify({
        driver_id: DRIVER,
        employer_name: "New Carrier",
        started_on: "2024-06-01",
        usdot_number: "1234567",
      }),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_employment_history")[0]!;
    expect(written.org_id).toBe(ORG);
    expect(written.org_id).not.toBe(OTHER_ORG);
    // Every write is audited, with the compliance-relevant facts and nothing else.
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("compliance.employment_recorded");
    expect((audit.meta as Record<string, unknown>).employer).toBe("New Carrier");
  });
});

/**
 * H6/D-HIRE2. This endpoint used to list every non-terminated driver with their gaps and inquiry
 * state, which restated what the qualification page owns. It lists APPLICANTS now, so the two
 * surfaces are not looking at the same people and the duplication has nowhere to come from.
 */
describe("the pipeline lists applicants, and derives their stage", () => {
  const body = async (token = "admin") =>
    (await (await call("/pipeline", { token })).json()) as {
      applicants: Array<Record<string, unknown>>;
    };

  it("returns an applicant with everything outstanding", async () => {
    rec = seed({ history: [], auths: [] });
    holder.client = rec.client;
    const row = (await body()).applicants[0]!;
    expect(row.stage).toBe("not_started");
    expect(row.outstanding).toEqual([
      "employment_history",
      "fcra_disclosure",
      "psp",
      "previous_employer",
    ]);
    expect(row.date_of_birth_recorded).toBe(false);
  });

  it("moves an applicant along as the history lands, from the SAME function the page calls", async () => {
    rec = seed();
    holder.client = rec.client;
    const row = (await body()).applicants[0]!;
    // The seeded employer covers 2022-2024 against an application date of 2026-01-01, so the
    // §391.21(b)(10) window has a hole and the stage says so without listing it as a chase item.
    expect(row.stage).toBe("history_incomplete");
    expect(row.gap_days as number).toBeGreaterThan(0);
    expect(row.outstanding).not.toContain("employment_history");
  });

  /**
   * Asserted on the QUERY, not on the result. The recorder returns its fixture whatever filters were
   * applied — that is what makes `expectOrgScoped` possible — so "the response was empty" would prove
   * only that the fixture was empty. What has to be true is that the endpoint ASKED for applicants.
   */
  it("asks for applicants only — a hired driver is the qualification page's subject", async () => {
    rec = seed();
    holder.client = rec.client;
    await call("/pipeline", { token: "admin" });
    const q = rec.forTable("drivers")[0]!;
    expect(q.filters()).toContainEqual({ col: "status", val: "applicant" });
  });

  /**
   * ⚠ The defect the owner met by filling in their own test application: **"Not started"**, on a form
   * they were half-way through. Every other input this endpoint has comes from
   * `driver_employment_history`, which is written only at SUBMISSION — so for a driver still typing,
   * the honest answer lived in the one place nothing was looking.
   */
  it("says they are filling it in, rather than that nothing has happened", async () => {
    rec = seed({
      history: [],
      auths: [],
      invitations: [{
        id: "inv-1", driver_id: DRIVER, review_requested_at: null, approved_at: null,
        submitted_at: null, revoked_at: null, created_at: "2026-09-09T09:00:00Z",
        // AF4: filling in is something done to a SENT form.
        application_sent_at: "2026-09-09T10:00:00Z",
      }],
      drafts: [{ invitation_id: "inv-1" }],
    });
    holder.client = rec.client;
    expect((await body()).applicants[0]!.stage).toBe("filling_in");
  });

  /**
   * ⚠ AF4, and the route's half of it: the stamp must reach the fold, or every draft from AF3's
   * identity step — written on the permissions visit — would read as a form being filled in.
   */
  it("does not call a draft from the permissions visit filling in", async () => {
    rec = seed({
      history: [],
      auths: [],
      invitations: [{
        id: "inv-1", driver_id: DRIVER, review_requested_at: null, approved_at: null,
        submitted_at: null, revoked_at: null, created_at: "2026-09-09T09:00:00Z",
        application_sent_at: null,
      }],
      drafts: [{ invitation_id: "inv-1" }],
    });
    holder.client = rec.client;
    expect((await body()).applicants[0]!.stage).not.toBe("filling_in");
  });

  it("keeps 'not started' for a link nobody has opened", async () => {
    rec = seed({
      history: [],
      auths: [],
      invitations: [{
        id: "inv-1", driver_id: DRIVER, review_requested_at: null, approved_at: null,
        submitted_at: null, revoked_at: null, created_at: "2026-09-09T09:00:00Z",
      }],
      drafts: [],
    });
    holder.client = rec.client;
    expect((await body()).applicants[0]!.stage).toBe("not_started");
  });

  it("names the stage where the CARRIER owes the next move", async () => {
    rec = seed({
      history: [],
      auths: [],
      invitations: [{
        id: "inv-1", driver_id: DRIVER, review_requested_at: "2026-09-10T09:00:00Z", approved_at: null,
        submitted_at: null, revoked_at: null, created_at: "2026-09-09T09:00:00Z",
      }],
      drafts: [{ invitation_id: "inv-1" }],
    });
    holder.client = rec.client;
    expect((await body()).applicants[0]!.stage).toBe("awaiting_review");
  });

  it("⚠ ignores a revoked invitation, and a draft that belongs to one", async () => {
    // A revoked link is not an application in progress. Its draft row survives the revocation, so
    // reading drafts without reading `revoked_at` would report a stopped application as live.
    rec = seed({
      history: [],
      auths: [],
      invitations: [{
        id: "inv-1", driver_id: DRIVER, review_requested_at: null, approved_at: null,
        submitted_at: null, revoked_at: "2026-09-10T10:00:00Z", created_at: "2026-09-09T09:00:00Z",
      }],
      drafts: [{ invitation_id: "inv-1" }],
    });
    holder.client = rec.client;
    expect((await body()).applicants[0]!.stage).toBe("not_started");
  });

  it("reads only this carrier's invitations and drafts", async () => {
    // The service role bypasses RLS, so the filter is the only thing between two carriers.
    rec = seed();
    holder.client = rec.client;
    await call("/pipeline", { token: "admin" });
    for (const table of ["application_invitations", "application_drafts"]) {
      const q = rec.forTable(table)[0];
      expect(q, `${table} was never queried`).toBeDefined();
      expect(q!.filters().some((f) => f.col === "org_id")).toBe(true);
    }
  });

  /**
   * ⚠ Q-HM14: the board needs one key of each draft — `applying_as`, which sets how many places the
   * packet has — and reads it by path so nothing else in a draft (a date of birth, a licence number)
   * leaves the database for a list of applicants. The recorder hands back whole rows whatever is
   * selected, so the select is what has to be pinned.
   */
  it("reads one key of each draft, by path, and never the payload", async () => {
    rec = seed();
    holder.client = rec.client;
    await call("/pipeline", { token: "admin" });
    const selected = String(rec.forTable("application_drafts")[0]!.ops.find((o) => o.method === "select")?.args[0]);
    expect(selected).toBe(
      "invitation_id, applying_as:payload->questionnaire->>applying_as, " +
        "cdl_state:payload->>cdl_state, additional_licences:payload->additional_licences",
    );
  });

  /**
   * ⚠ AF7: the route hands the board the licences the SAME draft read declares. The recorder returns
   * rows whatever is selected, so the fixtures carry the aliased keys the path selects produce.
   * Dropping the hand-over leaves one declared state and turns a two-state driver's MVR green.
   */
  it("keeps the MVR next while a state the draft declares has no record", async () => {
    const next = async (additional: unknown[]) => {
      rec = seed({
        history: [],
        auths: APPLICATION_RELEASE_ORDER.map((purpose, i) => ({
          id: `auth-${i}`, driver_id: DRIVER, purpose, accepted_at: "2026-09-09T10:00:00Z", revokes: null,
        })),
        invitations: [{
          id: "inv-1", driver_id: DRIVER, application_sent_at: null, review_requested_at: null,
          approved_at: null, signing_opened_at: null, submitted_at: null, revoked_at: null,
          created_at: "2026-09-09T09:00:00Z",
        }],
        drafts: [{ invitation_id: "inv-1", cdl_state: "IL", additional_licences: additional }],
        records: [{ driver_id: DRIVER, kind: "mvr", created_at: "2026-09-10T00:00:00Z", jurisdiction: "IL" }],
      });
      holder.client = rec.client;
      return ((await body()).applicants[0]!.checklist as { next: string | null }).next;
    };
    expect(await next([{ issuing_authority: "WI", number: "W-1" }])).toBe("mvr");
    expect(await next([])).not.toBe("mvr");
  });

  it("goes looking for nothing when there are no applicants", async () => {
    rec = seed({ drivers: [] });
    holder.client = rec.client;
    expect((await body()).applicants).toEqual([]);
    expect(rec.forTable("driver_employment_history")).toHaveLength(0);
    expect(rec.forTable("driver_authorizations")).toHaveLength(0);
  });
});

describe("authorizations (0215) — the legal basis for a screening pull", () => {
  const grant = {
    driver_id: DRIVER,
    purpose: "psp",
    method: "wet_signature",
    signed_name: "A Driver",
    evidence_document_id: SCAN,
  };

  it("scopes the read to the org and the driver", async () => {
    rec = seed();
    holder.client = rec.client;
    await call(`/drivers/${DRIVER}/authorizations`, { token: "admin" });
    expectOrgScoped(rec, ORG);
  });

  /**
   * The whole point of the contract's shape: a caller says WHO signed and HOW, never WHAT they
   * signed. A client-authored disclosure is worth nothing in an audit, and FCRA §604(b)(2) makes the
   * wording legally load-bearing.
   */
  it("composes the disclosure server-side and ignores nothing, because the client cannot send one", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify(grant),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_authorizations")[0]!;
    // ⚠ FMCSA's own PSP form, since D-WORD1 — not the placeholder this used to assert. The office
    // recording a paper signature files exactly what the applicant signs on their phone, which is
    // the property #763 added and this is the staff-side half of it.
    expect(written.disclosure_text).toBe(pspDisclosure("Silvicom Inc").body);
    expect(written.disclosure_text).not.toBe(DISCLOSURES.psp.body);
    expect(written.intent_statement).toBe(PSP_MANDATED_INTENT);
    expect(written.disclosure_version).toBe(PSP_VERSION);
    expect(written.org_id).toBe(ORG);
  });

  it("rejects a body that tries to supply its own wording", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ ...grant, disclosure_text: "whatever we felt like" }),
    });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  it("captures the ESIGN attribution evidence, which cannot be reconstructed later", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ ...grant, method: "esign", esign_consent: true }),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_authorizations")[0]!;
    expect(written.esign_consent_at).toBeTruthy();
    expect(written.accepted_user_agent).toBeDefined();
  });

  it("refuses an e-signature without consent to transact electronically", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ ...grant, method: "esign" }),
    });
    expect(res.status).toBe(400);
  });

  it("audits which instrument was signed, and never its text", async () => {
    rec = seed();
    holder.client = rec.client;
    await call("/authorizations", { method: "POST", token: "admin", body: JSON.stringify(grant) });
    const meta = rec.writtenRows("audit_logs")[0]!.meta as Record<string, unknown>;
    expect(meta.purpose).toBe("psp");
    expect(meta.disclosureVersion).toBe(PSP_VERSION);
    // The version, never the text — and the version now names the federal form, so the audit row
    // says what was signed without needing this repository to decode it.
    expect(JSON.stringify(meta)).not.toContain(pspDisclosure("Silvicom Inc").body.slice(0, 40));
  });

  /**
   * MV3: a paper signature is only as good as the paper. Each refusal is its own case, so a check that
   * only asked "is there a document id" would pass the first and fail the second.
   */
  it("refuses a paper signature recorded without its scan", async () => {
    rec = seed();
    holder.client = rec.client;
    const { evidence_document_id: _dropped, ...noScan } = grant;
    const res = await call("/authorizations", { method: "POST", token: "admin", body: JSON.stringify(noScan) });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  it("refuses a paper signature citing another driver's scan", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ ...grant, evidence_document_id: OTHERS_SCAN }),
    });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  it("files the MVR release on paper under its own purpose, citing the scan (D-MVR1)", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify({ ...grant, purpose: "mvr" }),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_authorizations")[0]!;
    expect(written).toMatchObject({ purpose: "mvr", method: "wet_signature", evidence_document_id: SCAN });
    expect(String(written.disclosure_text)).toContain("as directed by the Federal Motor Carrier Safety Administration");
  });

  it("refuses to hang an authorization off another org's driver", async () => {
    rec = createSupabaseRecorder({ tables: { drivers: [], driver_authorizations: [], audit_logs: [] } });
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "admin",
      body: JSON.stringify(grant),
    });
    expect(res.status).toBe(404);
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  /**
   * The office's own signature, once the carrier has published (0338).
   *
   * ⚠ The test above asserts `DISCLOSURES.psp.*` and passes whatever this route reads, because no
   * carrier in that fixture has published anything and the overlay falls back to the placeholders.
   * This is the case that can tell them apart — and until 2026-09-13 this route read the code
   * catalogue, so the same instrument for the same carrier was `v1` when the applicant signed it on
   * their phone and `v0-draft` when the office recorded the paper copy.
   */
  it("composes the CARRIER's published wording, not the code's placeholder", async () => {
    rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER }],
        driver_authorizations: [{ id: ROW, driver_id: DRIVER, purpose: "psp", revokes: null }],
        org_disclosures: [{
          instrument: "psp", version: "v3", title: "PSP release",
          body: "Counsel's own PSP wording.", clauses: null,
          intent: "I authorize the PSP pull.",
          published_at: "2026-09-13T10:00:00Z", published_by: null,
        }],
        audit_logs: [],
        documents: SCANS(),
      },
    });
    holder.client = rec.client;
    const res = await call("/authorizations", {
      method: "POST",
      token: "recruiter",
      body: JSON.stringify(grant),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_authorizations")[0]!;
    expect(written.disclosure_version).toBe("v3");
    expect(written.disclosure_text).toBe("Counsel's own PSP wording.");
    expect(written.intent_statement).toBe("I authorize the PSP pull.");
    // And the audit names the version that was actually signed, not the catalogue's.
    expect(rec.writtenRows("audit_logs")[0]!.meta).toMatchObject({ disclosureVersion: "v3" });
  });

  /**
   * ⚠ A revocation names the version it WITHDRAWS. The comment in the route always said so; the code
   * read the current catalogue instead, which is indistinguishable while everything is `v0-draft`
   * and wrong from the first publish — a `v1` grant would have been revoked under `v0-draft`, and
   * the append-only history would no longer join up.
   */
  it("names the version of the grant it revokes, not the catalogue's", async () => {
    rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER }],
        driver_authorizations: [{
          id: ROW, driver_id: DRIVER, purpose: "psp", revokes: null, disclosure_version: "v2",
        }],
        org_disclosures: [{
          instrument: "psp", version: "v7", title: "Newer PSP release",
          body: "A later revision nobody signed.", clauses: null, intent: "…",
          published_at: "2026-09-13T10:00:00Z", published_by: null,
        }],
        audit_logs: [],
      },
    });
    holder.client = rec.client;
    const res = await call("/authorizations/revoke", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ revokes: ROW, reason: "Applicant withdrew" }),
    });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("driver_authorizations")[0]!.disclosure_version).toBe("v2");
  });

  it("records a revocation as a ROW naming the grant, never as an edit", async () => {
    rec = createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER }],
        driver_authorizations: [{ id: ROW, driver_id: DRIVER, purpose: "psp", revokes: null }],
        audit_logs: [],
      },
    });
    holder.client = rec.client;
    const res = await call("/authorizations/revoke", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({ revokes: ROW, reason: "Applicant withdrew" }),
    });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("driver_authorizations")[0]!;
    expect(written.revokes).toBe(ROW);
    expect(written.revoke_reason).toBe("Applicant withdrew");
    // Append-only: nothing was updated.
    expect(rec.forTable("driver_authorizations").filter((q) => q.write?.method === "update")).toHaveLength(0);
  });

  it("refuses a WRITE from a role that may only view", async () => {
    for (const token of ["dispatcher", "auditor", "driver"]) {
      rec = seed();
      holder.client = rec.client;
      const res = await call("/authorizations", {
        method: "POST",
        token,
        body: JSON.stringify(grant),
      });
      expect(res.status).toBe(403);
    }
  });
});

describe("contract", () => {
  it("refuses an end date before the start date, with a sentence rather than a 500", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({
        driver_id: DRIVER,
        employer_name: "X",
        started_on: "2024-06-01",
        ended_on: "2024-01-01",
      }),
    });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("driver_employment_history")).toHaveLength(0);
  });

  it("refuses a USDOT number that is not digits", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await call("/employment", {
      method: "POST",
      token: "admin",
      body: JSON.stringify({
        driver_id: DRIVER,
        employer_name: "X",
        started_on: "2024-01-01",
        usdot_number: "MC-1234",
      }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Why an application ended without a hire (0238).
 *
 * The pipeline had one exit and it went one way. What is pinned here is the security boundary, the
 * org filter (this router reads with the service role), and the two things a route can get wrong
 * about a decision: who it says made it, and what it copies into a log other people can read.
 */
describe("recording a decision about an applicant", () => {
  const disposition = {
    driver_id: DRIVER,
    outcome: "declined",
    decided_on: "2026-08-20",
    reason: "Two years unaccounted for and no way to reach the second employer",
    rested_on_consumer_report: true,
  };

  const post = (token: string, body: unknown = disposition) =>
    call("/dispositions", { method: "POST", token, body: JSON.stringify(body) });

  it("records it, and stamps the decider from the token rather than the body", async () => {
    rec = seed();
    holder.client = rec.client;
    const res = await post("recruiter", { ...disposition, decided_by: "somebody-else" });
    expect(res.status).toBe(201);
    const written = rec.writtenRows("applicant_dispositions")[0]!;
    expect(written.decided_by).toBe("u-recruiter");
    expect(written.outcome).toBe("declined");
    expect(written.rested_on_consumer_report).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  /**
   * ⚠ The audit log is readable by an admin with no part in hiring. A recruiter's sentence about why
   * somebody was turned down is exactly what §391.23(k)(2) keeps to the people deciding — the entry
   * says a decision happened, not what was said about the person.
   */
  it("audits that a decision happened and never copies the reason into it", async () => {
    rec = seed();
    holder.client = rec.client;
    await post("recruiter");
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("recruitment.applicant_dispositioned");
    expect(JSON.stringify(audit)).not.toContain("Two years unaccounted for");
    expect(JSON.stringify(audit.meta)).toContain("declined");
  });

  /**
   * ⚠ Ending an employment is a termination — its own date, its own §391.51(c) clock, its own effect
   * on the DQ file. Refused rather than allowed-and-ignored, or the record of somebody the carrier
   * employs would carry the word "declined".
   */
  it("refuses to decide about somebody who is already employed", async () => {
    rec = seed({ drivers: [{ id: DRIVER, full_name: "An Employee", status: "active" }] });
    holder.client = rec.client;
    const res = await post("recruiter");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_an_applicant");
    expect(rec.writtenRows("applicant_dispositions")).toHaveLength(0);
  });

  it("answers 404 for a driver in another org, and writes nothing", async () => {
    rec = seed({ drivers: [] });
    holder.client = rec.client;
    expect((await post("recruiter")).status).toBe(404);
    expect(rec.writtenRows("applicant_dispositions")).toHaveLength(0);
  });

  it("refuses an outcome that is not one of the three", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await post("recruiter", { ...disposition, outcome: "hired" })).status).toBe(400);
  });

  it.each([["dispatcher"], ["driver"]])("refuses %s before any query runs", async (token) => {
    rec = seed();
    holder.client = rec.client;
    expect((await post(token)).status).toBe(403);
    expect(rec.queries).toHaveLength(0);
  });

  it("lets a recruitment viewer read the history without being able to write one", async () => {
    rec = seed();
    holder.client = rec.client;
    expect((await call(`/drivers/${DRIVER}/dispositions`, { token: "auditor" })).status).toBe(200);
    expect((await post("auditor")).status).toBe(403);
  });
});
