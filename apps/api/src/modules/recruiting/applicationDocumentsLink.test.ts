import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENTS_LINK_TTL_DAYS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { loadEnv } from "../../env.js";
import { hashInvitationToken, isIntakeError, resolveDocumentsLink, resolveInvitation } from "./applicationIntake.js";
import { startCapture } from "./applicationCapture.js";
import { unlockDraft } from "./applicationDraft.js";

/**
 * The documents-only link (Q-AM19, 0608).
 *
 * What must hold, and the first is the reason the link has a resolver of its own:
 *  · ⚠ its token opens NOTHING but the photograph routes — the application's resolver, and so every route
 *    that reads a draft, answers the date of birth, signs or marks, refuses it;
 *  · it lives on its own end and not the application's, so it works on a lapsed application;
 *  · a revoked invitation, a passed end and an unknown token are one refusal;
 *  · the office may send it only to an applicant who consented and has not filed; every send is a new
 *    token, stored as a hash, audited without it, and the link reaches the office's screen whether or
 *    not the e-mail went.
 */
const mailer = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true, provider: "resend", status: 200 })) }));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: mailer.fn }));
const { sendDocumentsLink, isDocumentsLinkError, documentsLinkBundle } = await import("./applicationDocumentsLink.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const ACTOR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DOCS = "d".repeat(43);
const INVITE = "i".repeat(43);
const NOW = new Date("2026-11-14T15:00:00Z");
const env = loadEnv({ NODE_ENV: "test", MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", WEB_APP_URL: "https://app.test" } as NodeJS.ProcessEnv);

/** An application whose OWN link lapsed last month, sent a documents link that ends next week. */
const row = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER, email: "susan.godfrey@example.test",
  token_hash: hashInvitationToken(INVITE), sign_token_hash: null, sms_token_hash: null,
  docs_token_hash: hashInvitationToken(DOCS), docs_link_expires_at: "2026-11-21T15:00:00+00:00",
  expires_at: "2026-10-14T00:00:00Z", revoked_at: null, consented_at: "2026-10-01T00:00:00Z",
  application_sent_at: "2026-10-02T00:00:00Z", submitted_at: null, unlock_failures: 0, ...over,
});
const seed = (opts: { inv?: unknown[]; rotated?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: opts.inv ?? [row()],
      organizations: [{ name: "Silvicom Inc" }],
      org_disclosures: [],
      audit_logs: [],
      application_drafts: (_q: RecordedQuery) => [{ payload: { date_of_birth: "1980-04-01" }, furthest_section: null, updated_at: "x", revision: 1 }],
    },
    rpc: () => (opts.rotated === undefined ? true : opts.rotated),
    storage: { createSignedUploadUrl: () => ({ data: { signedUrl: "https://storage.test/u", token: "t", path: "p" }, error: null }) },
  });

beforeEach(() => {
  mailer.fn.mockClear();
  mailer.fn.mockResolvedValue({ ok: true, provider: "resend", status: 200 });
});

describe("what the documents token opens", () => {
  it("resolves on its own end, though the application's own link lapsed a month ago", async () => {
    const r = await resolveDocumentsLink(seed().client, DOCS, NOW);
    expect(isIntakeError(r)).toBe(false);
    expect(r).toMatchObject({ id: INV, door: "documents" });
  });

  it("⚠ is refused by the application's resolver — so by every route that reads, signs or marks", async () => {
    const r = await resolveInvitation(seed({ inv: [row({ expires_at: "2099-01-01T00:00:00Z" })] }).client, DOCS, NOW);
    expect(isIntakeError(r) && r.code).toBe("invalid_link");
  });

  it("⚠ cannot answer the date-of-birth question: the draft stays shut to it", async () => {
    const r = await unlockDraft(seed({ inv: [row({ expires_at: "2099-01-01T00:00:00Z" })] }).client, DOCS, "1980-04-01", NOW);
    expect(isIntakeError(r) && r.code).toBe("invalid_link");
  });

  it("⚠ does not let the application's own token in through the documents door", async () => {
    const r = await resolveDocumentsLink(seed().client, INVITE, NOW);
    expect(isIntakeError(r) && r.code).toBe("invalid_link");
  });

  it("⚠ is one refusal for a passed end (to the second), a revoked invitation and a link never sent", async () => {
    for (const over of [
      { docs_link_expires_at: "2026-11-14T15:00:00+00:00" },
      { revoked_at: "2026-11-01T00:00:00Z" },
      { docs_token_hash: null, docs_link_expires_at: null },
    ]) {
      const r = await resolveDocumentsLink(seed({ inv: [row(over)] }).client, DOCS, NOW);
      expect(isIntakeError(r) && r.code).toBe("invalid_link");
    }
    const none = await resolveDocumentsLink(seed({ inv: [] }).client, DOCS, NOW);
    expect(isIntakeError(none) && none.code).toBe("invalid_link");
  });

  it("⚠ takes a photograph, under this application's own prefix", async () => {
    const rec = seed();
    const r = await startCapture(rec.client, DOCS, { slot: "medical_card", content_type: "image/webp" }, NOW);
    if (!("captureId" in r)) throw new Error(`expected an upload URL, got ${JSON.stringify(r)}`);
    expect(r.storagePath).toBe(`${ORG}/${INV}/${r.captureId}.webp`);
  });

  it("keeps the photograph's refusal without the consent", async () => {
    const unconsented = await startCapture(seed({ inv: [row({ consented_at: null })] }).client, DOCS, { slot: "medical_card", content_type: "image/webp" }, NOW);
    expect(unconsented).toMatchObject({ code: "esign_consent_required" });
  });

  /** Stage 3 (0609): the office files a late photograph, so this link — and only it — takes one. */
  it("⚠ takes a photograph AFTER the application is filed, which the application's own link still refuses", async () => {
    const filed = row({ submitted_at: "2026-11-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" });
    const onDocuments = await startCapture(seed({ inv: [filed] }).client, DOCS, { slot: "medical_card", content_type: "image/webp" }, NOW);
    expect("captureId" in onDocuments).toBe(true);
    const onApplication = await startCapture(seed({ inv: [filed] }).client, INVITE, { slot: "medical_card", content_type: "image/webp" }, NOW);
    expect(onApplication).toMatchObject({ code: "already_submitted" });
  });
});

describe("the office sends one", () => {
  const audits = (rec: ReturnType<typeof seed>) =>
    rec.writes().filter((w) => w.table === "audit_logs").map((w) => w.write?.payload as Record<string, unknown>);

  it("mints a new token, stores only its hash with its own end, mails the link, and audits without it", async () => {
    const rec = seed();
    const r = await sendDocumentsLink(rec.client, env, ORG, INV, { actorId: ACTOR }, NOW);
    if (isDocumentsLinkError(r)) throw new Error(r.code);
    const token = r.link.replace("https://app.test/apply/", "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt).toBe(new Date(NOW.getTime() + DOCUMENTS_LINK_TTL_DAYS * 86_400_000).toISOString());

    const [rpc] = rec.rpcs();
    expect(rpc).toEqual({ fn: "rotate_invitation_docs_token", args: {
      p_org: ORG, p_invitation: INV, p_token_hash: hashInvitationToken(token), p_expires_at: r.expiresAt,
    } });
    const audit = audits(rec).find((a) => a.action === "compliance.documents_link_sent")!;
    expect(audit.meta).toEqual({ driverId: DRIVER, expiresAt: r.expiresAt });
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(rec.rpcs())).not.toContain(token);

    const mail = (mailer.fn.mock.calls[0] as unknown as [unknown, { to: string[]; text: string; subject: string }])[1];
    expect(mail.to).toEqual(["susan.godfrey@example.test"]);
    expect(mail.subject).toBe("Silvicom Inc needs photos of your documents");
    expect(mail.text).toContain(r.link);
    expect(r.delivery.sent).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("is a different link every time", async () => {
    const a = await sendDocumentsLink(seed().client, env, ORG, INV, { actorId: ACTOR }, NOW);
    const b = await sendDocumentsLink(seed().client, env, ORG, INV, { actorId: ACTOR }, NOW);
    if (isDocumentsLinkError(a) || isDocumentsLinkError(b)) throw new Error("refused");
    expect(a.link).not.toBe(b.link);
  });

  it("is sent on a LAPSED application — the case it exists for", async () => {
    expect(isDocumentsLinkError(await sendDocumentsLink(seed().client, env, ORG, INV, { actorId: ACTOR }, NOW))).toBe(false);
  });

  it("is sent on a FILED application too: the office files what arrives (stage 3)", async () => {
    const r = await sendDocumentsLink(seed({ inv: [row({ submitted_at: "2026-11-01T00:00:00Z" })] }).client, env, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isDocumentsLinkError(r)).toBe(false);
  });

  it("⚠ refuses before the applicant consented, and on a revoked invitation — minting nothing", async () => {
    for (const [over, code] of [
      [{ consented_at: null }, "not_consented"], [{ revoked_at: "2026-11-01T00:00:00Z" }, "invitation_revoked"],
    ] as const) {
      const rec = seed({ inv: [row(over)] });
      const r = await sendDocumentsLink(rec.client, env, ORG, INV, { actorId: ACTOR }, NOW);
      expect(isDocumentsLinkError(r) && r.code).toBe(code);
      expect(rec.rpcs()).toEqual([]);
      expect(mailer.fn).not.toHaveBeenCalled();
    }
  });

  it("⚠ says the application changed, mails nothing and audits nothing, when the database wrote no link", async () => {
    const rec = seed({ rotated: false });
    const r = await sendDocumentsLink(rec.client, env, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isDocumentsLinkError(r) && r.code).toBe("link_changed");
    expect(mailer.fn).not.toHaveBeenCalled();
    expect(audits(rec)).toHaveLength(0);
  });

  it("still hands the office the link when there is no address to mail it to", async () => {
    const r = await sendDocumentsLink(seed({ inv: [row({ email: null })] }).client, env, ORG, INV, { actorId: ACTOR }, NOW);
    if (isDocumentsLinkError(r)) throw new Error(r.code);
    expect(r.link).toMatch(/^https:\/\/app\.test\/apply\//);
    expect(r.delivery.sent).toBe(false);
  });

  it("answers not found for another carrier's application", async () => {
    const r = await sendDocumentsLink(seed({ inv: [] }).client, env, ORG, INV, { actorId: ACTOR }, NOW);
    expect(isDocumentsLinkError(r) && r.code).toBe("application_not_found");
  });
});

describe("what the documents link's page is served", () => {
  it("⚠ the carrier, the list and what is photographed — and nothing of the application", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        organizations: [{ name: "Silvicom Inc" }],
        recruiting_settings: [],
        application_captures: [{ id: "c1", slot: "cdl_front", ordinal: 0, storage_path: "p", content_type: "image/webp", bytes: 10, sha256: "x", captured_at: "2026-11-10T00:00:00Z" }],
      },
    });
    const body = await documentsLinkBundle(rec.client, { id: INV, org_id: ORG, docs_link_expires_at: "2026-11-21T15:00:00+00:00" }, "local-key");
    expect(Object.keys(body).sort()).toEqual(["captures", "carrier", "documentsOnly", "expiresAt", "localKey", "offeredDocumentSlots"]);
    expect(body).toMatchObject({ documentsOnly: true, carrier: "Silvicom Inc", expiresAt: "2026-11-21T15:00:00+00:00", localKey: "local-key" });
    expect(body.captures).toEqual([{ slot: "cdl_front", ordinal: 0, contentType: "image/webp", bytes: 10, capturedAt: "2026-11-10T00:00:00Z" }]);
    expect(body.offeredDocumentSlots.length).toBeGreaterThan(0);
    expectOrgScoped(rec, ORG);
  });
});

