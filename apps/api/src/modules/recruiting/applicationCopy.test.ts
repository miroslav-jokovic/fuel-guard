import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken } from "./applicationIntake.js";
import { APPLICANT_COPY_TTL_SEC, applicantCopy } from "./applicationCopy.js";

/**
 * The applicant's own copy (X8, D-AX9).
 *
 * ⚠ What is worth pinning here is not that a URL comes back. It is the three bounds on a route that
 * serves an evidence document to somebody with no account: it answers only after submission, the
 * link is short-lived, and the read is recorded. A public route that quietly loses any one of those
 * is the kind of change that looks identical in a diff.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const APP_ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "t".repeat(43);
const NOW = new Date("2026-09-11T12:00:00Z");

const invitationRow = (over: Record<string, unknown> = {}) => ({
  id: INVITATION,
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2099-01-01T00:00:00Z",
  revoked_at: null,
  consented_at: "2026-09-01T09:00:00Z",
  releases_completed_at: "2026-09-01T09:10:00Z",
  submitted_at: "2026-09-02T10:00:00Z",
  ...over,
});

const seed = (over: { invitation?: Record<string, unknown> | null; application?: Record<string, unknown> | null } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [over.invitation ?? invitationRow()],
      driver_applications: over.application === null ? [] : [over.application ?? { id: APP_ID }],
      // Already filed: `ensureApplicationPdf` finds the citation and hands the document back rather
      // than rendering, which is the path a second download takes.
      qualification_records: [{ document_id: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb" }],
      documents: [{ id: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb", storage_path: `${ORG}/driver/${DRIVER}/doc.pdf` }],
      audit_logs: [],
    },
    storage: {
      createSignedUrl: async (path: string) => ({
        data: { signedUrl: `https://storage.test/signed/${path}?token=abc` },
        error: null,
      }),
    },
  });

describe("handing the applicant their own copy", () => {
  it("signs a short-lived URL for the document that was filed", async () => {
    const rec = seed();
    const result = await applicantCopy(rec.client, TOKEN, NOW);

    expect("url" in result && result.url).toContain("https://storage.test/signed/");
    expect("expiresInSeconds" in result && result.expiresInSeconds).toBe(APPLICANT_COPY_TTL_SEC);
    // Five minutes, matching `compliance.ts` — long enough to start a download on a truck-stop
    // connection, short enough that a URL left in a browser history is already dead.
    expect(APPLICANT_COPY_TTL_SEC).toBe(300);
  });

  it("asks Storage for a TTL and a download name, not for a permanent link", async () => {
    const rec = seed();
    await applicantCopy(rec.client, TOKEN, NOW);

    const call = rec.storageCalls().find((c) => c.fn === "createSignedUrl");
    expect(call?.args[1]).toBe(APPLICANT_COPY_TTL_SEC);
    expect(call?.args[2]).toEqual({ download: "driver-application.pdf" });
  });

  it("never lets the bytes through this API", async () => {
    // The idiom every other evidence document follows: Storage to the phone, one fewer place for a
    // PDF of somebody's employment history to be logged, buffered or cached.
    const rec = seed();
    await applicantCopy(rec.client, TOKEN, NOW);
    expect(rec.storageCalls().some((c) => c.fn === "download")).toBe(false);
  });

  it("records the read, because an unauthenticated read of an evidence document is an event", async () => {
    const rec = seed();
    await applicantCopy(rec.client, TOKEN, NOW);

    const audit = rec.writtenRows("audit_logs");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("application_copy_downloaded");
    expect(audit[0]!.org_id).toBe(ORG);
    // A uuid, or `writeAudit` moves it to meta and the row loses its subject — the 5.11 defect.
    expect(audit[0]!.entity_id).toBe(APP_ID);
  });

  it("refuses before the application has been sent, and says so as 'not yet'", async () => {
    const rec = seed({ invitation: invitationRow({ submitted_at: null }) });
    const result = await applicantCopy(rec.client, TOKEN, NOW);

    expect("code" in result && result.code).toBe("not_submitted");
    // The link is perfectly valid; the answer is "not yet". Saying "invalid" would send the driver
    // back to a recruiter for a replacement that would not help.
    expect("message" in result && result.message).toMatch(/once you have sent/);
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("gives a dead link the same answer every other route gives it", async () => {
    for (const invitation of [
      null,
      invitationRow({ revoked_at: "2026-09-03T00:00:00Z" }),
      invitationRow({ expires_at: "2020-01-01T00:00:00Z" }),
    ]) {
      const rec = seed({ invitation });
      const result = await applicantCopy(rec.client, TOKEN, NOW);
      expect("code" in result && result.code).toBe("invalid_link");
      expect(rec.storageCalls()).toHaveLength(0);
    }
  });

  it("signs nothing for a token that is not this invitation's", async () => {
    const rec = seed();
    const result = await applicantCopy(rec.client, "x".repeat(43), NOW);
    expect("code" in result && result.code).toBe("invalid_link");
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("says 'not just now' when the invariant is broken, not 'your link is invalid'", async () => {
    // Submitted, and no application answers to the invitation. The driver did not cause that and
    // cannot fix it with a new link.
    const rec = seed({ application: null });
    const result = await applicantCopy(rec.client, TOKEN, NOW);
    expect("code" in result && result.code).toBe("document_unavailable");
  });

  it("scopes every read to the invitation's own org", async () => {
    /**
     * The service role bypasses RLS, so the `.eq("org_id", …)` on each query is the only thing
     * standing between two carriers — which is why `apps/api/CLAUDE.md` names this exact helper
     * rather than leaving each test to invent its own check.
     *
     * ⚠ The first version of this test DID invent its own, and it was worthless: it pulled every
     * `eq` out of every query against `driver_applications` and looked for an `org_id` among them,
     * so it went on passing when this module's own filter was deleted — `ensureApplicationPdf`
     * queries the same table and its filter answered for both. Removing the filter is caught now;
     * it was not before.
     *
     * `application_invitations` is exempt and has to be: `resolveInvitation` finds a row BY ITS
     * TOKEN HASH, which is the only credential the caller has. There is no org to scope by until
     * that row comes back — the lookup is what discovers it.
     */
    const rec = seed();
    await applicantCopy(rec.client, TOKEN, NOW);
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });
});
