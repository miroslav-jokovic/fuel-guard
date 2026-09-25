import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PACKET_WITHDRAWALS, RECRUITMENT_TEMPLATES, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { pdfPageCount, pdfPageTexts, pdfText } from "../../../testing/pdfText.js";

/**
 * The office's blank documents (MV2, D-MVR2) through their HTTP door.
 *
 * ⚠ `org_disclosures` is a `postgrestFixture` seeded with ANOTHER carrier's published wording, so a
 * template that read without its `org_id` filter would print the other carrier's words — the one
 * failure on this surface that would matter, because a driver would sign it.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  recruiter: ctx("recruiter"),
  technician: ctx("technician"),
};

let server: Server;
let baseUrl: string;

const get = (key: string, token = "admin") =>
  fetch(`${baseUrl}/api/recruitment/templates/${key}.pdf`, { headers: { Authorization: `Bearer ${token}` } });

const bytes = async (res: Response): Promise<Buffer> => Buffer.from(await res.arrayBuffer());
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      organizations: postgrestFixture([
        { id: ORG, name: "Silvicom Inc", legal_address: "1301 Armitage Ave, Melrose Park, IL 60160" },
        { id: OTHER, name: "Another Carrier LLC", legal_address: "1 Elsewhere Rd, Gary, IN 46401" },
      ]),
      org_disclosures: postgrestFixture([
        {
          org_id: OTHER, instrument: "mvr", version: "v1", title: "ANOTHER CARRIER'S MVR RELEASE",
          body: "Words another carrier published.", clauses: null, intent: "I agree with the other carrier.",
          published_at: "2026-09-20T10:00:00Z", published_by: null,
        },
      ]),
    },
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
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

describe("the blank templates", () => {
  /** A key in the catalogue with no drawing behind it would ship as a 404 on a button. */
  it("draws every catalogued template as a PDF", async () => {
    for (const t of RECRUITMENT_TEMPLATES) {
      holder.client = seed().client;
      const res = await get(t.key);
      expect(res.status, t.key).toBe(200);
      expect(res.headers.get("content-type"), t.key).toBe("application/pdf");
      expect(res.headers.get("cache-control"), t.key).toBe("no-store, private");
      expect((await bytes(res)).subarray(0, 5).toString(), t.key).toBe("%PDF-");
    }
  });

  it("prints the MVR release in the carrier's page 19 words, with nobody's name on it", async () => {
    holder.client = seed().client;
    const text = flat(await pdfText(await bytes(await get("permission-mvr"))));
    expect(text).toContain("AUTHORIZATION FOR DRIVING RECORD CHECK");
    expect(text).toContain("as directed by the Federal Motor Carrier Safety Administration Regulations");
    expect(text).toContain("Silvicom Inc");
  });

  it("never prints another carrier's published wording, and reads only this org", async () => {
    const rec = seed();
    holder.client = rec.client;
    const text = flat(await pdfText(await bytes(await get("permission-mvr"))));
    expect(text).not.toContain("ANOTHER CARRIER'S MVR RELEASE");
    expect(text).not.toContain("Another Carrier LLC");
    // `organizations` is read by its primary key, which IS the org — asserted below rather than exempted blind.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
    for (const q of rec.forTable("organizations")) {
      expect(q.filters()).toContainEqual({ col: "id", val: ORG });
    }
  });

  it("prints the carrier's packet whole, with the withdrawn lines' notices and no answers", async () => {
    holder.client = seed().client;
    const pdf = await bytes(await get("application-packet"));
    expect(await pdfPageCount(pdf)).toBe(31);
    const pages = await pdfPageTexts(pdf);
    expect(flat(pages[18]!).split(PACKET_WITHDRAWALS.p19a!.notice).length - 1).toBe(2);
    expect(flat(pages[3]!)).toContain(PACKET_WITHDRAWALS.p04!.notice);
  });

  it("prints a road test with nothing recorded on it", async () => {
    holder.client = seed().client;
    const text = flat(await pdfText(await bytes(await get("road-test"))));
    expect(text).toContain("DRIVER’S ROAD TEST EXAMINATION");
    expect(text).toContain("EVALUATION OF ROAD TEST");
    // The recorded form's words: "None." for empty remarks, and the note tracing an applied signature.
    expect(text).not.toContain("None.");
    expect(text).not.toContain("Examiner's signature applied");
    expect(text).not.toMatch(/\bX\b/);
  });

  it("prints the handbook with no name, no SSN and no countersignature", async () => {
    holder.client = seed().client;
    const text = flat(await pdfText(await bytes(await get("handbook"))));
    expect(text).toContain("Silvicom Inc");
    expect(text).not.toContain("•••");
    expect(text).not.toContain("Signature applied from the carrier's file");
  });
});

describe("who may print them", () => {
  it("lets a recruiter print", async () => {
    holder.client = seed().client;
    expect((await get("permission-psp", "recruiter")).status).toBe(200);
  });

  it("refuses a role without the recruitment section", async () => {
    holder.client = seed().client;
    expect((await get("permission-psp", "technician")).status).toBe(403);
  });

  it("answers an unknown template with a 404, not an empty page", async () => {
    holder.client = seed().client;
    expect((await get("everything")).status).toBe(404);
  });
});
