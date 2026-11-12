import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import type { DriverApplication } from "@silvicom/shared";
import { renderPacketDocument } from "../applicationPdf/packetDocument.js";
import { withFullSsn } from "../applicationPdf/fullSsnCopy.js";
import { ssnForPacket } from "../applicantSsn.js";
import { pdfText } from "../../../testing/pdfText.js";

/**
 * The filed packet with the SSN in full, on demand (Q-AM20 (a); `applicationPdf/fullSsnCopy.ts`).
 *
 * Pinned: the stored copy's four masked places come back with all nine digits and nothing else is
 * re-rendered; only a holder of "See the full SSN" may ask, and every read is audited without the
 * number; a number kept as its last four, an application filed before the packet, and another org's
 * document each get their own answer, never a copy.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INV = "11111111-2222-4333-8444-555555555555";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv);
const DOC = "99999999-8888-4777-8666-555555555555";
const APP_ID = "44444444-5555-4666-8777-888888888888";

const APPLICATION = {
  first_name: "Susan", middle_name: "M", last_name: "Godfrey", date_of_birth: "1980-04-01", other_names: [],
  email: "s@x.test", phone: "555-0111", addresses: [], cdl_number: "PA334554", cdl_state: "PA", cdl_class: "A",
  cdl_expires_at: "2029-01-01", additional_licences: [], experience: "x", equipment_experience: [],
  declares_no_violations: true, violations: [], declares_no_accidents: true, accidents: [], employers: [], declares_no_employment: true,
} as unknown as DriverApplication;

let STORED: Buffer;
const seed = (over: { sealed?: string | null; marks?: boolean; cited?: boolean; grants?: unknown[] } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      qualification_records: over.cited === false ? [] : [{ reference: APP_ID }],
      application_packet_countersignatures: [],
      driver_applications: [{
        id: APP_ID, invitation_id: INV, payload: APPLICATION,
        ssn_sealed: over.sealed === undefined ? seal(ENV, "123456789", secretAad(ORG, "driver_ssn")) : over.sealed,
      }],
      documents: [{ storage_path: "org/driver/x/application.pdf" }],
      application_packet_marks: over.marks === false ? [] : [{ placement_id: "p03", signed_name: "Susan Godfrey", signed_at: "2026-11-01T10:00:00Z" }],
      audit_logs: [],
      org_role_permissions: (over.grants ?? []) as never,
    },
    storage: { download: async () => ({ data: new Blob([new Uint8Array(STORED)]), error: null }) },
  });

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(["recruiter", "safety_manager", "admin"].map((r) => [r, ctx(r)]));

let server: Server;
let baseUrl: string;
const get = (token: string) =>
  fetch(`${baseUrl}/api/recruitment/filed-applications/${DOC}/full-ssn.pdf`, { headers: { Authorization: `Bearer ${token}` } });

beforeAll(async () => {
  STORED = await renderPacketDocument({ marks: [], application: APPLICATION, certifiedAt: "2026-11-01T10:00:00Z", signedName: "Susan Godfrey", ssn: "•••-••-6789" });
  const app = createApp(ENV);
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("the four places, redrawn", () => {
  it("prints all nine digits where the stored copy printed the last four, and leaves the rest as filed", async () => {
    const before = await pdfText(STORED);
    const after = await pdfText(await withFullSsn(STORED, APPLICATION, "123456789"));
    expect(before).not.toContain("123-45-6789");
    expect(after.split("123-45-6789").length - 1).toBe(4);
    expect(after).toContain("Godfrey");
    expect(after).toContain("PA334554");
  });
});

describe("GET /filed-applications/:documentId/full-ssn.pdf", () => {
  it("serves the safety manager the full copy, uncached, and audits the read without the number", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await get("safety_manager");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await pdfText(Buffer.from(await res.arrayBuffer()))).toContain("123-45-6789");
    const audit = rec.writtenRows("audit_logs");
    expect(audit).toEqual([expect.objectContaining({ action: "application.ssn_viewed", actor_id: "u-safety_manager" })]);
    expect(JSON.stringify(audit)).not.toContain("123456789");
    expectOrgScoped(rec, ORG);
  });

  it("refuses the recruiter by default, and reads nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await get("recruiter")).status).toBe(403);
    expect(rec.queries.filter((q) => q.table === "driver_applications")).toEqual([]);
  });

  it("answers in words, and with no copy, for a last-four-only number, a pre-packet filing and an unknown document", async () => {
    holder.client = seed({ sealed: null }).client;
    expect((await get("admin")).status).toBe(409);
    holder.client = seed({ marks: false }).client;
    expect((await get("admin")).status).toBe(409);
    holder.client = seed({ cited: false }).client;
    expect((await get("admin")).status).toBe(404);
  });
});

describe("what each packet reader is handed (ssnForPacket)", () => {
  const held = () => createSupabaseRecorder({
    tables: {
      application_ssns: [{ ssn_last4: "6789", ssn_sealed: seal(ENV, "123456789", secretAad(ORG, "driver_ssn")), entered_by: "applicant" }],
      audit_logs: [],
    },
  });

  it("hands everyone the last four, the driver their own nine unaudited, and an office holder nine, audited", async () => {
    const masked = held();
    expect(await ssnForPacket(masked.client, ENV, ORG, INV, null)).toBe("•••-••-6789");
    const driver = held();
    expect(await ssnForPacket(driver.client, ENV, ORG, INV, { reader: "applicant" })).toBe("123-45-6789");
    expect(driver.writtenRows("audit_logs")).toEqual([]);
    const office = held();
    expect(await ssnForPacket(office.client, ENV, ORG, INV, { reader: "office", actorId: "u-safety" })).toBe("123-45-6789");
    expect(office.writtenRows("audit_logs")).toEqual([expect.objectContaining({ action: "application.ssn_viewed", actor_id: "u-safety" })]);
    expectOrgScoped(office, ORG);
  });

  it("hands nothing when none was given", async () => {
    expect(await ssnForPacket(createSupabaseRecorder({ tables: { application_ssns: [] } }).client, ENV, ORG, INV, { reader: "applicant" })).toBeNull();
  });
});
