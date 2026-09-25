import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken } from "./applicationIntake.js";
import { APPLICANT_COPY_TTL_SEC } from "./applicationCopy.js";
import {
  ROAD_TEST_CERTIFICATE_FILENAME,
  applicantRoadTestCertificate,
} from "./applicationRoadTestCopy.js";

/**
 * The driver's copy of their road-test certificate (§391.31(g), RT4).
 *
 * ⚠ The recorder does not filter (it hands back the fixture whatever the query said), so the fixtures
 * that matter here are FUNCTIONS of the filters actually applied: a certificate row answers only a
 * query for this org, this driver, kind `road_test` and RT3's own source. Drop any one of those and
 * the query finds nothing and the test goes red — which is the only way a flat array could not fail.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RECORD = "11111111-2222-4333-8444-555555555555";
const CERTIFICATE = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
const TOKEN = "t".repeat(43);
const NOW = new Date("2026-09-25T12:00:00Z");

const invitationRow = (over: Record<string, unknown> = {}) => ({
  id: INVITATION,
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2099-01-01T00:00:00Z",
  revoked_at: null,
  submitted_at: "2026-09-24T10:00:00Z",
  ...over,
});

const filterOf = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

/** A certificate RT3 filed — found only by a query that asks for exactly that. */
const certificateFixture = (rows: unknown[]) => (q: RecordedQuery) =>
  filterOf(q, "org_id") === ORG
  && filterOf(q, "driver_id") === DRIVER
  && filterOf(q, "kind") === "road_test"
  && filterOf(q, "detail->>source") === "road_test"
    ? rows
    : [];

const documentFixture = (q: RecordedQuery) =>
  filterOf(q, "org_id") === ORG && filterOf(q, "id") === CERTIFICATE
    ? [{ storage_path: `${ORG}/driver/${DRIVER}/certificate.pdf` }]
    : [];

const seed = (over: { invitation?: Record<string, unknown> | null; records?: unknown[]; documents?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [over.invitation ?? invitationRow()],
      qualification_records: certificateFixture(
        over.records ?? [{ id: RECORD, document_id: CERTIFICATE, occurred_on: "2026-09-25" }],
      ),
      documents: (over.documents as never) ?? documentFixture,
      audit_logs: [],
    },
    storage: {
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://storage.test/signed/${path}?token=abc` },
        error: null,
      }),
    },
  });

describe("handing the driver their road-test certificate", () => {
  it("signs a short-lived URL for the certificate RT3 filed", async () => {
    const rec = seed();
    const result = await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    expect("url" in result && result.url).toBe(
      `https://storage.test/signed/${ORG}/driver/${DRIVER}/certificate.pdf?token=abc`,
    );
    expect("filename" in result && result.filename).toBe("road-test-certificate.pdf");
    expect("expiresInSeconds" in result && result.expiresInSeconds).toBe(APPLICANT_COPY_TTL_SEC);
  });

  it("asks Storage for the application copy's TTL and a download name, never the bytes", async () => {
    const rec = seed();
    await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    const call = rec.storageCalls().find((c) => c.fn === "createSignedUrl");
    expect(call?.args[1]).toBe(APPLICANT_COPY_TTL_SEC);
    expect(call?.args[2]).toEqual({ download: ROAD_TEST_CERTIFICATE_FILENAME });
    expect(rec.storageCalls().some((c) => c.fn === "download")).toBe(false);
  });

  it("reads only this carrier's rows, with the service role that bypasses RLS", async () => {
    const rec = seed();
    await applicantRoadTestCertificate(rec.client, TOKEN, NOW);
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("follows the qualification record to the certificate, never documents by kind to the form", async () => {
    // ⚠ Both PDFs RT3 files are `documents.kind = 'road_test'`; only the record's `document_id` is
    // known to be the certificate. A read of `documents` by kind is the one that could hand over the
    // examiner's ratings.
    const rec = seed();
    await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    const docReads = rec.forTable("documents");
    expect(docReads).toHaveLength(1);
    expect(filterOf(docReads[0]!, "id")).toBe(CERTIFICATE);
    expect(filterOf(docReads[0]!, "kind")).toBeUndefined();
    // A record whose certificate was never filed cites nothing; the query must not pick it.
    const records = rec.forTable("qualification_records")[0]!;
    expect(records.ops).toContainEqual({ method: "not", args: ["document_id", "is", null] });
  });

  it("hands over the latest certificate: test date first, then filing", async () => {
    const rec = seed();
    await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    const orders = rec.forTable("qualification_records")[0]!.ops.filter((o) => o.method === "order");
    expect(orders.map((o) => o.args)).toEqual([
      ["occurred_on", { ascending: false }],
      ["created_at", { ascending: false }],
    ]);
  });

  it("records the read against the qualification record", async () => {
    const rec = seed();
    await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    const audit = rec.writtenRows("audit_logs");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("road_test_certificate_downloaded");
    expect(audit[0]!.org_id).toBe(ORG);
    expect(audit[0]!.entity).toBe("qualification_records");
    expect(audit[0]!.entity_id).toBe(RECORD);
  });

  it("says 'not yet', not 'invalid link', when there is no certificate", async () => {
    const rec = seed({ records: [] });
    const result = await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    expect("code" in result && result.code).toBe("no_certificate");
    expect("message" in result && result.message).toMatch(/after you pass/);
    expect(rec.storageCalls()).toHaveLength(0);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("reads a record citing a document this carrier does not hold as 'not just now'", async () => {
    const rec = seed({ documents: [] });
    const result = await applicantRoadTestCertificate(rec.client, TOKEN, NOW);

    expect("code" in result && result.code).toBe("document_unavailable");
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("gives a dead link the same answer every other route gives it", async () => {
    for (const invitation of [
      null,
      invitationRow({ revoked_at: "2026-09-24T00:00:00Z" }),
      invitationRow({ expires_at: "2020-01-01T00:00:00Z" }),
    ]) {
      const rec = seed({ invitation });
      const result = await applicantRoadTestCertificate(rec.client, TOKEN, NOW);
      expect("code" in result && result.code).toBe("invalid_link");
      expect(rec.storageCalls()).toHaveLength(0);
    }
  });

  it("signs nothing for a token that is not this invitation's", async () => {
    const rec = seed();
    const result = await applicantRoadTestCertificate(rec.client, "x".repeat(43), NOW);
    expect("code" in result && result.code).toBe("invalid_link");
    expect(rec.storageCalls()).toHaveLength(0);
  });
});
