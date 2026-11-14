import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { ApplicationCaptureView, FcraSummary, PartOneStatus } from "@silvicom/shared";
import { usePartOne, type PartOneInputs } from "./usePartOne";
import { usePartOneWizard } from "./usePartOneWizard";

/**
 * Part 1 one question per screen (F4 PR 1, D-AM2): the screens are the catalogue's, a screen's Continue
 * asks only its own share of the page's check and writes nothing, and the page still saves as it did —
 * on its last screen, through `usePartOne` (whose own tests pin what is written).
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const ok = () => ({ ok: true, json: async () => ({ ok: true, keptExisting: [] }) }) as Response;
const TOKEN = "t".repeat(43);
const cap = (slot: string) => ({ slot, capturedAt: "2026-09-27T10:00:00Z" }) as ApplicationCaptureView;
const status: PartOneStatus = {
  completedAt: null, contact: false, address: false, licences: false, screening: false,
  medicalCardPending: false, rights: false,
};

function walk() {
  const inputs = ref<PartOneInputs>({
    status, identityComplete: false, captures: [cap("cdl_front"), cap("cdl_back")],
    summary: { version: "v" } as FcraSummary,
  });
  const flow = usePartOne(ref(TOKEN), inputs, async () => inputs.value, vi.fn(), async () => null);
  return { flow, wizard: usePartOneWizard(flow) };
}

/** Continue, then let the page-change watcher run, as a render would. */
async function press(wizard: ReturnType<typeof walk>["wizard"]): Promise<void> {
  await wizard.next();
  await nextTick();
}
const on = (w: ReturnType<typeof walk>) => w.wizard.current.value?.id ?? w.flow.screen.value;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
});

describe("one question per screen", () => {
  it("asks the phone, then the date of birth, on screens of their own — writing nothing between", async () => {
    const w = walk();
    expect(on(w)).toBe("about.phone");
    await press(w.wizard);
    // Only this screen's problem: the date of birth is not on it, and is not complained about.
    expect(w.flow.errors.value).toEqual({ phone: expect.any(String) });
    expect(on(w)).toBe("about.phone");

    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    expect(on(w)).toBe("about.date_of_birth");
    expect(w.flow.errors.value).toEqual({});

    w.flow.answers.date_of_birth = "1985-03-07";
    await press(w.wizard);
    expect(on(w)).toBe("address.home");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("walks the CDL as its card, its class, its expiration and its endorsements", async () => {
    const w = walk();
    Object.assign(w.flow.answers, { phone: "7082365732", date_of_birth: "1985-03-07", address_line1: "1 Main St", city: "Joliet", state: "IL", postal_code: "60432" });
    for (let i = 0; i < 3; i++) await press(w.wizard);
    expect(on(w)).toBe("licence.card");
    const seen: string[] = [];
    Object.assign(w.flow.answers.cdl, { state_code: "IL", licence_number: "D123", cdl_class: "A", expires_on: "2029-01-01" });
    while (w.flow.screen.value === "licence") {
      seen.push(on(w));
      await press(w.wizard);
    }
    expect(seen).toEqual(["licence.card", "licence.class", "licence.expires", "licence.endorsements"]);
    expect(on(w)).toBe("otherLicences");
  });

  it("asks the 6- and 12-month questions only after a yes to the 30-day one", async () => {
    const w = walk();
    w.flow.answers.dot_program_30d = false;
    expect(w.wizard.steps.value).toBe(16);
    w.flow.answers.dot_program_30d = true;
    // Two more screens: 1.12 and 1.13.
    expect(w.wizard.steps.value).toBe(18);
  });

  it("goes Back screen by screen, and into the previous page at its last screen", async () => {
    const w = walk();
    Object.assign(w.flow.answers, { phone: "7082365732", date_of_birth: "1985-03-07" });
    await press(w.wizard);
    await press(w.wizard);
    expect(on(w)).toBe("address.home");
    expect(w.wizard.step.value).toBe(5);
    w.wizard.back();
    await nextTick();
    expect(on(w)).toBe("about.date_of_birth");
    expect(w.wizard.step.value).toBe(4);
    w.wizard.back();
    await nextTick();
    expect(on(w)).toBe("about.phone");
  });

  it("takes the driver to the screen holding the problem when the page's own Continue refuses", async () => {
    const w = walk();
    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    // The phone is emptied by some other path (a restored copy, a Back and an edit): the page's check finds it.
    Object.assign(w.flow.answers, { phone: "", date_of_birth: "1985-03-07" });
    await press(w.wizard);
    expect(on(w)).toBe("about.phone");
    expect(w.flow.errors.value).toHaveProperty("phone");
  });

  it("says the barcode filled a box only on the screen that shows it", async () => {
    const w = walk();
    w.flow.fromLicence.value = ["date_of_birth"];
    // U2: the read is confirmed first; this driver says the date is wrong, so its screen is asked.
    w.wizard.toggleFix("date_of_birth");
    await press(w.wizard);
    expect(w.wizard.prefilledHere.value).toBe(false);
    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    expect(w.wizard.prefilledHere.value).toBe(true);
  });

  it("shows a problem no screen of the page holds, rather than dropping it", async () => {
    const w = walk();
    w.flow.errors.value = { agency: "Enter the issuing authority." };
    expect(w.wizard.stray.value).toEqual(["Enter the issuing authority."]);
    w.flow.errors.value = { phone: "Enter your mobile phone number." };
    expect(w.wizard.stray.value).toEqual([]);
  });
});

/**
 * "Is this right?" (U2, SCREEN-MAP 1.4): what the barcode read is confirmed on one screen, and a
 * confirmed fact is not asked again.
 */
describe("the scan, confirmed once", () => {
  const SCANNED = {
    date_of_birth: "1985-03-07", address_line1: "1 Main St", address_line2: "", city: "Joliet", state: "IL", postal_code: "60432",
  };
  const ALL = ["date_of_birth", "address_line1", "city", "state", "postal_code", "cdl.state_code", "cdl.licence_number", "cdl.expires_on"] as const;
  function scanned() {
    const w = walk();
    Object.assign(w.flow.answers, SCANNED);
    Object.assign(w.flow.answers.cdl, { state_code: "IL", licence_number: "D123", expires_on: "2029-01-01" });
    w.flow.fromLicence.value = [...ALL];
    return w;
  }

  it("asks nothing new of a link whose barcode read nothing", () => {
    const w = walk();
    expect(w.wizard.confirming.value).toBe(false);
    expect(on(w)).toBe("about.phone");
  });

  it("opens on the confirmation, listing each fact the barcode read whole", () => {
    const w = scanned();
    expect(w.wizard.confirming.value).toBe(true);
    expect(w.wizard.current.value).toBeNull();
    expect(w.wizard.offered.value).toEqual(["date_of_birth", "address", "licence", "expires_on"]);
  });

  it("does not offer a fact the barcode half-read: a number with no issuing state is asked", () => {
    const w = scanned();
    w.flow.fromLicence.value = ALL.filter((f) => f !== "cdl.state_code");
    expect(w.wizard.offered.value).toEqual(["date_of_birth", "address", "expires_on"]);
  });

  it("⚠ a Yes skips every confirmed screen: the phone, then straight to the class and the endorsements", async () => {
    const w = scanned();
    await press(w.wizard);
    expect(on(w)).toBe("about.phone");
    w.flow.answers.phone = "7082365732";
    const seen: string[] = [];
    while (w.flow.screen.value !== "otherLicences") {
      seen.push(on(w));
      if (on(w) === "licence.class") w.flow.answers.cdl.cdl_class = "A";
      await press(w.wizard);
      // The address page has no screen left: it is passed through its own Continue (a watcher's await).
      await vi.waitFor(() => expect(w.flow.screen.value).not.toBe("address"));
    }
    expect(seen).toEqual(["about.phone", "licence.class", "licence.endorsements"]);
    // Nothing was skipped past its check: all three held pages were passed by their own Continue.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks only the fact the driver tapped Change on, with the read value still in its box", async () => {
    const w = scanned();
    w.wizard.toggleFix("address");
    await press(w.wizard);
    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    expect(on(w)).toBe("address.home");
    expect(w.flow.answers.city).toBe("Joliet");
    expect(w.wizard.prefilledHere.value).toBe(true);
  });

  it("a Change tapped twice is a fact kept as read", async () => {
    const w = scanned();
    w.wizard.toggleFix("address");
    w.wizard.toggleFix("address");
    await press(w.wizard);
    expect(w.flow.scanConfirmed.value).toEqual(["date_of_birth", "address", "licence", "expires_on"]);
  });

  it("⚠ brings back the screen of a confirmed fact the page's own check refuses", async () => {
    const w = scanned();
    // A barcode can hold what the contract refuses: this applicant is under 18.
    w.flow.answers.date_of_birth = "2015-03-07";
    await press(w.wizard);
    expect(on(w)).toBe("about.phone");
    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    expect(on(w)).toBe("about.date_of_birth");
    expect(w.flow.errors.value).toHaveProperty("date_of_birth");
    expect(w.flow.scanConfirmed.value).toEqual(["address", "licence", "expires_on"]);
  });

  it("⚠ stays on a page with no screen left when its check refuses, and shows the screen", async () => {
    const w = scanned();
    w.flow.answers.postal_code = "6043";
    await press(w.wizard);
    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    await vi.waitFor(() => expect(on(w)).toBe("address.home"));
    expect(w.flow.errors.value).toHaveProperty("postal_code");
  });

  it("goes Back from the first question to the confirmation as it was left, and from there to the photo", async () => {
    const w = scanned();
    w.wizard.toggleFix("expires_on");
    await press(w.wizard);
    expect(on(w)).toBe("about.phone");
    w.wizard.back();
    await nextTick();
    expect(w.wizard.confirming.value).toBe(true);
    expect(w.wizard.fixing.value).toEqual(["expires_on"]);
    w.wizard.back();
    await nextTick();
    expect(w.flow.screen.value).toBe("cdl_back");
  });

  it("goes Back over a page the scan answered whole, to the page before it", async () => {
    const w = scanned();
    await press(w.wizard);
    w.flow.answers.phone = "7082365732";
    await press(w.wizard);
    await vi.waitFor(() => expect(on(w)).toBe("licence.class"));
    w.wizard.back();
    await vi.waitFor(() => expect(on(w)).toBe("about.phone"));
  });

  it("counts the confirmation as a step and leaves the skipped screens out of the total", async () => {
    const w = scanned();
    const plain = walk().wizard.steps.value;
    // One more screen (the confirmation) while nothing is confirmed.
    expect(w.wizard.steps.value).toBe(plain + 1);
    expect(w.wizard.step.value).toBe(3);
    await press(w.wizard);
    // Four screens gone: the date of birth, the address, the CDL's card and its expiration.
    expect(w.wizard.steps.value).toBe(plain + 1 - 4);
    expect(w.wizard.step.value).toBe(4);
  });
});
