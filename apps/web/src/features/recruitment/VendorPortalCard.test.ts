import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { HIRING_VENDOR_PORTALS } from "@silvicom/shared";
import VendorPortalCard from "@/features/recruitment/VendorPortalCard.vue";

/** §14 D-OF8 (owner, 2026-11-03): the MVR opens SambaSafety, the query opens the Clearinghouse — in a new tab. */
describe("VendorPortalCard", () => {
  it("opens SambaSafety for the driving record, in a new tab that cannot reach back", () => {
    const a = mount(VendorPortalCard, { props: { step: "mvr" } }).get("[data-testid=vendor-portal-link]");
    expect(a.attributes("href")).toBe("https://sambasafety.com/customer-portal");
    expect(a.attributes("target")).toBe("_blank");
    expect(a.attributes("rel")).toContain("noopener");
    expect(a.text()).toContain("SambaSafety");
  });

  it("opens the Clearinghouse for the query, and says the driver consents in their own account", () => {
    const w = mount(VendorPortalCard, { props: { step: "clearinghouse" } });
    expect(w.get("[data-testid=vendor-portal-link]").attributes("href")).toBe("https://clearinghouse.fmcsa.dot.gov/");
    expect(w.text()).toContain("must give consent there");
  });

  it("renders nothing for a step done without a portal", () => {
    expect(mount(VendorPortalCard, { props: { step: "drug_test" } }).find("[data-testid=vendor-portal]").exists()).toBe(false);
  });

  it("serves every portal over https", () => {
    for (const p of Object.values(HIRING_VENDOR_PORTALS)) expect(p!.url.startsWith("https://")).toBe(true);
  });
});
