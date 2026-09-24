import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { APPLICATION_RELEASE_ORDER } from "@silvicom/shared";
import AuthorizationsPanel from "@/features/recruitment/AuthorizationsPanel.vue";

const fetchObjectUrl = vi.hoisted(() => vi.fn(async () => "blob:permissions"));
vi.mock("@/lib/api", () => ({ fetchObjectUrl, apiFetch: vi.fn() }));
const openPdf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/documentDownload", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  openPdf,
}));

/**
 * ⚠ The VIEWER is mounted for real and only its `BaseModal` is stubbed — HeadlessUI's `Dialog`
 * throws under this repo's jsdom, which is the same compromise B8 made on the review drawer.
 * Stubbing `DocumentPreview` itself would leave the one thing this wiring can get wrong — which
 * document it is handed — unasserted.
 */
const BaseModalStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "printable"],
};
import type { AuthorizationDetail } from "@/features/recruitment/useAuthorizations";

/**
 * The signed releases (B6, and the answer to Q-HUI6).
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

const INVITATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const render = (rows: AuthorizationDetail[], invitationId: string | null = INVITATION) =>
  mount(AuthorizationsPanel, {
    props: { rows, loading: false, error: null, invitationId },
    global: { stubs: { BaseModal: BaseModalStub } },
  });

const printButton = (wrapper: ReturnType<typeof render>) =>
  wrapper.findAll("button").find((b) => b.text().includes("Print what they have signed")) ?? null;

beforeEach(() => {
  setActivePinia(createPinia());
  openPdf.mockReset();
  fetchObjectUrl.mockClear();
});

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
   * ⚠ **The step's done-when is about a person, not an endpoint** (§0, and A11b's lesson: it was
   * marked done while the first invitation had no send path at all). The document B2 renders is
   * reachable only from here, so the assertion that matters is that pressing this asks for THIS
   * invitation's permissions — a driver-keyed path would be the other half of the decision recorded
   * in the route's header, silently undone.
   *
   * ⚠ And it opens BESIDE the releases rather than in a new tab (B8). `openPdf` is asserted NOT to
   * have been called, because a viewer that opened correctly AND also opened a tab would satisfy
   * every other assertion here.
   */
  it("opens this invitation's permissions in the viewer, beside the releases", async () => {
    const wrapper = render(ALL);
    const viewer = wrapper.findComponent({ name: "DocumentPreview" });
    expect(viewer.props("open")).toBe(false);

    await printButton(wrapper)!.trigger("click");

    expect(viewer.props("open")).toBe(true);
    expect((viewer.props("rendered") as { path: string }).path).toBe(
      `/api/recruitment/applications/${INVITATION}/permissions.pdf`,
    );
    expect(openPdf).not.toHaveBeenCalled();

    // ⚠ And the caption names what this document is drawn from. The viewer's DEFAULT sentence —
    // "the answers on file" — is true of the application preview and false of this: there are no
    // answers on a document of signed instruments, and the applicant may not have typed one yet.
    expect(wrapper.text()).toContain("Rendered from the instruments this applicant signed");
  });

  /**
   * ⚠ This panel is a drawer BODY and the step drawer swaps what it holds without unmounting, so a
   * viewer left open would greet the next applicant with the last one's document — which is worse
   * than a stale screen: it is one person's signed instruments shown under another person's name.
   */
  it("closes the viewer when the drawer moves to another invitation", async () => {
    const wrapper = render(ALL);
    await printButton(wrapper)!.trigger("click");
    expect(wrapper.findComponent({ name: "DocumentPreview" }).props("open")).toBe(true);

    await wrapper.setProps({ invitationId: "another-invitation" });

    expect(wrapper.findComponent({ name: "DocumentPreview" }).props("open")).toBe(false);
  });

  /**
   * ⚠ The API refuses an empty one in a sentence rather than printing a sheet of "Not signed yet"
   * rows, so a button offered before anything is signed has exactly one outcome and it is a refusal.
   * Both halves are pinned: the button is absent with nothing signed, and present with something —
   * otherwise a panel that never offered it would pass the first assertion for ever.
   */
  it("offers the printed copy only once something has been signed", () => {
    expect(printButton(render([]))).toBeNull();
    expect(printButton(render(ALL))).not.toBeNull();
  });

  /** No invitation, no document: the releases are keyed on the hire they were signed for. */
  it("offers nothing to print when there is no live invitation", () => {
    expect(printButton(render(ALL, null))).toBeNull();
  });

  /**
   * ⚠ D-AF4 (2026-09-24) reversed D-REC4: the Clearinghouse LIMITED-query consent is the fifth
   * release the applicant signs, so the office is owed its row — and the sentence that used to stand
   * under four rows saying it "is given inside the FMCSA portal" would now contradict the row above
   * it. Both halves are asserted, because a panel that listed the row and kept the sentence would
   * pass the first on its own.
   */
  it("lists the Clearinghouse consent as the fifth release, with no sentence disowning it", () => {
    const wrapper = render(ALL);
    const items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toHaveLength(APPLICATION_RELEASE_ORDER.length);
    expect(items.some((t) => t.includes("Clearinghouse query consent"))).toBe(true);
    expect(wrapper.text()).not.toContain("given inside the FMCSA portal");
  });
});
