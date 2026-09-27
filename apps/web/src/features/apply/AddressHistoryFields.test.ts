import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { emptyAddress, emptyDraft, type ApplicationDraft, type DraftAddress } from "./draft";
import AddressHistoryFields from "./AddressHistoryFields.vue";
import { APPLY_COPY } from "./strings";

/**
 * §391.21(b)(3) on the screen (C3c1): the months the list does not cover, from `addressCoverage` — the
 * arithmetic a v2 filing refuses on — over the addresses as they would be FILED. 09/26/2026 opens the
 * window in 09/2023.
 */
const AS_OF = "2026-09-26";
const copy = APPLY_COPY.addresses;
const at = (from: string, to: string, over: Partial<DraftAddress> = {}): DraftAddress =>
  ({ ...emptyAddress(), line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from, to, ...over });
const screen = (addresses: DraftAddress[]) =>
  mount(AddressHistoryFields, { props: { modelValue: { ...emptyDraft(), addresses } as ApplicationDraft, asOf: AS_OF } });

describe("the three years of addresses (C3c1)", () => {
  it("names the months with no address", () => {
    const w = screen([at("2025-02", "")]);
    expect(w.text()).toContain(copy.gap("09/2023", "01/2025"));
    expect(w.text()).not.toContain(copy.coverageComplete);
  });

  it("says when every month is covered", () => {
    const w = screen([at("2020-01", "2024-05"), at("2024-06", "")]);
    expect(w.text()).toContain(copy.coverageComplete);
  });

  it("does not count a row with no street and no city, which is never filed", () => {
    const w = screen([at("2020-01", "", { line1: "", city: "" })]);
    expect(w.text()).toContain(copy.gap("09/2023", "09/2026"));
  });
});
