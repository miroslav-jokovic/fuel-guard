import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../../testing/postgrestFixture.js";
import { pdfText } from "../../../../testing/pdfText.js";
import { derivedUuid } from "../../../../lib/derivedUuid.js";
import { DRUG_ALCOHOL_POLICY_PLACEMENT_ID, DRUG_ALCOHOL_POLICY_VERSION } from "./drugAlcoholPolicyText.js";
import { drugAlcoholPolicyPdf, fileDrugAlcoholPolicy, filedPolicyDocumentId, policyReceipt } from "./drugAlcoholPolicyCopy.js";

/**
 * The policy as given and as filed (DAP2, §15.2 D-DAP2/D-DAP3/D-DAP5). What is pinned: the receipt prints
 * only on the text it was signed for; the signed policy files on the driver as `drug_alcohol_policy`
 * under an id derived from the application, so a retry is a replay that renders nothing; a summary, a
 * p28 from before 0565 and a p28 for another text file nothing; every read is org-scoped.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const APP_ID = "11111111-2222-4333-8444-555555555555";
const APPLICATION = { id: APP_ID, org_id: ORG, driver_id: DRIVER, invitation_id: "inv-1" };
const NAME = "Susan Godfrey";

const p28 = (policy_version: string | null) => ({
  org_id: ORG, invitation_id: "inv-1", placement_id: DRUG_ALCOHOL_POLICY_PLACEMENT_ID,
  signed_name: NAME, signed_at: "2026-11-04T16:00:00Z", policy_version,
});
/** Another place on the same link, so a reader that forgot to ask for p28 would find it first. */
const p27 = { org_id: ORG, invitation_id: "inv-1", placement_id: "p27", signed_name: NAME, signed_at: "2026-11-04T15:59:00Z", policy_version: null };

const seed = (marks: Array<Record<string, unknown>>, documents: Array<Record<string, unknown>> = []) =>
  createSupabaseRecorder({
    tables: {
      application_packet_marks: postgrestFixture(marks),
      documents: postgrestFixture(documents),
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      signature_adoptions: [],
      application_captures: [],
      application_packet_mark_adoptions: [],
    },
  });

const inserted = (rec: ReturnType<typeof seed>) =>
  rec.forTable("documents").filter((q) => q.write?.method === "insert").map((q) => q.write!.payload as Record<string, unknown>);

describe("filing the signed policy with the packet", () => {
  it("files it on the driver as drug_alcohol_policy, under the id derived from the application", async () => {
    const rec = seed([p27, p28(DRUG_ALCOHOL_POLICY_VERSION)]);
    const result = await fileDrugAlcoholPolicy(rec.client, APPLICATION);
    expect(result).toEqual({ filed: true, documentId: filedPolicyDocumentId(APP_ID), replay: false });
    expect(filedPolicyDocumentId(APP_ID)).toBe(derivedUuid(`drug-alcohol-policy:${APP_ID}`));
    const [row] = inserted(rec);
    expect(row).toMatchObject({
      id: filedPolicyDocumentId(APP_ID), org_id: ORG, subject_type: "driver", subject_id: DRIVER,
      kind: "drug_alcohol_policy", content_type: "application/pdf", uploaded_by: null,
    });
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const upload = rec.storageCalls().find((c) => c.fn === "upload")!;
    expect(String(upload.args[0])).toContain(DRIVER);
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "signature_adoptions", "application_captures", "application_packet_mark_adoptions"] });
  });

  it("is a replay the second time: renders nothing, uploads nothing, inserts nothing", async () => {
    const rec = seed([p28(DRUG_ALCOHOL_POLICY_VERSION)], [{ org_id: ORG, id: filedPolicyDocumentId(APP_ID), storage_path: "x" }]);
    expect(await fileDrugAlcoholPolicy(rec.client, APPLICATION)).toEqual({
      filed: true, documentId: filedPolicyDocumentId(APP_ID), replay: true,
    });
    expect(inserted(rec)).toEqual([]);
    expect(rec.storageCalls()).toEqual([]);
    expect(rec.forTable("application_packet_marks")).toEqual([]);
  });

  it("files nothing for an application with no page 28 — the §391.21 summary", async () => {
    const rec = seed([]);
    expect(await fileDrugAlcoholPolicy(rec.client, APPLICATION)).toEqual({ filed: false, reason: "no_receipt" });
    expect(inserted(rec)).toEqual([]);
  });

  it("files nothing for a p28 made before 0565, which named no text (D-DAP5)", async () => {
    const rec = seed([p28(null)]);
    expect(await fileDrugAlcoholPolicy(rec.client, APPLICATION)).toEqual({ filed: false, reason: "receipt_before_0565" });
    expect(inserted(rec)).toEqual([]);
  });

  it("files nothing for a p28 signed against another text — the driver was never given this one", async () => {
    const rec = seed([p28("dap-0000000000000000")]);
    expect(await fileDrugAlcoholPolicy(rec.client, APPLICATION)).toEqual({ filed: false, reason: "signed_under_other_text" });
    expect(inserted(rec)).toEqual([]);
  });

  it("files nothing for an application with no link", async () => {
    const rec = seed([p28(DRUG_ALCOHOL_POLICY_VERSION)]);
    expect(await fileDrugAlcoholPolicy(rec.client, { ...APPLICATION, invitation_id: null })).toEqual({ filed: false, reason: "no_invitation" });
  });
});

describe("the receipt on the policy's signature line", () => {
  it("reads p28 and no other place, scoped to the org and the link", async () => {
    const rec = seed([p27, p28(DRUG_ALCOHOL_POLICY_VERSION)]);
    expect(await policyReceipt(rec.client, ORG, "inv-1")).toEqual({
      signedName: NAME, signedAt: "2026-11-04T16:00:00Z", policyVersion: DRUG_ALCOHOL_POLICY_VERSION,
    });
    const filters = rec.forTable("application_packet_marks")[0]!.filters();
    expect(filters).toEqual(expect.arrayContaining([
      { col: "org_id", val: ORG }, { col: "invitation_id", val: "inv-1" }, { col: "placement_id", val: "p28" },
    ]));
  });

  it("prints the signer's name on the text it was signed for, and leaves the line blank on any other", async () => {
    const rec = seed([]);
    const signed = await pdfText(await drugAlcoholPolicyPdf(rec.client, ORG, "inv-1", {
      signedName: NAME, signedAt: "2026-11-04T16:00:00Z", policyVersion: DRUG_ALCOHOL_POLICY_VERSION,
    }));
    expect(signed).toContain(NAME);
    const other = await pdfText(await drugAlcoholPolicyPdf(rec.client, ORG, "inv-1", {
      signedName: NAME, signedAt: "2026-11-04T16:00:00Z", policyVersion: "dap-0000000000000000",
    }));
    expect(other).not.toContain(NAME);
    expect(other).toContain("DRIVER SIGNATURE");
  });
});
