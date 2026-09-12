import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { applicationPreviewPdf, isPreviewError } from "./preview.js";

/**
 * The office's printable preview of an application nobody has signed (F6).
 *
 * ⚠ Three things are pinned and they are the three that would hurt. The org filter, because this
 * reads with the service role and a missing one hands another carrier's applicant to whoever asks.
 * The refusal on a FILED application, because re-rendering one would put a second, uncited copy of a
 * §391.51(b)(1) record into circulation. And that the band is actually on the page, because the
 * whole difference between this document and the filing is one boolean.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** A payload in the shape `toDraftPayload` writes one — empty strings, no certification. */
const PAYLOAD = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Elm St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2019-04", to: "" }],
  cdl_number: "D1234", cdl_state: "IL", cdl_class: "A", cdl_expires_at: "",
  employers: [], declares_no_employment: false,
  accidents: [], declares_no_accidents: false,
  violations: [], declares_no_violations: false,
  licence_ever_denied: false, licence_denial_detail: "",
  questionnaire: { proof_of_age: true },
};

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV,
  org_id: ORG,
  driver_id: DRIVER,
  review_requested_at: null,
  approved_at: null,
  submitted_at: null,
  ...over,
});

/**
 * ⚠ A FUNCTION fixture for the invitation, never a flat array. `supabaseRecorder` records `.eq()`
 * and does not apply it, so an array answers another carrier's query with this carrier's row — and a
 * cross-tenant test written against one proves that the fake ignores filters, nothing more.
 */
const seed = (over: { invitation?: Record<string, unknown> | null; payload?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q) => {
        if (over.invitation === null) return [];
        const row = over.invitation ?? invitation();
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== row.org_id ? [] : [row];
      },
      application_drafts: over.payload === null ? [] : [{ payload: over.payload ?? PAYLOAD }],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      driver_authorizations: [],
      esign_consents: [],
      application_captures: [],
      documents: [],
    },
  });

/** The text a reader would see — pdfkit deflates its streams, so the raw bytes carry nothing. */
async function textOf(pdf: Buffer): Promise<string> {
  const { inflateSync } = await import("node:zlib");
  const raw = pdf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // Not a deflate stream (a font subset, the xref) — nothing to read here.
    }
  }
  return (out.match(/<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\)/g) ?? [])
    .map((token) =>
      token.startsWith("<")
        ? Buffer.from(token.slice(1, -1).replace(/\s+/g, ""), "hex").toString("latin1")
        : token.slice(1, -1).replace(/\\([()\\])/g, "$1"),
    )
    .join("");
}

describe("previewing an application before it is signed", () => {
  it("renders the answers that exist, marked as a draft", async () => {
    const result = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(result)).toBe(false);
    if (isPreviewError(result)) return;
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textOf(result.pdf);
    expect(text).toContain("Susan Godfrey");
    expect(text).toContain("DRAFT - NOT A SIGNED APPLICATION");
    expect(result.filename).toContain("preview");
  });

  /**
   * ⚠ The one line of this module that could forge something. `signedName` is what the renderer
   * prints under the §391.21(b)(12) statement, and a preview that passed the applicant's own name —
   * which this module is holding, two fields away — would print a signature for an act nobody has
   * performed. Scoped to the certification block, because the name legitimately appears in the (b)(2)
   * block, in the footer of every sheet and beside each release they really did sign.
   */
  it("signs nothing: the certification block carries no name", async () => {
    const result = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(result)).toBe(false);
    if (isPreviewError(result)) return;
    const text = await textOf(result.pdf);
    const block = text.slice(text.indexOf("§391.21(b)(12)"), text.indexOf("NOT SIGNED."));
    expect(block).not.toContain("Susan");
    expect(block).not.toContain("Godfrey");
  });

  it("says where it has got to, and moves when the driver hands it over", async () => {
    const filling = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(filling)).toBe(false);
    if (isPreviewError(filling)) return;
    expect(await textOf(filling.pdf)).toContain("filling it in");

    const handed = await applicationPreviewPdf(
      seed({ invitation: invitation({ review_requested_at: "2026-09-11T09:00:00Z" }) }).client,
      ORG,
      INV,
    );
    expect(isPreviewError(handed)).toBe(false);
    if (isPreviewError(handed)) return;
    expect(await textOf(handed.pdf)).toContain("waiting for you");
  });

  it("scopes every read to the reader's own org", async () => {
    // The service role bypasses RLS, so the filter is the only thing between two carriers.
    const rec = seed();
    await applicationPreviewPdf(rec.client, ORG, INV);
    // `organizations` is filtered by primary key, which IS the tenant id — the same exemption
    // `file.test.ts` makes for the same read.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("says not found rather than leaking that an invitation exists elsewhere", async () => {
    const result = await applicationPreviewPdf(seed().client, OTHER_ORG, INV);
    expect(isPreviewError(result) && result.code).toBe("application_not_found");
  });

  /**
   * ⚠ The filed application already has a document — hashed into `documents.sha256` and cited by the
   * §391.51(b)(1) row. A second copy rendered here would not match it, and both would be "the
   * application".
   */
  it("refuses once the application is filed, and says where the real one is", async () => {
    const result = await applicationPreviewPdf(
      seed({ invitation: invitation({ submitted_at: "2026-09-11T10:00:00Z" }) }).client,
      ORG,
      INV,
    );
    expect(isPreviewError(result) && result.code).toBe("already_filed");
    expect(isPreviewError(result) && result.message).toContain("applicant's page");
  });

  it("refuses a link nobody has typed into, rather than printing an empty form", async () => {
    const result = await applicationPreviewPdf(seed({ payload: null }).client, ORG, INV);
    expect(isPreviewError(result) && result.code).toBe("nothing_to_preview");
  });

  /**
   * ⚠ The renderer must survive a payload that does not match today's contract, because
   * `application_drafts.payload` is jsonb written by a form whose shape has changed before. A preview
   * that refused to draw is the office losing the document over a key.
   */
  it("draws a barely-started draft rather than refusing it", async () => {
    const result = await applicationPreviewPdf(
      seed({ payload: { first_name: "Sam", unknown_future_key: 1 } }).client,
      ORG,
      INV,
    );
    expect(isPreviewError(result)).toBe(false);
    if (isPreviewError(result)) return;
    expect(await textOf(result.pdf)).toContain("Sam");
  });
});
