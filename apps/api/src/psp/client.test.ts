import { describe, it, expect, vi } from "vitest";
import type { PspRequestDraft } from "@fuelguard/shared";
import { loadEnv } from "../env.js";
import {
  PspError,
  PspNotConfiguredError,
  fetchMonitoringReport,
  fetchRecordPdf,
  pspHost,
  requestRecord,
  toPspDate,
} from "./client.js";

/**
 * The PSP vendor edge. No network: every case is a scripted `fetch`, because the production key
 * BILLS on Success, Partial and Failure (§8) and there is no free rehearsal on it.
 *
 * What these pin is the three properties that have to be structural rather than remembered — no
 * retry on the billed call, no automatic token mint, and both HTTP status and body status read.
 */

const env = (over: Record<string, string> = {}) =>
  loadEnv({ NODE_ENV: "test", PSP_API_KEY: "test-key", PSP_ENVIRONMENT: "uat", ...over } as NodeJS.ProcessEnv);

const draft: PspRequestDraft = {
  driverFirstName: "SUSAN",
  driverLastName: "GODFREY",
  driverDOB: "1949-12-11",
  dotNumber: "43586",
  internalRefId: "driver-uuid",
  driverConsent: true,
  licenseQueries: [{ dlNum: "PA334554", dlState: "pa", dlFirstName: "SUSAN", dlLastName: "GODFREY" }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const successBody = [
  {
    driverInformationResponse: {
      status: 0,
      statusDetail: 0,
      authCode: "auth-1",
      internalRefId: "driver-uuid",
      driverLicenseNumber: "PA334554",
      driverLicenseState: "PA",
      driverRecord: { inspectionRecords: [], crashRecords: [] },
    },
    monitor: false,
  },
];

describe("configuration", () => {
  it("refuses to call anything without a key, rather than sending an unauthenticated request", async () => {
    await expect(requestRecord(env({ PSP_API_KEY: "" }), draft)).rejects.toBeInstanceOf(PspNotConfiguredError);
  });

  /** Tokens are per environment; pointing a UAT token at production is not a harmless typo. */
  it("picks the host from the environment", () => {
    expect(pspHost(env())).toBe("https://rest-api.uat.psp.tylerapp.com");
    expect(pspHost(env({ PSP_ENVIRONMENT: "production" }))).toBe(
      "https://www.psp.fmcsa.dot.gov/PspRestService",
    );
  });

  it("converts the date of birth to the format PSP's own test data uses", () => {
    expect(toPspDate("1949-12-11")).toBe("12/11/1949");
    expect(toPspDate("1974-07-07")).toBe("7/7/1974");
  });
});

describe("requestRecord — the call that bills", () => {
  it("sends ONE driver, uppercases the jurisdiction, and carries the key", async () => {
    const fetchImpl = vi.fn(async () => json(successBody));
    await requestRecord(env(), draft, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rest-api.uat.psp.tylerapp.com/Records");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string) as unknown[];
    // §5: one bad row cancels the whole batch, so the batch is one.
    expect(body).toHaveLength(1);
    const sent = body[0] as Record<string, unknown>;
    expect(sent.driverDOB).toBe("12/11/1949");
    expect((sent.licenseQueries as Array<{ dlState: string }>)[0]!.dlState).toBe("PA");
  });

  /**
   * The property this module exists to guarantee. There is no idempotency header and nothing says
   * PSP de-duplicates, so a reset after they processed the request is indistinguishable from one
   * before — and §8 has already charged either way.
   */
  it("does NOT retry a transport failure, and says it does not know whether we were charged", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const err = await requestRecord(env(), draft, { fetchImpl: fetchImpl as unknown as typeof fetch }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PspError);
    expect((err as PspError).charged).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /** §5.4.2 — a validation refusal comes back as validationIssues, not as a record. §8 does not bill it. */
  it("surfaces a validation refusal as a typed failure that cost nothing", async () => {
    const fetchImpl = vi.fn(async () =>
      json([{ originalRequest: {}, validationIssues: [{ status: "Error", statusDetail: 17 }] }]),
    );
    const err = (await requestRecord(env(), draft, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e)) as PspError;
    expect(err.detail).toBe(17);
    expect(err.charged).toBe(false);
    expect(err.message).toContain("authorization");
  });

  /** Status 2 in a 200 body. A caller must never file this as a report. */
  it("converts an error status inside a 200 into a failure", async () => {
    const fetchImpl = vi.fn(async () =>
      json([{ driverInformationResponse: { status: 2, statusDetail: 30 } }]),
    );
    const err = (await requestRecord(env(), draft, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e)) as PspError;
    expect(err.detail).toBe(30);
    expect(err.charged).toBe(false);
    // A token problem is the operator's to fix; retrying or re-validating will not help.
    expect(err.operatorAction).toBe(true);
  });

  it("returns a Failure as a REPORT, because §8 charged us for it", async () => {
    const fetchImpl = vi.fn(async () =>
      json([{ driverInformationResponse: { status: 1, statusDetail: 1, authCode: "auth-2" } }]),
    );
    const { report } = await requestRecord(env(), draft, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(report.outcome).toBe("failure");
    expect(report.billed).toBe(true);
  });

  it("keeps the raw response verbatim — it is the evidence, not a re-purchasable thing", async () => {
    const fetchImpl = vi.fn(async () => json(successBody));
    const { raw } = await requestRecord(env(), draft, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(raw).toEqual(successBody);
  });

  it("does not pretend a non-JSON body is a report", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    const err = (await requestRecord(env(), draft, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e)) as PspError;
    expect(err).toBeInstanceOf(PspError);
    expect(err.charged).toBeNull();
  });
});

describe("fetchRecordPdf", () => {
  it("returns the bytes when they are a PDF", async () => {
    const pdf = Buffer.from("%PDF-1.3\nbody");
    const fetchImpl = vi.fn(async () => new Response(pdf));
    const out = await fetchRecordPdf(env(), "auth-1", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.subarray(0, 4).toString()).toBe("%PDF");
  });

  /**
   * §7.1: "In cases where there is an error, the PDF ReturnType will return a string that starts with
   * ERROR." Piped straight to storage that becomes a text file with a .pdf name and a valid sha256.
   */
  it("refuses an ERROR string wearing a PDF's content type", async () => {
    const fetchImpl = vi.fn(async () => new Response("ERROR: report expired"));
    await expect(
      fetchRecordPdf(env(), "auth-1", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(PspError);
  });
});

describe("fetchMonitoringReport — the only endpoint that neither bills nor mints", () => {
  it("reads the report", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ success: 1, errorCode: 0, report: [{ authCode: "a", lastName: "GODFREY", internalRefId: "d1", timeStamp: "t", changeDetected: true }] }),
    );
    const rows = await fetchMonitoringReport(env(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changeDetected).toBe(true);
  });

  /** Observed against production on 2026-08-19: a bad key answers HTTP 401 AND errorCode 32. */
  it("reads both the HTTP status and the body when the key is rejected", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ success: 0, report: null, errorCode: 32, errorDescription: "Your token is invalid." }, 401),
    );
    const err = (await fetchMonitoringReport(env(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e)) as PspError;
    expect(err.detail).toBe(32);
    expect(err.httpStatus).toBe(401);
    expect(err.operatorAction).toBe(true);
  });
});
