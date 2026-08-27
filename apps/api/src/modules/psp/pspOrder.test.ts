import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { PspError } from "./client.js";
import { orderPspRecord, pspOrderPreflight, type PspOrderInput } from "./pspOrder.js";

/**
 * The order path. §8 charges the transaction fee on Success, Partial AND Failure, so every assertion
 * about a refusal is an assertion about money: a gate that lets a bad order through costs the price
 * of the report, and one that refuses after the ledger row exists leaves a row nobody can explain.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const env = (over: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: "test",
    PSP_API_KEY_UAT: "test-key",
    PSP_ENVIRONMENT: "uat",
    PSP_ORDERS_ENABLED: "true",
    PSP_DOT_NUMBER: "43586",
    PSP_MONTHLY_LIMIT: "50",
    ...over,
  } as NodeJS.ProcessEnv);

const DRIVER_ROW = {
  id: DRIVER,
  first_name: "SUSAN",
  last_name: "GODFREY",
  full_name: "Susan Godfrey",
  date_of_birth: "1949-12-11",
  cdl_number: "PA334554",
  cdl_state: "PA",
};

const AUTHS = [
  { id: "a1", purpose: "psp", accepted_at: "2026-01-01T00:00:00Z", revokes: null },
  { id: "a2", purpose: "fcra_disclosure", accepted_at: "2026-01-01T00:00:00Z", revokes: null },
];

const report = (over: Record<string, unknown> = {}) => ({
  outcome: "success",
  status: 0,
  statusDetail: 0,
  statusDescription: null,
  billed: true,
  authCode: "auth-1",
  internalRefId: DRIVER,
  requestDate: "2026-08-19T00:00:00Z",
  driverLicenseNumber: "PA334554",
  driverLicenseState: "PA",
  monitor: false,
  summary: { driverInspCount: 0, driverOOSCount: 0, driverOOSRateRaw: null, vehicleInspCount: 0, vehicleOOSCount: 0, crashes: 0, crashesWithFatalities: 0, crashesWithInjuries: 0, towaways: 0, crashesNotPreventable: 0, hazmatReleases: 0 },
  inspections: [],
  crashes: [],
  ...over,
});

const seed = (over: { drivers?: unknown[]; auths?: unknown[]; count?: number } = {}) =>
  createSupabaseRecorder({
    tables: {
      drivers: over.drivers ?? [DRIVER_ROW],
      driver_authorizations: over.auths ?? AUTHS,
      psp_requests: { data: [{ id: "req-1" }], count: over.count ?? 0 },
      documents: [],
      qualification_records: [{ id: "rec-1" }],
    },
  });

const input: PspOrderInput = { orgId: ORG, driverId: DRIVER, userId: "u1", stepUp: true };

type Deps = Parameters<typeof orderPspRecord>[3];
const deps = (over: Partial<Deps> = {}): Deps & { requestRecord: ReturnType<typeof vi.fn> } =>
  ({
    requestRecord: over.requestRecord ?? vi.fn(async () => ({ report: report(), raw: { any: "thing" } })),
    fetchRecordPdf: over.fetchRecordPdf ?? vi.fn(async () => Buffer.from("%PDF-1.3 x")),
  }) as Deps & { requestRecord: ReturnType<typeof vi.fn> };

describe("the gates, in the order legality → authority → budget → correctness", () => {
  /** A credential being present is not consent to spend on it. */
  it("refuses when ordering is switched off, and buys nothing", async () => {
    const rec = seed();
    const d = deps();
    const out = await orderPspRecord(rec.client, env({ PSP_ORDERS_ENABLED: "false" }), input, d);
    expect(out).toMatchObject({ code: "psp_disabled" });
    expect(d.requestRecord).not.toHaveBeenCalled();
    expect(rec.writtenRows("psp_requests")).toHaveLength(0);
  });

  /**
   * PSP refuses without the driver's authorization (§8.5 detail 17) and so do we — before the request
   * is even built, so nothing can send `driverConsent: true` on a developer's say-so.
   */
  it("refuses without BOTH the PSP authorization and the FCRA disclosure, naming what is missing", async () => {
    const rec = seed({ auths: [AUTHS[0]] });
    const d = deps();
    const out = await orderPspRecord(rec.client, env(), input, d);
    expect(out).toMatchObject({ code: "authorization_missing", missing: ["fcra_disclosure"] });
    expect(d.requestRecord).not.toHaveBeenCalled();
  });

  it("refuses again the moment the authorization is revoked", async () => {
    const rec = seed({ auths: [...AUTHS, { id: "r", purpose: "psp", accepted_at: "2026-02-01T00:00:00Z", revokes: "a1" }] });
    const out = await orderPspRecord(rec.client, env(), input, deps());
    expect(out).toMatchObject({ code: "authorization_missing", missing: ["psp"] });
  });

  /**
   * Two switches in front of production, not one. `PSP_ENVIRONMENT` looks like configuration and
   * spends money, so a single wrong value in a copied `.env` or a deploy template must not be enough.
   */
  it("refuses production until it is acknowledged explicitly, and buys nothing", async () => {
    const rec = seed();
    const d = deps();
    const out = await orderPspRecord(rec.client, env({ PSP_ENVIRONMENT: "production" }), input, d);
    expect(out).toMatchObject({ code: "psp_disabled" });
    expect((out as { message: string }).message).toContain("PSP_PRODUCTION_ACKNOWLEDGED");
    expect(d.requestRecord).not.toHaveBeenCalled();
    expect(rec.writtenRows("psp_requests")).toHaveLength(0);
  });

  it("allows production once both switches agree", async () => {
    const rec = seed();
    const d = deps();
    const out = await orderPspRecord(
      rec.client,
      env({ PSP_ENVIRONMENT: "production", PSP_PRODUCTION_ACKNOWLEDGED: "true" }),
      input,
      d,
    );
    expect(out).not.toMatchObject({ code: "psp_disabled" });
  });

  /** UAT is the default, so the interlock must not stand in the way of the environment we test in. */
  it("does not ask for the acknowledgement in UAT", async () => {
    const rec = seed();
    const out = await orderPspRecord(rec.client, env({ PSP_ENVIRONMENT: "uat" }), input, deps());
    expect(out).not.toMatchObject({ code: "psp_disabled" });
  });

  it("refuses without a fresh re-authentication", async () => {
    const rec = seed();
    const d = deps();
    const out = await orderPspRecord(rec.client, env(), { ...input, stepUp: false }, d);
    expect(out).toMatchObject({ code: "step_up_required" });
    expect(d.requestRecord).not.toHaveBeenCalled();
  });

  it("refuses over budget — a runaway loop hits a ceiling, not an invoice", async () => {
    const rec = seed({ count: 50 });
    const d = deps();
    const out = await orderPspRecord(rec.client, env(), input, d);
    expect(out).toMatchObject({ code: "budget_exceeded", used: 50, limit: 50 });
    expect(d.requestRecord).not.toHaveBeenCalled();
  });

  /** §8 charges for a Failure, so a licence PSP could never match is a purchase we decline to make. */
  it("refuses a request that could not have matched, before paying to find out", async () => {
    const rec = seed({ drivers: [{ ...DRIVER_ROW, date_of_birth: null }] });
    const d = deps();
    const out = await orderPspRecord(rec.client, env(), input, d);
    expect(out).toMatchObject({ code: "invalid_request" });
    expect((out as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(d.requestRecord).not.toHaveBeenCalled();
  });

  it("scopes every read to the org", async () => {
    const rec = seed();
    await orderPspRecord(rec.client, env(), input, deps());
    expectOrgScoped(rec, ORG, {
      // `organizations` is filtered by its PRIMARY KEY, which IS the tenant id — there is no
      // `org_id` column on the table that owns the concept. Same exemption dqAlertScheduler makes.
      exempt: ["organizations"],
    });
  });

  /** Every refusal happens before the ledger row, so a declined order leaves nothing to explain. */
  it("writes NO ledger row for any refusal", async () => {
    const cases: Array<[Record<string, string>, Partial<PspOrderInput>, Parameters<typeof seed>[0]]> = [
      [{ PSP_ORDERS_ENABLED: "false" }, {}, {}],
      [{}, { stepUp: false }, {}],
      [{}, {}, { count: 50 }],
      [{}, {}, { auths: [] }],
    ];
    for (const [envOver, inputOver, seedOver] of cases) {
      const rec = seed(seedOver);
      await orderPspRecord(rec.client, env(envOver), { ...input, ...inputOver }, deps());
      expect(rec.writtenRows("psp_requests")).toHaveLength(0);
    }
  });
});

describe("the order itself", () => {
  it("writes the ledger row BEFORE the call, with the licence and DOB redacted", async () => {
    const rec = seed();
    await orderPspRecord(rec.client, env(), input, deps());
    const row = rec.writtenRows("psp_requests")[0]!;
    expect(row.status).toBe("sent");
    expect(row.internal_ref_id).toBe(DRIVER);
    const body = row.request_body as Record<string, unknown>;
    expect(body.driverDOB).toBe("[redacted]");
    expect(JSON.stringify(body)).not.toContain("PA334554");
    expect(JSON.stringify(body)).not.toContain("1949-12-11");
  });

  it("files the PDF and cites it from a qualification record", async () => {
    const rec = seed();
    const out = await orderPspRecord(rec.client, env(), input, deps());
    expect(out).toMatchObject({ clean: true });
    const doc = rec.writtenRows("documents")[0]!;
    expect(doc.kind).toBe("psp_report");
    expect(doc.content_type).toBe("application/pdf");
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    const record = rec.writtenRows("qualification_records")[0]!;
    expect(record.kind).toBe("psp_report");
    expect(record.result).toBe("clean");
    expect(record.document_id).toBe(doc.id);
  });

  /** §8.3 — a record with no crashes and no inspections IS a valid record, and it reads "clean". */
  it("settles a Failure as failed, BILLED, and files no evidence", async () => {
    const rec = seed();
    const d = deps({
      requestRecord: vi.fn(async () => ({
        report: report({ outcome: "failure", status: 1, authCode: null }),
        raw: {},
      })) as unknown as Deps["requestRecord"],
    });
    const out = await orderPspRecord(rec.client, env(), input, d);
    expect(out).toMatchObject({ recordId: null, documentId: null });
    const settle = rec.writtenRows("psp_requests")[1]!;
    expect(settle.status).toBe("failed");
    expect(settle.billed).toBe(true);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  /**
   * The transport case. We do not know whether PSP billed us, so the row claims neither — and the
   * client never retried, so this is the only record that the money may be gone.
   */
  it("settles indeterminate when the call may or may not have been charged", async () => {
    const rec = seed();
    const d = deps({
      requestRecord: vi.fn(async () => {
        throw new PspError({ message: "ECONNRESET", charged: null });
      }),
    });
    await expect(orderPspRecord(rec.client, env(), input, d)).rejects.toBeInstanceOf(PspError);
    const settle = rec.writtenRows("psp_requests")[1]!;
    expect(settle.status).toBe("indeterminate");
    expect(settle.billed).toBe(false);
  });

  it("keeps the report even when the PDF cannot be fetched — the bytes are re-fetchable, the report is not", async () => {
    const rec = seed();
    const d = deps({
      fetchRecordPdf: vi.fn(async () => {
        throw new PspError({ message: "ERROR: expired", charged: false });
      }),
    });
    const out = await orderPspRecord(rec.client, env(), input, d);
    expect((out as { recordId: string | null }).recordId).toBe("rec-1");
    expect(rec.writtenRows("documents")).toHaveLength(0);
  });
});

/**
 * 0219's hardening, from the service side.
 *
 * The price is the half of invoice reconciliation `billed` does not carry: WHETHER PSP charged is a
 * fact about the transaction, WHAT the rate was is a fact about the day, and only the row can hold
 * the second one. A deployment nobody has told the price stores null — which reads as "we were not
 * told", never as "free".
 */
describe("what the ledger row records about money", () => {
  it("stamps the rate in effect when the request was made", async () => {
    const rec = seed();
    await orderPspRecord(rec.client, env({ PSP_UNIT_PRICE_USD: "12.5" }), input, deps());
    expect(rec.writtenRows("psp_requests")[0]!.unit_price_usd).toBe(12.5);
  });

  it("stores null when nobody has told us the price, rather than zero", async () => {
    const rec = seed();
    await orderPspRecord(rec.client, env(), input, deps());
    expect(rec.writtenRows("psp_requests")[0]!.unit_price_usd).toBeNull();
  });
});

/**
 * The preflight asks the same gates the order asks, minus the one about who is asking — and it says
 * so with `{ authority: false }` rather than by claiming a step-up that has not happened.
 */
describe("the preflight", () => {
  it("names the missing release instead of asking for a password first", async () => {
    const rec = seed({ auths: [] });
    const out = await pspOrderPreflight(rec.client, env(), { orgId: ORG, driverId: DRIVER });
    expect(out.refusal?.code).toBe("authorization_missing");
  });

  it("never answers step_up_required, whatever else is wrong", async () => {
    const rec = seed({ auths: [] });
    const out = await pspOrderPreflight(rec.client, env(), { orgId: ORG, driverId: DRIVER });
    expect(out.refusal?.code).not.toBe("step_up_required");
  });

  it("reads the billing outcomes from the §8.5 table rather than a second list", async () => {
    const rec = seed();
    const out = await pspOrderPreflight(rec.client, env(), { orgId: ORG, driverId: DRIVER });
    expect([...out.billsOn].sort()).toEqual(["failure", "partial", "success"]);
  });

  it("makes no vendor call and writes nothing", async () => {
    const rec = seed();
    await pspOrderPreflight(rec.client, env(), { orgId: ORG, driverId: DRIVER });
    expect(rec.writes()).toHaveLength(0);
    expectOrgScoped(rec, ORG, {
      // `organizations` is filtered by its PRIMARY KEY, which IS the tenant id — there is no
      // `org_id` column on the table that owns the concept. Same exemption dqAlertScheduler makes.
      exempt: ["organizations"],
    });
  });
});
