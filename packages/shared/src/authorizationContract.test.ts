import { describe, it, expect } from "vitest";
import {
  AUTHORIZATION_PURPOSES,
  DISCLOSURES,
  authorizationGrantSchema,
  disclosuresAreDraft,
  hasLiveAuthorization,
  liveAuthorization,
  missingAuthorizations,
  type AuthorizationRow,
} from "./authorizationContract.js";

const row = (o: Partial<AuthorizationRow> & Pick<AuthorizationRow, "id" | "purpose">): AuthorizationRow => ({
  id: o.id,
  purpose: o.purpose,
  accepted_at: o.accepted_at ?? "2026-01-01T00:00:00Z",
  revokes: o.revokes ?? null,
});

describe("the disclosure catalogue", () => {
  it("carries one document per purpose, each with its own text and version", () => {
    for (const p of AUTHORIZATION_PURPOSES) {
      const d = DISCLOSURES[p];
      expect(d.purpose).toBe(p);
      expect(d.body.length).toBeGreaterThan(80);
      expect(d.intent.length).toBeGreaterThan(20);
      // A Part citation is as real as a section one — `drug_alcohol` cites Part 382 and Part 40,
      // which have no § because the obligation is the whole part.
      expect(d.citation).toMatch(/§|Part \d+|FCRA/);
    }
  });

  /**
   * FCRA §604(b)(2) — the disclosure must be "in a document that consists solely of the disclosure".
   * The structural guarantee is one document per purpose; this pins that nobody has quietly merged
   * two of them by giving two purposes the same body.
   */
  it("never reuses one body across two purposes, which is what an omnibus consent would look like", () => {
    const bodies = AUTHORIZATION_PURPOSES.map((p) => DISCLOSURES[p].body);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it("announces that the wording is still a draft, so a UI can say so", () => {
    // Flips to false the day counsel's text lands (Q-H3). Deliberately not asserted as `true`
    // forever: this test should start failing in the other direction and be updated then.
    expect(disclosuresAreDraft()).toBe(true);
  });
});

describe("what a caller may send", () => {
  it("refuses to accept the disclosure text from the client", () => {
    const withText = {
      driver_id: "11111111-1111-4111-8111-111111111111",
      purpose: "psp",
      method: "wet_signature",
      signed_name: "A Driver",
      disclosure_text: "whatever the client felt like",
    };
    expect(authorizationGrantSchema.safeParse(withText).success).toBe(false);
  });

  it("requires consent to transact electronically before it will take an e-signature", () => {
    const base = {
      driver_id: "11111111-1111-4111-8111-111111111111",
      purpose: "psp" as const,
      signed_name: "A Driver",
    };
    expect(authorizationGrantSchema.safeParse({ ...base, method: "esign" }).success).toBe(false);
    expect(
      authorizationGrantSchema.safeParse({ ...base, method: "esign", esign_consent: true }).success,
    ).toBe(true);
    // A wet signature needs no such consent — there is nothing electronic to agree to.
    expect(authorizationGrantSchema.safeParse({ ...base, method: "wet_signature" }).success).toBe(true);
  });
});

describe("liveAuthorization — a fold over an append-only table, not a column read", () => {
  it("finds a grant, and the newest one when there are several", () => {
    const rows = [
      row({ id: "a", purpose: "psp", accepted_at: "2026-01-01T00:00:00Z" }),
      row({ id: "b", purpose: "psp", accepted_at: "2026-06-01T00:00:00Z" }),
    ];
    expect(liveAuthorization(rows, "psp")?.id).toBe("b");
  });

  it("treats a revocation row as withdrawing the grant it names", () => {
    const rows = [
      row({ id: "a", purpose: "psp" }),
      row({ id: "r", purpose: "psp", revokes: "a", accepted_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(hasLiveAuthorization(rows, "psp")).toBe(false);
  });

  it("lets a fresh grant after a revocation stand — somebody may re-authorize", () => {
    const rows = [
      row({ id: "a", purpose: "psp", accepted_at: "2026-01-01T00:00:00Z" }),
      row({ id: "r", purpose: "psp", revokes: "a", accepted_at: "2026-02-01T00:00:00Z" }),
      row({ id: "c", purpose: "psp", accepted_at: "2026-03-01T00:00:00Z" }),
    ];
    expect(liveAuthorization(rows, "psp")?.id).toBe("c");
  });

  it("does not let one purpose's authorization answer for another", () => {
    const rows = [row({ id: "a", purpose: "fcra_disclosure" })];
    expect(hasLiveAuthorization(rows, "fcra_disclosure")).toBe(true);
    expect(hasLiveAuthorization(rows, "psp")).toBe(false);
  });

  it("says no on an empty file rather than throwing", () => {
    expect(hasLiveAuthorization([], "psp")).toBe(false);
  });
});

describe("what a screening call needs first", () => {
  /**
   * PSP needs its own authorization AND the FCRA disclosure. The PSP account-holder agreement demands
   * the first; the second is required if a PSP report is a consumer report, which is PSP-PLAN Q7 and
   * still open. Requiring both is correct either way and costs one extra signature.
   */
  it("names BOTH prerequisites for a PSP record, and names what is missing", () => {
    expect(missingAuthorizations([], "psp_record").sort()).toEqual(["fcra_disclosure", "psp"]);
    const psponly = [row({ id: "a", purpose: "psp" })];
    expect(missingAuthorizations(psponly, "psp_record")).toEqual(["fcra_disclosure"]);
    const both = [...psponly, row({ id: "b", purpose: "fcra_disclosure" })];
    expect(missingAuthorizations(both, "psp_record")).toEqual([]);
  });

  it("blocks a PSP record again the moment its authorization is revoked", () => {
    const rows = [
      row({ id: "a", purpose: "psp" }),
      row({ id: "b", purpose: "fcra_disclosure" }),
      row({ id: "r", purpose: "psp", revokes: "a" }),
    ];
    expect(missingAuthorizations(rows, "psp_record")).toEqual(["psp"]);
  });

  it("asks for the §40.25(g) release before a previous-employer inquiry", () => {
    expect(missingAuthorizations([], "previous_employer_inquiry")).toEqual(["previous_employer"]);
  });

  it("requires nothing for a call it does not know, rather than inventing a gate", () => {
    expect(missingAuthorizations([], "something_new")).toEqual([]);
  });
});
