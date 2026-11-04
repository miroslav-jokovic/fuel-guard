import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { pdfText } from "../../../testing/pdfText.js";
import { hashInvitationToken } from "../applicationIntake.js";
import { DRUG_ALCOHOL_POLICY_PLACEMENT_ID, DRUG_ALCOHOL_POLICY_VERSION } from "../applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyText.js";
import { filedPolicyDocumentId } from "../applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyCopy.js";

/**
 * `GET /api/public/application/:token/drug-alcohol-policy.pdf` (DAP2, §15.2 D-DAP2), end to end: the
 * carrier's policy as bytes on any live link, never cached; with the p28 receipt on it once signed for
 * this text; the FILED copy once the packet is filed; 404 for a dead link.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const APP_ID = "11111111-2222-4333-8444-555555555555";
const NAME = "Marija Varmeda";
const FILED = Buffer.from("%PDF-1.7 the filed policy");

let n = 0;
/** A fresh link per test: the ceremony bucket is keyed by the link. */
const freshToken = (): string => String(++n).padStart(3, "0").repeat(15).slice(0, 43);

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

const seed = (token: string, opts: { invitation?: Record<string, unknown>; marks?: Record<string, unknown>[]; filed?: boolean } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: "inv-1", org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(token),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, submitted_at: null, ...opts.invitation,
      }],
      application_packet_marks: postgrestFixture(opts.marks ?? []),
      driver_applications: postgrestFixture([{ id: APP_ID, org_id: ORG, invitation_id: "inv-1", certified_at: "2026-11-04T17:00:00Z" }]),
      documents: postgrestFixture(opts.filed
        ? [{ id: filedPolicyDocumentId(APP_ID), org_id: ORG, storage_path: "org/driver/policy.pdf" }]
        : []),
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      signature_adoptions: [],
      application_captures: [],
      application_packet_mark_adoptions: [],
    },
    storage: { download: () => ({ data: new Blob([FILED]), error: null }) },
  });

const p28 = { org_id: ORG, invitation_id: "inv-1", placement_id: DRUG_ALCOHOL_POLICY_PLACEMENT_ID, signed_name: NAME,
  signed_at: "2026-11-04T16:00:00Z", policy_version: DRUG_ALCOHOL_POLICY_VERSION };
const get = (token: string) => fetch(`${baseUrl}/api/public/application/${token}/drug-alcohol-policy.pdf`);
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe("GET /:token/drug-alcohol-policy.pdf", () => {
  it("serves the carrier's policy as a PDF on a live link, uncached, with the signature line blank", async () => {
    const token = freshToken();
    const rec = seed(token);
    holder.client = rec.client;
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    const text = await pdfText(await bytes(res));
    expect(text).toContain("DRUG AND ALCOHOL");
    expect(text).toContain("DRIVER SIGNATURE");
    expect(text).not.toContain(NAME);
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations", "organizations"] });
  });

  it("prints the page-28 receipt once the driver has signed it for this text", async () => {
    const token = freshToken();
    holder.client = seed(token, { invitation: { approved_at: "2026-11-04T10:00:00Z", signing_opened_at: "2026-11-04T15:00:00Z" }, marks: [p28] }).client;
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(await pdfText(await bytes(res))).toContain(NAME);
  });

  it("serves the filed copy once the packet is filed, never a fresh rendering", async () => {
    const token = freshToken();
    const rec = seed(token, { invitation: { submitted_at: "2026-11-04T17:00:00Z" }, marks: [p28], filed: true });
    holder.client = rec.client;
    const res = await get(token);
    expect(res.status).toBe(200);
    expect((await bytes(res)).equals(FILED)).toBe(true);
    expect(res.headers.get("content-disposition")).toContain("drug-alcohol-policy-signed.pdf");
    expect(rec.storageCalls().map((c) => c.args[0])).toEqual(["org/driver/policy.pdf"]);
  });

  it("answers 404 for a dead link", async () => {
    const token = freshToken();
    holder.client = seed(token, { invitation: { revoked_at: "2026-11-01T00:00:00Z" } }).client;
    const res = await get(token);
    expect(res.status).toBe(404);
  });
});
