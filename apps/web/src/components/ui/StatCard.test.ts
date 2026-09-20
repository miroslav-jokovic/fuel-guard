import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { TruckIcon } from "@silvicom/ui/icons";
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
    // D-DR2 moved this from font-semibold to font-bold. Not a drift: §2.3 reserves font-bold for
    // KPI numbers and font-semibold for headings, and this is a KPI number that wore the heading's
    // weight until 2026-09-16.
    expect(ps[1]!.classes()).toEqual(expect.arrayContaining(["text-3xl", "font-bold"]));
    expect(ps[1]!.classes()).not.toContain("text-2xl");
    expect(ps[1]!.classes()).not.toContain("font-semibold");
  });

  /**
   * The two hero layouts, kept apart on purpose (D-DR2).
   *
   * `spark-inline` is what the dashboard's glance tiles opt into; `FleetHeadlines` deliberately does
   * not, because its captions are sentences (D-FRUI3) and a halved text column wraps them. If those
   * two ever collapse into one layout, one of those two pages is being badly served — so the
   * difference is asserted rather than left to whoever edits the template next.
   */
  it("puts the spark beside the value only when the caller asks, and under the tile otherwise", () => {
    const spark = { spark: [1, 2, 3], sparkColor: "#000", size: "hero" as const };

    const below = mountCard(spark);
    expect(below.find(".mt-3 svg").exists()).toBe(true);

    const inline = mountCard({ ...spark, sparkInline: true });
    expect(inline.find(".w-20 svg").exists()).toBe(true);
    expect(inline.find(".mt-3 svg").exists()).toBe(false);
  });

  /**
   * The inline spark must YIELD when the tile is too narrow for both it and the label (D-DR17).
   *
   * ⚠ This asserts the two classes that produce the behaviour rather than the behaviour itself,
   * because jsdom has no layout engine — every width here is 0, so a wrap cannot be observed in a
   * unit test. The behaviour was measured in a real browser instead, and the numbers are worth
   * keeping: at a 220px tile (the `xl:grid-cols-4` case at 1280px viewport) the label needed 91px
   * and the old fixed `w-2/5` reservation left it 61, so "Fleet avg MPG" rendered as "Fleet a…".
   * With `flex-wrap` and the `min-w-32` floor the spark drops to its own line and the label gets
   * the full 128px; at a 325px tile it stays inline. Remove either class and the truncation
   * returns silently, because the label wears `truncate`.
   */
  it("lets the inline spark wrap instead of squeezing the label", () => {
    const inline = mountCard({ spark: [1, 2, 3], sparkColor: "#000", size: "hero", sparkInline: true });
    const row = inline.get(".flex-wrap");
    expect(row.classes()).toContain("flex");
    // The label column keeps a floor, which is what forces the wrap rather than a squeeze.
    expect(row.find(".min-w-32").exists()).toBe(true);
    // And the spark is allowed to grow into the space when it does fit beside the number.
    expect(inline.get(".w-20").classes()).toContain("grow");
  });

  /**
   * The chip changes SIZE between the two anatomies and no longer changes SIDE (D-DT21). It did
   * until 2026-09-20, and the Dashboard is where that cost was paid: the hero row led with its
   * chips and the operating-metric strip beneath it trailed with its own, which reads as two
   * components rather than one. Asserting the chip precedes the label in BOTH anatomies is what
   * stops the split being reintroduced as a local tidy-up on one of the fourteen KPI surfaces.
   */
  it("leads with the icon chip in both anatomies", () => {
    const icon = { icon: TruckIcon, tone: "success" };
    // The claim is ORDER, so the marker is the icon itself rather than the chip's size class.
    // Asserting `size-11` here made this fail the day the chip became `size-10` for fidelity to the
    // comp — a test reporting a deliberate resize as a broken layout is a test measuring the wrong
    // thing. `<svg>` is the icon and it renders only inside the chip.
    const posOf = (html: string) => ({ icon: html.indexOf("<svg"), label: html.indexOf("Files with work left") });

    const hero = posOf(mountCard({ ...icon, size: "hero" }).html());
    expect(hero.icon).toBeGreaterThan(-1);
    expect(hero.icon).toBeLessThan(hero.label);

    const kpi = posOf(mountCard(icon).html());
    expect(kpi.icon).toBeGreaterThan(-1);
    expect(kpi.icon).toBeLessThan(kpi.label);
  });

  it("omits the icon chip entirely when no icon is given", () => {
    expect(mountCard({}).find("svg").exists()).toBe(false);
    expect(mountCard({ icon: TruckIcon, tone: "success" }).find("svg").exists()).toBe(true);
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
