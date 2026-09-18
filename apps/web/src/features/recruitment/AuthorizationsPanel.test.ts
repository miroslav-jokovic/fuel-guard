import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { APPLICATION_RELEASE_ORDER } from "@silvicom/shared";
import AuthorizationsPanel from "@/features/recruitment/AuthorizationsPanel.vue";
import type { AuthorizationDetail } from "@/features/recruitment/useAuthorizations";

/**
 * The four signed releases (B6, and the answer to Q-HUI6).
 *
 * ⚠ The rows are built from `APPLICATION_RELEASE_ORDER` rather than from four hand-written purposes,
 * for the reason the fold's own suite gives: a fixture that wrote the list out would keep passing
 * through the change it exists to catch.
 */

const row = (over: Partial<AuthorizationDetail> & { purpose: string }): AuthorizationDetail => ({
  id: `${over.purpose}-1`,
  driver_id: "driver-1",
  disclosure_version: "2026-08-19.1",
  disclosure_text: "…",
  method: "esign",
  signed_name: "Marija Petrović",
  intent_statement: null,
  esign_consent_at: "2026-09-01T10:00:00Z",
  accepted_at: "2026-09-01T10:00:00Z",
  evidence_document_id: null,
  revokes: null,
  revoke_reason: null,
  created_at: "2026-09-01T10:00:00Z",
  ...over,
});

const ALL = APPLICATION_RELEASE_ORDER.map((purpose) => row({ purpose }));

const render = (rows: AuthorizationDetail[]) =>
  mount(AuthorizationsPanel, { props: { rows, loading: false, error: null } });

describe("what the office can finally see", () => {
  it("lists every release the applicant is asked to sign, and only those", () => {
    const wrapper = render(ALL);
    expect(wrapper.findAll("li")).toHaveLength(APPLICATION_RELEASE_ORDER.length);
  });

  /**
   * ⚠ **The version is the load-bearing column, not the tick.** FCRA §604(b)(2) is about the wording
   * somebody was shown, so a dispute is settled by which version they accepted. A panel showing
   * "signed ✓" and a date would look complete and be useless on the one day it is needed.
   */
  it("shows the wording version each release was signed against", () => {
    expect(render(ALL).text()).toContain("wording 2026-08-19.1");
  });

  /**
   * ⚠ **LIVE, not latest (D-REC3).** These rows are append-only and a revocation is a new row
   * pointing at the grant it revokes. Reading the newest row would let this panel say *signed* about
   * a release the checklist calls outstanding — D-HM2's disagreement in miniature — so it folds with
   * `liveAuthorization`, the same function the fold uses.
   */
  it("reads a revoked release as not signed, however recent the revocation row is", () => {
    const purpose = APPLICATION_RELEASE_ORDER[0]!;
    const grant = row({ purpose });
    const revocation = row({
      purpose,
      id: `${purpose}-2`,
      revokes: grant.id,
      accepted_at: "2026-09-05T10:00:00Z",
      created_at: "2026-09-05T10:00:00Z",
    });
    const wrapper = render([grant, revocation, ...ALL.slice(1)]);
    expect(wrapper.findAll("li")[0]!.text()).toContain("Not signed yet");
  });

  it("says nothing is signed when nothing is", () => {
    const wrapper = render([]);
    expect(wrapper.findAll("li").every((li) => li.text().includes("Not signed yet"))).toBe(true);
  });

  /**
   * ⚠ The fifth purpose is consented to inside FMCSA's own portal (D-REC4). Listing it would show a
   * permanently missing release for a consent the carrier is not supposed to hold here.
   */
  it("does not list the Clearinghouse consent as a release the office is missing", () => {
    const wrapper = render(ALL);
    const items = wrapper.findAll("li").map((li) => li.text());
    expect(items.some((t) => t.includes("Clearinghouse query consent"))).toBe(false);
    expect(wrapper.text()).toContain("given inside the FMCSA portal");
  });
});
