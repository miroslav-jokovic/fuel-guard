import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERMISSION_SIGNATURE_BOX, PERMISSION_SIGNATURE_DESTINATION } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { pdfDrawnLines, pdfPageTexts, pdfText } from "../../../testing/pdfText.js";
import { hashInvitationToken } from "../applicationIntake.js";
import { PSP_MANDATED_INTENT, PSP_MANDATED_PARAGRAPHS } from "../pspDisclosure.js";

/**
 * One permission, unsigned, served to the applicant who is about to sign it (AF6, D-AF2).
 *
 * ⚠ What is pinned is what would hurt. The PSP PDF carrying FMCSA's words in whole and **nothing of
 * ours**, because the form's own NOTICE makes that a condition of the account the PSP API depends on.
 * The consent gate, because an instrument delivered before the 7001(c) consent is an electronic record
 * with no consent behind it. The signature box, because the signing screen finds it by name inside
 * these bytes and a PDF without it leaves the Sign here tag nowhere. And the org filter.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const TOKEN = "e".repeat(43);

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
  consented_at: "2026-09-24T09:00:00Z",
  releases_completed_at: null, application_sent_at: null,
  review_requested_at: null, approved_at: null, submitted_at: null,
  ...over,
});

const seed = (over: { invitation?: Record<string, unknown> | null } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [invitation(over.invitation)],
      organizations: [{ name: "Silvicom Inc", legal_address: "1301 Armitage Ave, Melrose Park IL" }],
      org_disclosures: [],
    },
  });

let server: Server;
let baseUrl: string;
let seq = 0;

const get = (purpose: string, token = TOKEN) =>
  fetch(`${baseUrl}/api/public/application/${token}/permission/${purpose}.pdf`, {
    headers: { "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}` },
  });

const bytes = async (res: Response): Promise<Buffer> => Buffer.from(await res.arrayBuffer());
const code = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

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

describe("the permission the applicant is about to sign", () => {
  it("serves the PSP form as a PDF, never cached", async () => {
    holder.client = seed().client;
    const res = await get("psp");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect((await bytes(res)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  /**
   * ⚠ The plan's own verification: FMCSA's form "must be used in whole, exactly as provided", and
   * "may NOT be included with other consent forms or any other language". Every mandated paragraph
   * and the authorization sentence is on the PDF, with the carrier's name in the form's own blank,
   * and nothing of ours is: no letterhead, no version line, no band, no footer.
   */
  it("prints FMCSA's PSP words in whole and none of ours", async () => {
    holder.client = seed().client;
    const text = flat(await pdfText(await bytes(await get("psp"))));
    for (const p of PSP_MANDATED_PARAGRAPHS) {
      // `winAnsi` folds curly quotes to straight ones, as it does on every PDF this API draws.
      const words = flat(p.replace("{{EMPLOYER}}", "Silvicom Inc").replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
      expect(text, words.slice(0, 50)).toContain(words);
    }
    expect(text).toContain(flat(PSP_MANDATED_INTENT));
    expect(text).not.toContain("1301 Armitage");
    expect(text).not.toMatch(/Version |SIGNED PERMISSIONS|Silvicom 360|Page \d/);
    // The form's own captions for its signature block.
    expect(text).toContain("Name (Please Print)");
  });

  /** The paper's order: the two NOTICE paragraphs sit under the signature, where FMCSA printed them. */
  it("puts FMCSA's NOTICE paragraphs below the signature block", async () => {
    holder.client = seed().client;
    const pages = await pdfPageTexts(await bytes(await get("psp")));
    const text = pages.join(" ");
    expect(text.indexOf("Name (Please Print)")).toBeLessThan(text.indexOf("NOTICE: This form is made available"));
    expect(text.indexOf("I hereby authorize Prospective Employer")).toBeLessThan(text.indexOf("Signature"));
  });

  it("prints a carrier's own instrument under its letterhead, with its version", async () => {
    holder.client = seed().client;
    const text = flat(await pdfText(await bytes(await get("fcra_disclosure"))));
    expect(text).toContain("Silvicom Inc");
    expect(text).toContain("1301 Armitage Ave");
    expect(text).toMatch(/Version packet-/);
  });

  /**
   * ⚠ The signing screen finds the box by this name inside these bytes (`permissionInstrument.ts` in
   * shared). Read out of the PDF's own name tree, on every one of the five, because a PDF that drew
   * the box without naming it would render perfectly and leave the Sign here tag with nowhere to go.
   */
  it.each(["fcra_disclosure", "psp", "previous_employer", "drug_alcohol", "clearinghouse"])(
    "names the signature box inside the %s PDF, directly above its own Signature caption",
    async (purpose) => {
      holder.client = seed().client;
      const { PDFDocument, PDFArray, PDFName, PDFNumber, PDFDict } = await import("pdf-lib");
      const pdf = await bytes(await get(purpose));
      const doc = await PDFDocument.load(pdf);
      const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
      const dests = names.lookup(PDFName.of("Dests"), PDFDict);
      const pairs = dests.lookup(PDFName.of("Names"), PDFArray);
      const found: Array<{ page: number; x: number; y: number }> = [];
      for (let i = 0; i < pairs.size(); i += 2) {
        const name = pairs.lookup(i)?.toString() ?? "";
        if (!name.includes(PERMISSION_SIGNATURE_DESTINATION)) continue;
        const dest = pairs.lookup(i + 1, PDFArray);
        const pageRef = dest.get(0);
        const page = doc.getPages().findIndex((p) => p.ref === pageRef);
        found.push({ page, x: dest.lookup(2, PDFNumber).asNumber(), y: dest.lookup(3, PDFNumber).asNumber() });
      }
      expect(found).toHaveLength(1);
      const [box] = found;
      expect(box!.page).toBeGreaterThanOrEqual(0);
      expect(box!.x).toBeGreaterThan(0);
      /**
       * ⚠ **Pinned to the box's OWN caption, not to "somewhere on the sheet"**, and the weaker version
       * of this test passed on a double-flipped y for four of the five: every wrong y it produced was
       * still on the page. The `Signature` caption sits just under the box's rule, so in distance
       * down the page it is the box's height plus a few points below the box's top.
       */
      const topDown = 792 - box!.y;
      const caption = (await pdfDrawnLines(pdf)).find((l) => l.page === box!.page && l.text === "Signature");
      expect(caption, "the box's Signature caption, on the box's page").toBeDefined();
      const gap = caption!.y - topDown - PERMISSION_SIGNATURE_BOX.height;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(15);
    },
  );

  it("refuses before the consent to transact electronically, as a conflict", async () => {
    holder.client = seed({ invitation: { consented_at: null } }).client;
    const res = await get("psp");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("esign_consent_required");
  });

  it("answers 404 for a purpose the applicant is not asked for, and for a dead link", async () => {
    holder.client = seed().client;
    const unknown = await get("application_packet");
    expect(unknown.status).toBe(404);
    expect(await code(unknown)).toBe("not_a_permission");
    holder.client = seed({ invitation: null }).client;
    const dead = await get("psp");
    expect(dead.status).toBe(404);
    expect(await code(dead)).toBe("invalid_link");
  });

  it("scopes every read to the link's own carrier", async () => {
    const rec = seed();
    holder.client = rec.client;
    await get("psp");
    // `application_invitations` is found by the token's hash (the token IS the credential) and
    // `organizations` by its own id, which is this org; every other read carries `org_id`.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations", "organizations"] });
    expect(rec.forTable("organizations").every((q) => q.filters().some((f) => f.col === "id" && f.val === ORG))).toBe(true);
  });
});
