import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { ref } from "vue";
import type { RoadsideAttributionDecision, RoadsideAttributionDto, RoadsideAttributionReadingDto } from "@silvicom/shared";
import { ROUTE_TABLE } from "@/router/table";

/**
 * Who was driving, on the Inspection page (IC5, plan §6). What it can get wrong that the API's tests
 * would not see:
 *
 *   1. **A Samsara driver the roster lacks shows a roster name**, or no name — D-IC7's guessed driver.
 *   2. **A weak reading looks settled**: the badge must say a person is needed.
 *   3. **The instant is shown on the reader's clock** instead of the inspection's own zone.
 *   4. **The buttons show to a reader without the manage level**, or Confirm shows where there is
 *      nothing to confirm.
 *   5. **A correction goes out without its note, or against a row the page did not show** (`basedOn`).
 *   6. **"Someone decided first" reads as a failure** rather than as what happened.
 */

const mutate = vi.fn();
const decideError = ref<Error | null>(null);
let canManage = true;
vi.mock("./useRoadsideInspections", () => ({
  useDecideAttribution: () => ({ mutate, reset: vi.fn(), error: decideError, isPending: ref(false) }),
  AttributionDecisionError: class AttributionDecisionError extends Error {
    constructor(message: string, readonly code: string | null) {
      super(message);
    }
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: (s: string) => s === "safety" && canManage }) }));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/composables/useDrivers", async () => {
  const { ref: r } = await import("vue");
  return {
    useDriversQuery: () => ({
      data: r([
        { id: "d-ann", full_name: "Ann Roster", status: "active" },
        { id: "d-bob", full_name: "Bob Former", status: "terminated" },
      ]),
    }),
  };
});

const InspectionDriverCard = (await import("./InspectionDriverCard.vue")).default;
const { AttributionDecisionError } = await import("./useRoadsideInspections");

const reading = (o: Partial<RoadsideAttributionReadingDto> = {}): RoadsideAttributionReadingDto => ({
  id: "eng-1", engineVersion: "ic5.1", readAt: "2026-10-14T10:00:00Z", outcome: "one_driver", confidence: "high", basis: "bracketing",
  zone: "America/Denver", zoneMethod: "gps", startedAt: "2026-09-22T18:04:00Z", endedAt: "2026-09-22T18:42:00Z", locationCheck: "confirmed",
  samsaraDriver: { id: "s-ann", name: "Ann (Samsara)" }, driver: { id: "d-ann", name: "Ann Roster" }, candidates: [], ...o,
});
const attribution = (o: Partial<RoadsideAttributionDto> = {}): RoadsideAttributionDto => ({ reading: reading(), decision: null, basedOn: "eng-1", ...o });

async function card(a: RoadsideAttributionDto) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
  await router.push("/");
  const w = mount(InspectionDriverCard, { props: { inspectionId: "insp-1", attribution: a }, global: { plugins: [router] } });
  await flushPromises();
  return w;
}
const sent = (): RoadsideAttributionDecision => mutate.mock.calls.at(-1)![0];

beforeEach(() => {
  mutate.mockReset();
  decideError.value = null;
  canManage = true;
});

describe("the reading", () => {
  it("names our driver, says how the log places them, and gives the instant on the inspection's own clock", async () => {
    const w = await card(attribution());
    const text = w.get("[data-test='driver-reading']").text();
    expect(text).toContain("Ann Roster");
    expect(text).toContain("logged in on the truck just before and just after the inspection");
    // 18:04Z is 12:04 PM in Denver (MDT) — not the test machine's zone, so a card reading the
    // instant on the reader's own clock fails here as it would in a Chicago office.
    expect(w.get("[data-test='driver-when']").text()).toBe("Inspected 09/22/2026 12:04 PM – 12:42 PM MDT (time zone read from where the truck stood).");
    expect(w.get("[data-test='driver-badge']").text()).toBe("Strong reading");
  });

  it("shows a Samsara driver the roster lacks by Samsara's name, saying so", async () => {
    const w = await card(attribution({ reading: reading({ driver: null, confidence: "low", basis: "before_only" }) }));
    expect(w.get("[data-test='driver-reading']").text()).toContain("Ann (Samsara) — in Samsara, not on our roster");
    expect(w.get("[data-test='driver-badge']").text()).toBe("Needs a person");
  });

  it("lists who was on the truck when there were several, and offers no Confirm", async () => {
    const w = await card(attribution({
      reading: reading({
        outcome: "several_drivers", confidence: null, basis: null, samsaraDriver: null, driver: null,
        candidates: [
          { samsaraDriverId: "s-ann", name: "Ann (Samsara)", passenger: false, driver: { id: "d-ann", name: "Ann Roster" } },
          { samsaraDriverId: "s-cy", name: "Cy (Samsara)", passenger: true, driver: null },
        ],
      }),
    }));
    expect(w.get("[data-test='driver-candidates']").text()).toMatch(/Ann Roster[\s\S]*Cy \(Samsara\) \(not on our roster\) — co-driver/);
    expect(w.find("[data-test='driver-confirm']").exists()).toBe(false);
    expect(w.get("[data-test='driver-choose']").text()).toBe("Choose the driver");
    expect(w.get("[data-test='driver-badge']").text()).toBe("Needs a person");
  });

  it("says the engine has not read it yet, with nothing to decide", async () => {
    const w = await card({ reading: null, decision: null, basedOn: null });
    expect(w.find("[data-test='driver-pending']").exists()).toBe(true);
    expect(w.find("[data-test='driver-actions']").exists()).toBe(false);
  });
});

describe("a person's decision", () => {
  it("shows a correction with who made it and why, and says when the reading has been redone since", async () => {
    const w = await card(attribution({
      reading: reading({ engineVersion: "ic5.2" }),
      decision: { id: "p-1", kind: "corrected", driver: { id: "d-bob", name: "Bob Former" }, decidedBy: "Sam Safety", decidedAt: "2026-10-14T15:00:00Z", note: "Bob signed the report", engineVersion: "ic5.1" },
      basedOn: "eng-2",
    }));
    const text = w.get("[data-test='driver-decision']").text();
    expect(text).toMatch(/Corrected to\s+Bob Former\s+by Sam Safety on 10\/14\/2026/);
    expect(text).toContain("“Bob signed the report”");
    expect(w.find("[data-test='driver-decision-older']").exists()).toBe(true);
    expect(w.get("[data-test='driver-badge']").text()).toBe("Corrected by a person");
  });

  it("offers no second Confirm of a reading already confirmed", async () => {
    const w = await card(attribution({
      decision: { id: "p-1", kind: "confirmed", driver: null, decidedBy: "Sam Safety", decidedAt: "2026-10-14T15:00:00Z", note: null, engineVersion: "ic5.1" },
      basedOn: "p-1",
    }));
    expect(w.find("[data-test='driver-confirm']").exists()).toBe(false);
    expect(w.get("[data-test='driver-choose']").text()).toBe("Choose a different driver");
  });
});

describe("deciding", () => {
  it("shows no buttons to a reader without the safety section's manage level", async () => {
    canManage = false;
    const w = await card(attribution());
    expect(w.find("[data-test='driver-actions']").exists()).toBe(false);
  });

  it("confirms over the row the page showed", async () => {
    const w = await card(attribution({ basedOn: "p-7" }));
    await w.get("[data-test='driver-confirm']").trigger("click");
    expect(sent()).toEqual({ action: "confirm", basedOn: "p-7" });
  });

  it("will not save a correction without a driver and a note, and sends the note trimmed", async () => {
    const w = await card(attribution());
    await w.get("[data-test='driver-choose']").trigger("click");
    const save = w.get("[data-test='driver-save']");
    expect(save.attributes("disabled")).toBeDefined();
    // The reading's own driver is not offered: choosing them is a confirmation.
    const combo = w.findComponent({ name: "AppCombobox" });
    expect((combo.props("options") as { value: string; label: string }[])).toEqual([{ value: "d-bob", label: "Bob Former (terminated)" }]);
    combo.vm.$emit("update:modelValue", "d-bob");
    await w.get("textarea").setValue("   ");
    expect(w.get("[data-test='driver-save']").attributes("disabled")).toBeDefined();
    await w.get("textarea").setValue("  Bob signed the report ");
    await w.get("[data-test='driver-form']").trigger("submit");
    expect(sent()).toEqual({ action: "correct", basedOn: "eng-1", driverId: "d-bob", note: "Bob signed the report" });
  });

  it("says someone else decided first, rather than that the save failed", async () => {
    decideError.value = new AttributionDecisionError("Who was driving has changed since this page was loaded.", "changed");
    const w = await card(attribution());
    expect(w.get("[data-test='driver-error']").text()).toMatch(/^Someone else decided while this page was open/);
    decideError.value = new AttributionDecisionError("That driver is not on our roster.", "unknown_driver");
    await flushPromises();
    expect(w.get("[data-test='driver-error']").text()).toBe("That driver is not on our roster.");
  });
});
