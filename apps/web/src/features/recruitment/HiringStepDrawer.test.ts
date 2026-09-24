import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { hiringChecklist, type HiringChecklistInputs, type HiringStep } from "@silvicom/shared";
import HiringStepDrawer from "@/features/recruitment/HiringStepDrawer.vue";

/**
 * Which work a checklist row opens (B6).
 *
 * ── WHAT IS ASSERTED, AND WHAT IS DELIBERATELY STUBBED ────────────────────────────────────────
 * The bodies themselves are existing components with their own suites; what B6 decided is the
 * SWITCH — which step opens which body, and what the two bodies with no affordance yet are allowed
 * to say. So the four section components are stubbed to their own names and the assertions are
 * about which one rendered. Mounting them for real would test `EmploymentHistorySection` again and
 * test `hiringStepDrawers.ts` not at all.
 */

const routes = [
  { path: "/recruitment/:id", name: "applicant-record", component: { template: "<div />" } },
  { path: "/drivers/:id", name: "driver-detail", component: { template: "<div />" } },
];

const DRIVER = "driver-1";

const stub = (name: string) => ({ name, template: `<div data-body="${name}" />` });

const STUBS = {
  ApplicationInviteCard: stub("invite"),
  AuthorizationsPanel: stub("authorizations"),
  ApplicantIdentityCorrection: stub("identity"),
  SendApplicationPanel: stub("send"),
  EmploymentHistorySection: stub("employment"),
  EmployerInquirySection: stub("inquiry"),
  PspRecordsSection: stub("psp"),
  RecordedActPanel: stub("record"),
};

/** Everything the schema can see is done, so every step has a state worth opening. */
const COMPLETE: HiringChecklistInputs = {
  invitedAt: "2026-09-01T00:00:00Z",
  phases: {
    applicationSentAt: "2026-09-01T12:00:00Z",
    reviewRequestedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z",
    submittedAt: null,
  },
};

const stepOf = (key: string): HiringStep =>
  hiringChecklist(COMPLETE).steps.find((s) => s.key === key)!;

let wrapper: VueWrapper | null = null;

/** ⚠ SlideOver teleports. Unmount and clear the body, or the next test reads a panel from this one. */
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

/**
 * ⚠ **It unmounts the previous panel first, and that line is here because a mutation caught its
 * absence.** `SlideOver` teleports into `document.body`, so a test that opened two drawers in one
 * `it` was reading the FIRST one's body for both assertions — the second was passing no matter what
 * the map said, which a mutation of `office_approved` proved by staying green. `afterEach` alone is
 * not enough when a single test opens more than one. It is the trap B5's handoff names, met from the
 * other side: *teleported panels outlive the test*.
 */
async function openOn(key: string, invitationId: string | null = "invite-1") {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(`/recruitment/${DRIVER}`);
  await router.isReady();
  wrapper = mount(HiringStepDrawer, {
    props: {
      open: true,
      step: stepOf(key),
      driverId: DRIVER,
      driverStatus: "applicant",
      invitationId,
    },
    global: { plugins: [router, VueQueryPlugin], stubs: STUBS },
    attachTo: document.body,
  });
  await new Promise((r) => setTimeout(r, 0));
  return document.body;
}

const bodyOf = (root: HTMLElement) => root.querySelector("[data-body]")?.getAttribute("data-body");

/**
 * EVERY body rendered, in order.
 *
 * ⚠ `bodyOf` reads the first `[data-body]` and nothing else, which is fine for the bodies that are
 * one component and blind for the one that is not: the application body renders two stubs, so
 * `bodyOf` could never see the second and never noticed that `EmployerInquirySection` was in there.
 * An assertion about what a body does NOT contain has to enumerate.
 */
const bodies = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-body]")].map((el) => el.getAttribute("data-body"));

describe("a row opens the work behind the step", () => {
  it("opens the invitation for the step that sends it", async () => {
    expect(bodyOf(await openOn("invitation_sent"))).toBe("invite");
  });

  /**
   * ⚠ **Q-HUI6, closed.** B5 recorded that nothing in the office's half of the product showed a
   * signed authorization — the read endpoint existed and no screen called it — and refused to point
   * the artifact at a page showing something else. This is the row that now opens them.
   */
  it("opens the signed releases for the permissions step, which had no screen at all before B6", async () => {
    expect(bodyOf(await openOn("permissions_signed"))).toBe("authorizations");
  });

  /**
   * AF3/D-AF8: the date of birth and licence are given with the permissions, and the office corrects
   * them here — before ordering PSP on them. Only with an invitation: the correction writes the
   * draft of one invitation, and there is no draft without one.
   */
  /** AF4: the office's act between screening and the form has its own body — and needs an invitation. */
  it("opens the send panel for the application-sent step, and only when there is an invitation", async () => {
    expect(bodies(await openOn("application_sent"))).toEqual(["send"]);
    expect(bodies(await openOn("application_sent", null))).toEqual([]);
  });

  it("puts the identity correction under the releases, and only when there is an invitation", async () => {
    expect(bodies(await openOn("permissions_signed"))).toEqual(["authorizations", "identity"]);
    expect(bodies(await openOn("permissions_signed", null))).toEqual(["authorizations"]);
  });

  /**
   * ⚠ **The binding, not just the body** (B2). The releases panel is driver-keyed and the printable
   * copy of them is invitation-keyed, so the panel cannot find the invitation for itself — the page
   * resolves it and this drawer hands it down. Every body here is stubbed to its own name, which
   * means a dropped prop renders exactly the same stub and no assertion about WHICH body opened
   * could ever see it: the printed document would simply never be offered.
   */
  it("hands the live invitation down to the releases panel, which is what the printed copy needs", async () => {
    const root = await openOn("permissions_signed", "invite-9");
    // The stub declares no props, so the binding arrives as a fall-through ATTRIBUTE and keeps its
    // kebab spelling — which is also what makes it visible to a test at all.
    expect(root.querySelector("[data-body='authorizations']")?.getAttribute("invitation-id"))
      .toBe("invite-9");
  });

  /**
   * ⚠ Both application steps land on the application, and that is the ruling rather than a
   * coincidence: the office's act at step 4 IS reading what was filed at step 3 and approving it.
   */
  it("opens the application for both the filling and the approving step", async () => {
    expect(bodyOf(await openOn("application_filled"))).toBe("employment");
    expect(bodyOf(await openOn("office_approved"))).toBe("employment");
  });

  it("opens the PSP ledger for the PSP step", async () => {
    expect(bodyOf(await openOn("psp"))).toBe("psp");
  });

  /**
   * ⚠ **Q-HM9, and this test is the half the type system could not reach.** The §391.23(a)(2)
   * investigation became a step on 2026-09-18, and `EmployerInquirySection` moved out of the
   * application body — where B6 had parked it for want of a row to hang it on — and behind the new
   * one. `hiringStepDrawers.ts` is a `Record` over a closed union, so the compiler forced an entry
   * to exist; nothing in the compiler could check that the entry renders the right component.
   *
   * ⚠ And the assertion below has to be `bodies`, not `bodyOf`. The application body renders TWO
   * stubs and `bodyOf` returns only the first, which is why the inquiry section sat inside it for a
   * whole step unasserted: a test reading the first child would have gone green whether the section
   * moved or not. That is this file's own teleport lesson met from a different direction.
   */
  it("opens the inquiries for the investigation step, and no longer for the application", async () => {
    expect(bodyOf(await openOn("employment_investigation"))).toBe("inquiry");
    expect(bodies(await openOn("application_filled"))).toEqual(["employment"]);
  });
});

describe("the three recorded acts D1 built (D-HM6)", () => {
  /**
   * ⚠ **The switch, and it is the whole of D1's UI decision.** Three steps stopped being signposts on
   * 2026-09-19 and started performing the act. Each is asserted by name rather than looped, because
   * the interesting property is that these three moved and the neighbours did not.
   */
  it("opens the recording panel for the MVR, the Clearinghouse query and the drug test", async () => {
    for (const key of ["mvr", "clearinghouse", "drug_test"]) {
      expect(bodyOf(await openOn(key)), key).toBe("record");
    }
  });

  /**
   * ⚠ The panel cannot ask the drawer which step it is showing — it is handed the key, NARROWED, and
   * whether the step is already green. A dropped `step` prop renders the identical stub, so no
   * assertion about which body opened could ever see it: the panel would file the wrong kind, or
   * offer a form under a finished step (D-HUI5).
   */
  it("hands the panel the narrowed step and whether it is already done", async () => {
    const root = await openOn("clearinghouse");
    const panel = root.querySelector("[data-body='record']");
    expect(panel?.getAttribute("step")).toBe("clearinghouse");
    expect(panel?.getAttribute("done")).toBe("false");

    /**
     * ⚠ **Both values, and the second half is here because a mutation survived without it.** The
     * fixture above has no qualification records, so every one of these three steps is outstanding —
     * and `:done="false"` hard-coded reads identically to the real binding against it. A step that IS
     * done has to appear in this test or the binding is unasserted, and the panel would go on asking
     * for a record it already holds (D-HUI5).
     */
    const filed = hiringChecklist({ ...COMPLETE, qualificationKinds: ["mvr"] }).steps.find(
      (s) => s.key === "mvr",
    )!;
    expect(filed.state).toBe("done");
    wrapper?.unmount();
    document.body.innerHTML = "";
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(`/recruitment/${DRIVER}`);
    await router.isReady();
    wrapper = mount(HiringStepDrawer, {
      props: { open: true, step: filed, driverId: DRIVER, driverStatus: "applicant", invitationId: null },
      global: { plugins: [router, VueQueryPlugin], stubs: STUBS },
      attachTo: document.body,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.querySelector("[data-body='record']")?.getAttribute("done")).toBe("true");
  });
});

describe("the steps with no affordance yet say so, and point at the act", () => {
  /**
   * ⚠ The honest half of B6, now four rows rather than seven. The medical certificate is the case
   * that remains after D1 and it is NOT a backlog entry: Q-HM11 has to rule whether §391.51(b)(8)'s
   * registry verification applies to a CDL holder at all before this product offers to record one.
   * A drawer opening onto nothing would be the "invent a capability" failure; a drawer that names the
   * artifact and links the §391.51 file where the act is performed today is a signpost, and says so.
   */
  it("names the artifact and links the qualification file for a recorded act", async () => {
    const root = await openOn("medical_certificate");
    expect(root.textContent).toContain("Registry check");
    const link = [...root.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("qualification file"),
    );
    expect(link?.getAttribute("href")).toBe(`/drivers/${DRIVER}?section=qualification`);
  });

  /**
   * ⚠ It must NOT claim the office can see the signing. The driver signs on their own link and C1
   * builds the office's view; saying otherwise is the medical-certificate mistake in a new place.
   */
  it("says the packet is signed on the applicant's own link", async () => {
    const root = await openOn("application_signed");
    expect(root.textContent).toContain("their own link");
  });
});

describe("what the drawer says about the step itself", () => {
  /** ⚠ The title and subtitle are the catalogue's `label` and `action` — never a third string. */
  it("titles the drawer with the step and subtitles it with the instruction", async () => {
    const root = await openOn("mvr");
    expect(root.textContent).toContain("Driving record");
    expect(root.textContent).toContain("Order the driving record");
  });

  /**
   * ⚠ ...but only while there is still something to do. `action` is an imperative, and under a
   * finished step it reads as an order to redo it — *"Permissions signed / Sign the permissions /
   * Done"*. Found by opening the drawer, not by a test: an assertion that the instruction is present
   * cannot see that it is present at the wrong moment.
   */
  it("drops the instruction once the step is done", async () => {
    // `invitation_sent` and not `permissions_signed`: this fixture sets `invitedAt` and no
    // authorizations, so only the first of those is actually done. A fixture chosen for its name
    // rather than its state is how an assertion about "done" gets made about something that is not.
    expect(stepOf("invitation_sent").state).toBe("done");
    const root = await openOn("invitation_sent");
    expect(root.textContent).toContain("Invitation sent");
    expect(root.textContent).not.toContain("Send the invitation");
  });

  /** A blocked step names its blocker here too, in the same words the row used. */
  it("names the blocker in the drawer, in the row's own words", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(`/recruitment/${DRIVER}`);
    await router.isReady();
    const blocked = hiringChecklist({ invitedAt: "2026-09-01T00:00:00Z" }).steps.find(
      (s) => s.key === "mvr",
    )!;
    expect(blocked.state).toBe("blocked");
    wrapper = mount(HiringStepDrawer, {
      props: {
        open: true,
        step: blocked,
        driverId: DRIVER,
        driverStatus: "applicant",
        invitationId: null,
      },
      global: { plugins: [router, VueQueryPlugin], stubs: STUBS },
      attachTo: document.body,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain("Needs: Permissions signed");
  });

  /**
   * ⚠ No live invitation means no button, not a button that opens nothing. An applicant whose link
   * was revoked has no application to read, and offering one would produce the API's refusal.
   */
  it("offers no application to open when there is no live invitation", async () => {
    const root = await openOn("application_filled", null);
    expect(root.textContent).toContain("no live invitation");
    expect([...root.querySelectorAll("button")].some((b) => b.textContent?.includes("Open the application")))
      .toBe(false);
  });
});
