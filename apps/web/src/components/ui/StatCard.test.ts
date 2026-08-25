import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { TruckIcon } from "@fuelguard/ui/icons";
import StatCard from "@/components/ui/StatCard.vue";

/**
 * The tile's anatomy, pinned by a test rather than by a document (U3, D-UI2).
 *
 * Four surfaces each hand-rolled a subset of this component and each disagreed with
 * `docs/DESIGN-SYSTEM-CONTRACT.md` §2.4 in a different way — one made the label a body role, one
 * made the value `text-lg`, one rendered no card at all. Prose could not stop that happening again;
 * these assertions can. They quote §2.4's class strings deliberately: if the contract moves, this
 * fails and somebody has to reconcile the two on purpose.
 */
const RouterLinkStub = { template: "<a :href='to'><slot /></a>", props: ["to"] };
const mountCard = (props: Record<string, unknown>) =>
  mount(StatCard, { props: { label: "Files with work left", value: 12, ...props }, global: { stubs: { RouterLink: RouterLinkStub } } });

describe("StatCard anatomy", () => {
  /** §2.4: KPI label `text-xs font-medium tracking-wide text-ink-muted uppercase`, value
   *  `mt-1 text-2xl font-bold text-ink`, sub-caption `mt-0.5 text-xs text-ink-tertiary`. */
  it("renders the contract's KPI row by default", () => {
    const w = mountCard({ sub: "drivers blocked" });
    const label = w.get("p").classes();
    expect(label).toEqual(expect.arrayContaining(["text-xs", "font-medium", "uppercase", "tracking-wide", "text-ink-muted"]));

    const ps = w.findAll("p");
    expect(ps[1]!.classes()).toEqual(expect.arrayContaining(["mt-1", "text-2xl", "font-bold", "text-ink"]));
    expect(ps[2]!.classes()).toEqual(expect.arrayContaining(["mt-0.5", "text-xs", "text-ink-tertiary"]));
    expect(w.text()).toContain("12");
  });

  /** §2.2's size census lists text-3xl as "StatCard value" — the dashboard hero is the sanctioned
   *  exception, so the component carries both rather than flattening one into the other. */
  it("renders the dashboard's hero anatomy under size=hero", () => {
    const ps = mountCard({ size: "hero" }).findAll("p");
    expect(ps[0]!.classes()).toEqual(expect.arrayContaining(["text-sm", "font-medium", "text-ink-muted"]));
    expect(ps[0]!.classes()).not.toContain("uppercase");
    expect(ps[1]!.classes()).toEqual(expect.arrayContaining(["text-3xl", "font-semibold"]));
    expect(ps[1]!.classes()).not.toContain("text-2xl");
  });

  it("omits the icon chip entirely when no icon is given", () => {
    expect(mountCard({}).find("svg").exists()).toBe(false);
    expect(mountCard({ icon: TruckIcon, tone: "text-success-600 bg-success-50" }).find("svg").exists()).toBe(true);
  });

  it("is inert markup with no `to` and no `pressed`", () => {
    const w = mountCard({});
    expect(w.find("a").exists()).toBe(false);
    expect(w.find("button").exists()).toBe(false);
  });

  it("becomes a link that drills into its detail page when given `to`", () => {
    expect(mountCard({ to: "/compliance" }).find("a").attributes("href")).toBe("/compliance");
  });

  describe("toggle mode", () => {
    /** ⚠ D-UI5: the pressed state is aria-pressed and the ring, and NOTHING else. The qualification
     *  strip used to render a status badge reading "filter"/"filtering" as the affordance label. */
    it("carries its state in aria-pressed, not in a badge", () => {
      const off = mountCard({ pressed: false });
      const on = mountCard({ pressed: true });

      expect(off.get("button").attributes("aria-pressed")).toBe("false");
      expect(on.get("button").attributes("aria-pressed")).toBe("true");
      expect(on.get("button").classes()).toContain("ring-brand-600");
      expect(off.get("button").classes()).not.toContain("ring-brand-600");

      for (const w of [off, on]) {
        expect(w.text()).not.toContain("filtering");
        expect(w.text()).not.toContain("filter");
      }
    });

    it("emits toggle on click", async () => {
      const w = mountCard({ pressed: false });
      await w.get("button").trigger("click");
      expect(w.emitted("toggle")).toHaveLength(1);
    });
  });

  it("shows skeletons instead of a stale value while loading", () => {
    const w = mountCard({ loading: true });
    expect(w.text()).not.toContain("12");
    expect(w.findAll(".animate-pulse")).toHaveLength(2);
  });
});

describe("subTone", () => {
  it("colours the sub-line when the caller says which direction is bad", () => {
    // Spend up is bad, MPG up is good — only the caller knows, so the tone is a class and not an enum.
    const up = mount(StatCard, { props: { label: "Fuel spend", value: "$303,707", sub: "+15.7% vs prior week", subTone: "text-danger-700" } });
    expect(up.get("p.text-danger-700").text()).toContain("+15.7%");
  });

  it("stays the quiet default when no tone is given, so existing tiles are unchanged", () => {
    const plain = mount(StatCard, { props: { label: "Gallons", value: "57,696", sub: "4 weeks" } });
    expect(plain.get("p.text-ink-tertiary").text()).toContain("4 weeks");
  });
});
