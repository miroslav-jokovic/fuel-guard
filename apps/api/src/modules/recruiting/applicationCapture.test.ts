import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken } from "./applicationIntake.js";
import {
  confirmCapture,
  listCaptures,
  promoteCaptures,
  startCapture,
} from "./applicationCapture.js";

/**
 * Staged captures (A8, D-APP10).
 *
 * The property this file exists for is one sentence: **a row exists only when the bytes do.** Every
 * other pipeline in this product registers the row first, because for evidence the claim that a
 * document exists must outlive a dropped connection. Staging is the mirror image — a slot the driver
 * is told is filled must be filled — and the tests below are that inversion, stated three times: the
 * start call writes nothing, a confirm without an object is refused, and promotion copies before it
 * files.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITATION = "11111111-2222-4333-8444-555555555555";
const TOKEN = "c".repeat(43);
const NOW = new Date("2026-08-21T12:00:00Z");
const SHA = "a1".repeat(32);

function seed(
  over: Record<string, unknown> = {},
  storage: Record<string, (...args: never[]) => unknown> = {},
): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: INVITATION, org_id: ORG, driver_id: DRIVER,
        token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
        // ⚠ Consented, since D-WORD1 (2026-09-14). The shipped catalogue is no longer draft, so
        // §390.32(d)'s gate is armed on every link and refuses every write before the consent
        // exists. An unconsented fixture now models a driver who has not started.
        consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, submitted_at: null,
        ...over,
      }],
      application_captures: [],
    },
    rpc: { stage_application_capture: { capture_id: "cap-1", captured_at: NOW.toISOString(), replaced_path: null } },
    storage: {
      createSignedUploadUrl: (path: string) => ({
        data: { signedUrl: `https://storage.test/upload?token=t`, token: "t", path },
        error: null,
      }),
      ...storage,
    },
  });
}

describe("asking for somewhere to put a photograph", () => {
  it("writes nothing at all — the row belongs after the bytes, not before", async () => {
    const rec = seed();
    const result = await startCapture(
      rec.client, TOKEN, { slot: "cdl_front", content_type: "image/webp" }, NOW,
    );
    expect("captureId" in result).toBe(true);
    // The whole point of the ordering: a browser that never completes the PUT has changed nothing.
    expect(rec.writes()).toEqual([]);
    expect(rec.rpcs()).toEqual([]);
  });

  it("signs a key under this session's own prefix, minted server-side", async () => {
    const rec = seed();
    const result = await startCapture(
      rec.client, TOKEN, { slot: "cdl_front", content_type: "image/webp" }, NOW,
    );
    if (!("captureId" in result)) throw new Error("expected an upload URL");
    // org / invitation / capture — never the driver, and never anything the request named.
    expect(result.storagePath).toBe(`${ORG}/${INVITATION}/${result.captureId}.webp`);
    const [call] = rec.storageCalls();
    expect(call?.bucket).toBe("application-captures");
    expect(call?.fn).toBe("createSignedUploadUrl");
  });

  it("refuses before the 7001(c) consent, like every other write on this link", async () => {
    // ⚠ No version spy any more. A4's gate used to need one, because the catalogue was draft and a
    // draft consent cannot gate anything; since D-WORD1 the shipped wording is final and the gate
    // is simply live, so the only thing this test has to arrange is a driver who has not consented.
    const rec = seed({ consented_at: null });
    const result = await startCapture(
      rec.client, TOKEN, { slot: "cdl_front", content_type: "image/webp" }, NOW,
    );
    expect(result).toMatchObject({ code: "esign_consent_required" });
    expect(rec.storageCalls()).toEqual([]);
  });

  it("refuses once the application is certified — nothing would ever promote it", async () => {
    const rec = seed({ submitted_at: "2026-08-21T10:00:00Z" });
    const result = await startCapture(
      rec.client, TOKEN, { slot: "cdl_front", content_type: "image/webp" }, NOW,
    );
    expect(result).toMatchObject({ code: "already_submitted" });
  });
});

describe("a filed application's handbook adopting its own signature (A-1, C0b — a workaround C3s removes)", () => {
  // `d61557dc`'s shape: filed, handbook opened, nothing signed on the packet, no picture staged.
  const FILED = { submitted_at: "2026-09-14T10:00:00Z", handbook_signing_opened_at: "2026-09-25T20:08:00Z", handbook_filed_at: null };
  const SIGNATURE = { slot: "signature_mark" as const, content_type: "image/png" as const };

  const selfAdoptSeed = (over: { inv?: Record<string, unknown>; packetMarks?: number; handbookNames?: string[]; pictureAt?: string | null } = {}) => {
    const rec = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: INVITATION, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-14T08:00:00Z",
          releases_completed_at: "2026-09-14T08:30:00Z", ...FILED, ...over.inv,
        }],
        application_packet_marks: Array.from({ length: over.packetMarks ?? 0 }, (_, i) => ({ id: `m-${i}` })),
        handbook_marks: (over.handbookNames ?? []).map((signed_name) => ({ signed_name })),
        application_captures: over.pictureAt ? [{ captured_at: over.pictureAt }] : [],
      },
      storage: { createSignedUploadUrl: () => ({ data: { signedUrl: "u", token: "t" }, error: null }) },
    });
    return rec;
  };

  it("lets the signature picture through after filing, in exactly that state", async () => {
    const rec = selfAdoptSeed();
    const result = await startCapture(rec.client, TOKEN, SIGNATURE, NOW);
    expect("captureId" in result).toBe(true);
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations", "organizations"] });
  });

  it("still refuses every other slot after filing", async () => {
    const result = await startCapture(selfAdoptSeed().client, TOKEN, { slot: "cdl_front", content_type: "image/webp" }, NOW);
    expect(result).toMatchObject({ code: "already_submitted" });
  });

  it("refuses once the packet holds a mark — that handbook borrows the packet's signature", async () => {
    const result = await startCapture(selfAdoptSeed({ packetMarks: 1 }).client, TOKEN, SIGNATURE, NOW);
    expect(result).toMatchObject({ code: "already_submitted" });
  });

  it("refuses before the office opens the handbook, and after it is filed", async () => {
    const closed = await startCapture(selfAdoptSeed({ inv: { handbook_signing_opened_at: null } }).client, TOKEN, SIGNATURE, NOW);
    expect(closed).toMatchObject({ code: "already_submitted" });
    const filed = await startCapture(selfAdoptSeed({ inv: { handbook_filed_at: "2026-09-26T10:00:00Z" } }).client, TOKEN, SIGNATURE, NOW);
    expect(filed).toMatchObject({ code: "already_submitted" });
  });

  it("freezes the picture once the first handbook place is signed with it", async () => {
    const result = await startCapture(selfAdoptSeed({ handbookNames: ["Dana Driver"], pictureAt: "2026-09-26T11:00:00Z" }).client, TOKEN, SIGNATURE, NOW);
    expect(result).toMatchObject({ code: "already_submitted" });
  });

  it("never replaces a picture the permissions ceremony staged before filing (G-13), but lets this screen redo its own", async () => {
    const before = await startCapture(selfAdoptSeed({ pictureAt: "2026-09-13T09:00:00Z" }).client, TOKEN, SIGNATURE, NOW);
    expect(before).toMatchObject({ code: "already_submitted" });
    const own = await startCapture(selfAdoptSeed({ pictureAt: "2026-09-26T11:00:00Z" }).client, TOKEN, SIGNATURE, NOW);
    expect("captureId" in own).toBe(true);
  });
});

describe("confirming that the bytes landed", () => {
  const CAPTURE = "99999999-8888-4777-8666-555555555555";
  const BODY = { slot: "cdl_front" as const, content_type: "image/webp" as const };
  /** A real photograph-sized WebP — the confirm decodes and measures it, so nothing here is faked. */
  let photo: Buffer;
  let photoSha: string;
  beforeAll(async () => {
    const px = Buffer.alloc(320 * 200 * 3);
    for (let i = 0; i < px.length; i++) px[i] = (i * 37) % 251;
    photo = await sharp(px, { raw: { width: 320, height: 200, channels: 3 } }).webp({ quality: 80 }).toBuffer();
    photoSha = createHash("sha256").update(photo).digest("hex");
  });
  const inBucket = (bytes: Buffer) => ({ download: () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }) });
  const confirmRpc = (rec: SupabaseRecorder) => rec.rpcs().find((r) => r.fn === "confirm_application_capture");

  it("refuses a confirm for an object that is not in the bucket, and stages nothing", async () => {
    const rec = seed({}, { download: () => ({ data: null, error: { message: "Object not found" } }) });
    const result = await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: SHA }, NOW);
    expect(result).toMatchObject({ code: "capture_upload_failed" });
    expect(rec.rpcs()).toEqual([]);
  });

  it("reads the object at the key it recomputed — never a path the request named", async () => {
    const rec = seed({}, inBucket(photo));
    await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: photoSha }, NOW);
    const read = rec.storageCalls().find((c) => c.fn === "download");
    expect(read).toMatchObject({ bucket: "application-captures", args: [`${ORG}/${INVITATION}/${CAPTURE}.webp`] });
  });

  it("stages the size of the bytes it read, not a number the request supplied", async () => {
    const rec = seed({}, inBucket(photo));
    const result = await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: photoSha }, NOW);
    expect(result).toMatchObject({ slot: "cdl_front" });
    const [rpc] = rec.rpcs();
    expect(rpc?.fn).toBe("stage_application_capture");
    expect(rpc?.args).toMatchObject({
      p_org: ORG,
      p_invitation: INVITATION,
      p_driver: DRIVER,
      p_capture: CAPTURE,
      p_slot: "cdl_front",
      // Recomputed from the resolved token — the request never names a path.
      p_path: `${ORG}/${INVITATION}/${CAPTURE}.webp`,
      p_bytes: photo.byteLength,
      p_sha256: photoSha,
    });
  });

  it("records the server's own hash and measurements on the row it staged (D-AW9)", async () => {
    const rec = seed({}, inBucket(photo));
    await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: photoSha.toUpperCase() }, NOW);
    expect(rec.rpcs().map((r) => r.fn)).toEqual(["stage_application_capture", "confirm_application_capture"]);
    const args = confirmRpc(rec)?.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INVITATION, p_capture: CAPTURE, p_server_sha256: photoSha, p_bytes: photo.byteLength });
    // The measurement of the photo itself, at the capture config's analysis scale (320 px wide ≤ 1024).
    expect(args.p_metrics).toMatchObject({ longEdgePx: 320, analysisLongEdgePx: 320, configVersion: "capture-2026.08.0" });
    expect((args.p_metrics as { blurVariance: number }).blurVariance).toBeGreaterThan(0);
  });

  it("refuses bytes that are not the ones the browser sent, stages nothing, and clears them out", async () => {
    const rec = seed({}, { ...inBucket(photo), remove: () => ({ data: [], error: null }) });
    const result = await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: SHA }, NOW);
    expect(result).toMatchObject({ code: "capture_not_intact" });
    expect(rec.rpcs()).toEqual([]);
    expect(rec.storageCalls().filter((c) => c.fn === "remove")[0]?.args[0]).toEqual([`${ORG}/${INVITATION}/${CAPTURE}.webp`]);
  });

  it("refuses an object that is not a picture, whatever its hash", async () => {
    const junk = Buffer.from("this is not an image at all");
    const rec = seed({}, { ...inBucket(junk), remove: () => ({ data: [], error: null }) });
    const result = await confirmCapture(
      rec.client, TOKEN, CAPTURE, { ...BODY, sha256: createHash("sha256").update(junk).digest("hex") }, NOW,
    );
    expect(result).toMatchObject({ code: "capture_not_intact" });
    expect(rec.rpcs()).toEqual([]);
  });

  it("checks a drawn mark's bytes but does not measure it — a signature has no focus or glare", async () => {
    const mark = await sharp({ create: { width: 60, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const rec = seed({}, inBucket(mark));
    await confirmCapture(
      rec.client, TOKEN, CAPTURE,
      { slot: "signature_mark", content_type: "image/png", sha256: createHash("sha256").update(mark).digest("hex") }, NOW,
    );
    expect(confirmRpc(rec)?.args).toMatchObject({ p_metrics: null, p_bytes: mark.byteLength });
  });

  it("keeps a staged photo when only the record of its check fails — the bytes were checked", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: INVITATION, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, submitted_at: null,
        }],
      },
      rpc: {
        stage_application_capture: { capture_id: CAPTURE, captured_at: NOW.toISOString(), replaced_path: null },
        confirm_application_capture: { error: { message: "DA042" } },
      },
      storage: inBucket(photo),
    });
    const result = await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: photoSha }, NOW);
    expect(result).toMatchObject({ slot: "cdl_front" });
  });

  it("collects the photograph it replaced, so a re-shoot does not leave its predecessor behind", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: INVITATION, org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, submitted_at: null,
        }],
      },
      rpc: {
        stage_application_capture: {
          capture_id: CAPTURE, captured_at: NOW.toISOString(),
          replaced_path: `${ORG}/${INVITATION}/old.jpg`,
        },
      },
      storage: {
        createSignedUploadUrl: () => ({ data: { signedUrl: "u", token: "t" }, error: null }),
        ...inBucket(photo),
        remove: () => ({ data: [], error: null }),
      },
    });
    await confirmCapture(rec.client, TOKEN, CAPTURE, { ...BODY, sha256: photoSha }, NOW);
    const removals = rec.storageCalls().filter((c) => c.fn === "remove");
    expect(removals).toHaveLength(1);
    expect(removals[0]?.args[0]).toEqual([`${ORG}/${INVITATION}/old.jpg`]);
  });
});

describe("promoting a staged set into the qualification file", () => {
  const CAP_A = "aaaaaaaa-1111-4111-8111-111111111111";
  const CAP_B = "bbbbbbbb-2222-4222-8222-222222222222";

  const staged = (storage: Record<string, (...args: never[]) => unknown> = {}): SupabaseRecorder =>
    createSupabaseRecorder({
      tables: {
        application_captures: [
          { id: CAP_A, slot: "cdl_front", storage_path: `${ORG}/${INVITATION}/${CAP_A}.webp`, content_type: "image/webp", bytes: 1, sha256: SHA, captured_at: NOW.toISOString() },
          { id: CAP_B, slot: "cdl_back", storage_path: `${ORG}/${INVITATION}/${CAP_B}.webp`, content_type: "image/webp", bytes: 1, sha256: SHA, captured_at: NOW.toISOString() },
        ],
      },
      storage: { copy: () => ({ data: { path: "x" }, error: null }), ...storage },
    });

  it("copies each object into the evidence bucket and files it under the capture's own id", async () => {
    const rec = staged();
    const result = await promoteCaptures(rec.client, ORG, INVITATION, DRIVER);
    if ("code" in result) throw new Error("expected a promotion");
    // Two sides of one licence: one kind, two pages — so the pair stays ordered in the file.
    expect(result).toEqual([
      { capture_id: CAP_A, kind: "cdl", page: 1, storage_path: `${ORG}/driver/${DRIVER}/${CAP_A}.webp` },
      { capture_id: CAP_B, kind: "cdl", page: 2, storage_path: `${ORG}/driver/${DRIVER}/${CAP_B}.webp` },
    ]);
    const copies = rec.storageCalls().filter((c) => c.fn === "copy");
    expect(copies).toHaveLength(2);
    expect(copies[0]?.bucket).toBe("application-captures");
    expect(copies[0]?.args[2]).toEqual({ destinationBucket: "compliance-docs" });
    expectOrgScoped(rec, ORG);
  });

  /**
   * The one thing a derivative may do and a photograph may not. `ensureApplicationPdf` swallows its
   * failures because the PDF can be drawn again from evidence that never moved; the only copy of a
   * driver's licence photograph is in a staging bucket A11 will prune, so filing the application
   * without it would put the document beyond reach of the file it belongs to, silently.
   */
  it("refuses the submission when a copy fails and the destination is not there either", async () => {
    const rec = staged({
      copy: () => ({ data: null, error: { message: "boom" } }),
      list: () => ({ data: [], error: null }),
    });
    const result = await promoteCaptures(rec.client, ORG, INVITATION, DRIVER);
    expect(result).toMatchObject({ code: "capture_promotion_failed" });
  });

  /** A retried submission copies onto a key that already exists — success wearing an error's clothes. */
  it("treats an already-copied object as copied, so pressing send twice works", async () => {
    const rec = staged({
      copy: () => ({ data: null, error: { message: "The resource already exists" } }),
      list: (dir: string) => ({ data: [{ name: `${CAP_A}.webp` }, { name: `${CAP_B}.webp` }], error: null, dir }),
    });
    const result = await promoteCaptures(rec.client, ORG, INVITATION, DRIVER);
    expect("code" in result).toBe(false);
    expect((result as unknown[]).length).toBe(2);
  });

  it("promotes nothing when nothing was staged", async () => {
    const rec = createSupabaseRecorder({ tables: { application_captures: [] } });
    expect(await promoteCaptures(rec.client, ORG, INVITATION, DRIVER)).toEqual([]);
  });
});

describe("what the page is told", () => {
  it("lists slots and dates, and no way to fetch the photograph back", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        application_captures: [{
          id: "cap-1", slot: "medical_card", storage_path: "p", content_type: "image/webp",
          bytes: 2048, sha256: SHA, captured_at: NOW.toISOString(),
        }],
      },
    });
    const views = await listCaptures(rec.client, ORG, INVITATION);
    expect(views).toEqual([
      { slot: "medical_card", contentType: "image/webp", bytes: 2048, capturedAt: NOW.toISOString() },
    ]);
    // No signed read URL is minted on an unauthenticated surface for a picture the driver just took.
    expect(rec.storageCalls()).toEqual([]);
    expectOrgScoped(rec, ORG);
  });
});
