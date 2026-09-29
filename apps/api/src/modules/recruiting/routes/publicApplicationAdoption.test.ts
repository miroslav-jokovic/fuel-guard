import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * Screen 13 through its HTTP door, and the permissions signed with what it adopted (D-AW15, C3s1).
 *
 * Every fixture carries ANOTHER org's adoption on the same invitation id, so a read that forgot its org
 * filter would find a stranger's signature — and sign a permission with it.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";
const TOKEN = "c".repeat(43);

const PNG = await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .png()
  .toBuffer();
const JPEG = await sharp({ create: { width: 12, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } })
  .jpeg()
  .toBuffer();

const adoption = (org: string, kind: string, over: FixtureRow = {}): FixtureRow => ({
  id: `adopt-${kind}-${org}`, org_id: org, invitation_id: INVITE, kind,
  typed_text: org === ORG ? "Susan Godfrey" : "Somebody Else",
  storage_path: `${org}/driver/${DRIVER}/adopt-${kind}-${org}.png`,
  adopted_at: "2026-09-28T10:00:00Z", superseded_by: null, ...over,
});
const STRANGER = [adoption(OTHER, "signature"), adoption(OTHER, "initials")];

const seed = (over: {
  invitation?: FixtureRow;
  adoptions?: FixtureRow[];
  authorizations?: FixtureRow[];
  intakes?: FixtureRow[];
  rpc?: Record<string, unknown>;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: postgrestFixture([{
        id: INVITE, org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-28T09:00:00Z",
        intake_completed_at: null, releases_completed_at: null, submitted_at: null,
        ...over.invitation,
      }]),
      organizations: [{ name: "Silvicom Inc" }],
      signature_adoptions: postgrestFixture([...(over.adoptions ?? []), ...STRANGER]),
      driver_authorizations: postgrestFixture(over.authorizations ?? []),
      application_packet_marks: postgrestFixture([]),
      handbook_marks: postgrestFixture([]),
      application_intakes: postgrestFixture(over.intakes ?? []),
      // Identity on file, as `recordRelease` requires before any permission (AF3).
      drivers: [{ date_of_birth: "1980-04-01", cdl_number: "PA334554", cdl_state: "PA" }],
      application_drafts: [{ payload: { date_of_birth: "1980-04-01", cdl_number: "PA334554", cdl_state: "PA" } }],
    },
    rpc: {
      record_signature_adoption: { adoption_id: "x", superseded_id: null },
      record_driver_release: { authorization_id: "auth-1", signed_count: 1, completed: false },
      ...over.rpc,
    },
  });

let server: Server;
let baseUrl: string;
let seq = 0;
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application/${TOKEN}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(seq++ % 250) + 1}`, ...(init.headers ?? {}) },
  });
const adopt = (body: Record<string, unknown>) => call("/adoption", { method: "POST", body: JSON.stringify(body) });
const release = (signedName: string) =>
  call("/release", { method: "POST", body: JSON.stringify({ purpose: "psp", signed_name: signedName, esign_consent: true }) });
/** The token lookup is what FINDS the org — by hash, before there is an org to filter on. */
const scoped = (rec: SupabaseRecorder) => expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => closeTestServer(server));

describe("POST /:token/adoption", () => {
  it("stores the picture under the driver's evidence key, then registers it with the server's own hash", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await adopt({ kind: "signature", typed_text: "  Susan Godfrey ", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, adopted: "signature", superseded: false });

    const upload = rec.storageCalls().find((c) => c.fn === "upload")!;
    expect(upload.bucket).toBe("compliance-docs");
    const path = String(upload.args[0]);
    expect(path).toMatch(new RegExp(`^${ORG}/driver/${DRIVER}/[0-9a-f-]{36}\\.png$`));
    expect(Buffer.compare(upload.args[1] as Buffer, PNG)).toBe(0);
    expect(upload.args[2]).toMatchObject({ contentType: "image/png", upsert: false });

    const [rpc] = rec.rpcs();
    expect(rpc).toEqual({
      fn: "record_signature_adoption",
      args: {
        p_org: ORG, p_invitation: INVITE, p_adoption: path.split("/").at(-1)!.replace(".png", ""),
        p_kind: "signature", p_typed_text: "Susan Godfrey", p_storage_path: path,
        p_sha256: createHash("sha256").update(PNG).digest("hex"),
        p_ip: expect.any(String), p_user_agent: expect.any(String),
      },
    });
    scoped(rec);
  });

  it("refuses a picture that is not a PNG, and stores nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    for (const bytes of [JPEG, Buffer.from("not an image at all")]) {
      const res = await adopt({ kind: "initials", typed_text: "SG", png_base64: bytes.toString("base64") });
      expect(res.status).toBe(422);
      expect(await code(res)).toBe("adoption_not_png");
    }
    expect(rec.storageCalls()).toEqual([]);
    expect(rec.rpcs()).toEqual([]);
  });

  it("lets the driver adopt again while nothing has been signed with it", async () => {
    const rec = seed({ adoptions: [adoption(ORG, "signature")] });
    holder.client = rec.client;
    const res = await adopt({ kind: "signature", typed_text: "Susan M Godfrey", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(201);
  });

  it("refuses a new signature once a permission was signed with the live one — and looks only at this org's", async () => {
    const rec = seed({
      adoptions: [adoption(ORG, "signature")],
      authorizations: [{ id: "a1", org_id: ORG, adoption_id: `adopt-signature-${ORG}` }],
    });
    holder.client = rec.client;
    const res = await adopt({ kind: "signature", typed_text: "Susan M Godfrey", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("adoption_in_use");
    expect(rec.storageCalls()).toEqual([]);
    scoped(rec);

    // The same use, recorded against ANOTHER org's row, locks nothing here.
    holder.client = seed({
      adoptions: [adoption(ORG, "signature")],
      authorizations: [{ id: "a1", org_id: OTHER, adoption_id: `adopt-signature-${ORG}` }],
    }).client;
    const other = await adopt({ kind: "signature", typed_text: "Susan M Godfrey", png_base64: PNG.toString("base64") });
    expect(other.status).toBe(201);
  });

  it("the initials stay changeable while only the signature is in use", async () => {
    holder.client = seed({
      adoptions: [adoption(ORG, "signature"), adoption(ORG, "initials")],
      authorizations: [{ id: "a1", org_id: ORG, adoption_id: `adopt-signature-${ORG}` }],
    }).client;
    const res = await adopt({ kind: "initials", typed_text: "S.G.", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(201);
  });

  it("needs the e-sign consent, like every signature on the link", async () => {
    const rec = seed({ invitation: { consented_at: null } });
    holder.client = rec.client;
    const res = await adopt({ kind: "signature", typed_text: "Susan Godfrey", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("esign_consent_required");
    expect(rec.storageCalls()).toEqual([]);
  });

  it("comes after Part 1 on a v2 link", async () => {
    const rec = seed({ intakes: [{ id: "i1", org_id: ORG, invitation_id: INVITE }] });
    holder.client = rec.client;
    const res = await adopt({ kind: "signature", typed_text: "Susan Godfrey", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("intake_incomplete");
  });

  it("removes the stored picture when the row is refused, and a dead link reads as one", async () => {
    const rec = seed({ rpc: { record_signature_adoption: { error: { code: "SA021", message: "application_invitation_unusable" } } } });
    holder.client = rec.client;
    const res = await adopt({ kind: "signature", typed_text: "Susan Godfrey", png_base64: PNG.toString("base64") });
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("invalid_link");
    const [upload, remove] = rec.storageCalls();
    expect(remove).toMatchObject({ bucket: "compliance-docs", fn: "remove", args: [[upload!.args[0]]] });
  });

  it("takes a picture larger than the general 1 MB body cap", async () => {
    holder.client = seed().client;
    // ~1.2 MB of noise: a PNG that does not compress, the shape of a phone photograph of ink.
    const noise = await sharp(Buffer.from(Array.from({ length: 700 * 600 * 3 }, (_, i) => (i * 7919) % 251)), {
      raw: { width: 700, height: 600, channels: 3 },
    }).png({ compressionLevel: 0 }).toBuffer();
    expect(noise.byteLength).toBeGreaterThan(1024 * 1024);
    const res = await adopt({ kind: "signature", typed_text: "Susan Godfrey", png_base64: noise.toString("base64") });
    expect(res.status).toBe(201);
  });
});

describe("the link serves what it adopted", () => {
  it("as typed text, this org's only", async () => {
    const rec = seed({ adoptions: [adoption(ORG, "signature"), adoption(ORG, "initials", { typed_text: "SG" })] });
    holder.client = rec.client;
    const body = (await (await call("")).json()) as { adoptions: unknown };
    expect(body.adoptions).toEqual({ signature: "Susan Godfrey", initials: "SG" });
  });

  it("a superseded adoption is not served", async () => {
    holder.client = seed({ adoptions: [adoption(ORG, "signature", { superseded_by: "newer" })] }).client;
    const body = (await (await call("")).json()) as { adoptions: unknown };
    expect(body.adoptions).toEqual({ signature: null, initials: null });
  });
});

describe("a permission is signed with the adopted signature", () => {
  it("names the live adoption to the 12-argument function", async () => {
    const rec = seed({ adoptions: [adoption(ORG, "signature")] });
    holder.client = rec.client;
    const res = await release("Susan Godfrey");
    expect(res.status).toBe(201);
    const args = rec.rpcs().find((r) => r.fn === "record_driver_release")!.args as Record<string, unknown>;
    expect(args.p_adoption_id).toBe(`adopt-signature-${ORG}`);
    expect(args.p_signed_name).toBe("Susan Godfrey");
  });

  it("signs with its typed name and no adoption when none was saved (A8b)", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await release("Susan Godfrey")).status).toBe(201);
    const args = rec.rpcs().find((r) => r.fn === "record_driver_release")!.args as Record<string, unknown>;
    expect(args).toHaveProperty("p_adoption_id", null);
  });

  it("refuses a name that is not the adopted one, and signs nothing", async () => {
    const rec = seed({ adoptions: [adoption(ORG, "signature")] });
    holder.client = rec.client;
    const res = await release("Susan M Godfrey");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("adoption_name_mismatch");
    expect(rec.rpcs()).toEqual([]);
  });

  it("answers the database's DR038 as the same mismatch", async () => {
    holder.client = seed({
      adoptions: [adoption(ORG, "signature")],
      rpc: { record_driver_release: { error: { code: "DR038", message: "adoption_not_found" } } },
    }).client;
    const res = await release("Susan Godfrey");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("adoption_name_mismatch");
  });
});
