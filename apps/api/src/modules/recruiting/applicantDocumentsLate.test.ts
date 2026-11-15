import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { fileApplicantCapture, listApplicantDocuments } from "./applicantDocuments.js";

/**
 * A photograph that arrives after the application is filed (Q-AM19 stage 3; 0609).
 *
 * What must hold: the record marks it as the office's to file, and only it — a photograph on an
 * application not filed yet is still the filing's; filing copies the bytes BEFORE the row is written,
 * and writes nothing when the copy fails; the kind and page come from the slot, never the request; only
 * a paper the list shows can be filed; the database's refusals are said in the office's words.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const FILED = "10000000-0000-4000-8000-00000000000f";
const OPEN = "10000000-0000-4000-8000-00000000000a";

const capture = (id: string, invitation_id: string, slot = "medical_card", over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, driver_id: DRIVER, invitation_id, slot, storage_path: `${ORG}/${invitation_id}/${id}.webp`, content_type: "image/webp",
  captured_at: "2026-11-12T10:00:00Z", promoted_document_id: null, bytes: 2048, sha256: "a".repeat(64), ...over,
});

const seed = (opts: { captures?: unknown[]; copyFails?: boolean; exists?: boolean; rpc?: unknown } = {}) => {
  const order: string[] = [];
  const rec = createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, full_name: "Susan Godfrey" }],
      application_captures: (q: RecordedQuery) => {
        const all = (opts.captures ?? [capture("cap-late", FILED)]) as Array<{ id: string }>;
        const byId = q.ops.find((o) => o.method === "eq" && o.args[0] === "id");
        return byId ? all.filter((c) => c.id === byId.args[1]) : all;
      },
      application_invitations: [{ id: FILED, submitted_at: "2026-11-10T00:00:00Z" }, { id: OPEN, submitted_at: null }],
      documents: [],
      permission_grants: [],
    },
    rpc: (fn: string) => {
      order.push(`rpc:${fn}`);
      if (fn !== "file_application_capture") return [];
      return opts.rpc === undefined ? "cap-late" : opts.rpc;
    },
    storage: {
      createSignedUrls: (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` })), error: null }),
      copy: () => { order.push("copy"); return opts.copyFails ? { data: null, error: { message: "nope" } } : { data: {}, error: null }; },
      list: () => ({ data: opts.exists ? [{ name: "cap-late.webp" }] : [], error: null }),
    },
  });
  return { rec, order };
};

describe("the record's list", () => {
  it("⚠ marks a staged photograph on a FILED application as the office's to file, and no other", async () => {
    const { rec } = seed({ captures: [capture("cap-late", FILED), capture("cap-early", OPEN, "twic")] });
    const list = await listApplicantDocuments(rec.client, ORG, DRIVER, "recruiter");
    if (!Array.isArray(list)) throw new Error("expected a list");
    expect(Object.fromEntries(list.map((d) => [d.id, d.fileable]))).toEqual({ "cap-late": true, "cap-early": false });
    expect(list.every((d) => d.staged)).toBe(true);
    expectOrgScoped(rec, ORG);
  });
});

describe("filing a late photograph", () => {
  it("⚠ copies the bytes first, then files it with the slot's own kind and page", async () => {
    const { rec, order } = seed();
    const r = await fileApplicantCapture(rec.client, ORG, DRIVER, "cap-late");
    expect(r).toEqual({ documentId: "cap-late", kind: "medical_card", contentType: "image/webp" });
    expect(order.filter((o) => o === "copy" || o === "rpc:file_application_capture")).toEqual(["copy", "rpc:file_application_capture"]);
    const call = rec.rpcs().find((c) => c.fn === "file_application_capture")!;
    expect(call.args).toEqual({
      p_org: ORG, p_invitation: FILED, p_driver: DRIVER, p_capture: "cap-late", p_kind: "medical_card", p_page: 1,
      p_storage_path: `${ORG}/driver/${DRIVER}/cap-late.webp`,
    });
    const [copy] = rec.storageCalls().filter((c) => c.fn === "copy");
    expect(copy!.args[0]).toBe(`${ORG}/${FILED}/cap-late.webp`);
    expectOrgScoped(rec, ORG);
  });

  it("⚠ files nothing when the copy failed and the bytes are not there", async () => {
    const { rec } = seed({ copyFails: true });
    const r = await fileApplicantCapture(rec.client, ORG, DRIVER, "cap-late");
    expect(r).toMatchObject({ code: "copy_failed" });
    expect(rec.rpcs().some((c) => c.fn === "file_application_capture")).toBe(false);
  });

  it("carries on when the copy 'failed' because the bytes were already copied — a second press", async () => {
    const { rec } = seed({ copyFails: true, exists: true });
    expect(await fileApplicantCapture(rec.client, ORG, DRIVER, "cap-late")).toMatchObject({ documentId: "cap-late" });
  });

  it("⚠ will not file a selfie or a drawn mark: only a paper the list shows", async () => {
    for (const slot of ["selfie", "signature_mark"]) {
      const { rec } = seed({ captures: [capture("cap-late", FILED, slot)] });
      expect(await fileApplicantCapture(rec.client, ORG, DRIVER, "cap-late")).toMatchObject({ code: "not_found" });
      expect(rec.storageCalls().some((c) => c.fn === "copy")).toBe(false);
    }
  });

  /**
   * The recorder applies no filters, so the scope is read off the query. Without the driver filter another
   * applicant's photograph in the same org would be COPIED into this driver's folder before the database
   * refused to file it — an orphan under the wrong name.
   */
  it("⚠ looks the photograph up by this driver as well as this org, before any byte is copied", async () => {
    const { rec } = seed();
    await fileApplicantCapture(rec.client, ORG, DRIVER, "cap-late");
    const lookup = rec.forTable("application_captures")[0]!;
    expect(lookup.ops.filter((o) => o.method === "eq").map((o) => `${String(o.args[0])}=${String(o.args[1])}`).sort())
      .toEqual([`driver_id=${DRIVER}`, "id=cap-late", `org_id=${ORG}`]);
  });

  it("answers not found for a photograph that is not this applicant's", async () => {
    const { rec } = seed({ captures: [] });
    expect(await fileApplicantCapture(rec.client, ORG, DRIVER, "cap-late")).toMatchObject({ code: "not_found" });
  });

  it("says the database's refusals in the office's words", async () => {
    const refused = async (code: string) =>
      fileApplicantCapture(seed({ rpc: { error: { code, message: "x" } } }).rec.client, ORG, DRIVER, "cap-late");
    expect(await refused("FC002")).toMatchObject({ code: "not_filed_yet", message: expect.stringContaining("filed with it when the applicant signs") });
    expect(await refused("FC001")).toMatchObject({ code: "not_found" });
    expect(await refused("FC003")).toMatchObject({ code: "not_found" });
    expect(await refused("XX000")).toMatchObject({ code: "file_failed" });
  });
});
