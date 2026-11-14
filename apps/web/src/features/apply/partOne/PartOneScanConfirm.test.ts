import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PartOneScanConfirm from "./PartOneScanConfirm.vue";
import { emptyPartOneAnswers, type ScanFact } from "./partOneScreens";
import { APPLY_COPY } from "@/features/apply/strings";

/** "Is this right?" (U2, SCREEN-MAP 1.4): each scanned fact read back once, as it will be filed. */
const answers = () => ({
  ...emptyPartOneAnswers(),
  date_of_birth: "1986-06-06", address_line1: "2300 West Broad Street", address_line2: "", city: "Richmond", state: "VA", postal_code: "23269",
  cdl: { state_code: "VA", licence_number: "T64235789", cdl_class: "", expires_on: "2029-12-10", endorsements: [] },
});
const show = (offered: ScanFact[], fixing: ScanFact[] = []) =>
  mount(PartOneScanConfirm, { props: { answers: answers(), offered, fixing } });

describe("the scan's confirmation", () => {
  it("reads each offered fact back in the driver's date order, and lists no fact that was not read", () => {
    const w = show(["date_of_birth", "address", "expires_on"]);
    expect(w.findAll("[data-scan-fact]").map((r) => r.attributes("data-scan-fact"))).toEqual(["date_of_birth", "address", "expires_on"]);
    expect(w.find('[data-scan-fact="date_of_birth"]').text()).toContain("06/06/1986");
    expect(w.find('[data-scan-fact="address"]').text()).toContain("Richmond, VA 23269");
    expect(w.text()).not.toContain("T64235789");
  });

  it("leaves out the apartment line of a home that has none", () => {
    expect(show(["address"]).findAll('[data-scan-fact="address"] p.text-base')).toHaveLength(2);
  });

  it("names each button by its fact, and says which one was tapped", async () => {
    const w = show(["date_of_birth", "licence"], ["licence"]);
    const [dob, licence] = w.findAll("button");
    expect(dob!.attributes("aria-label")).toBe(APPLY_COPY.partOne.scan.changeNamed("Date of birth"));
    expect(dob!.attributes("aria-pressed")).toBe("false");
    expect(licence!.attributes("aria-pressed")).toBe("true");
    expect(w.find('[data-scan-fact="licence"]').text()).toContain(APPLY_COPY.partOne.scan.willAsk);
    expect(w.find('[data-scan-fact="date_of_birth"]').text()).not.toContain(APPLY_COPY.partOne.scan.willAsk);
    await dob!.trigger("click");
    expect(w.emitted("toggle")).toEqual([["date_of_birth"]]);
  });
});
