import { describe, expect, it } from "vitest";
import {
  dashboardLayoutSetSchema,
  inDefaultLayout,
  mergeTabLayout,
  resolveDashboardLayout,
  type StoredDashboardLayout,
} from "./dashboardLayoutContract.js";
import { section } from "./surfaces.js";
import type { DashboardWidget } from "./dashboardWidgets.js";
import type { UserRole } from "./constants.js";

/**
 * A fixture catalogue rather than the real one, on purpose. These tests are about what a stored row
 * MEANS, and pinning them to `DASHBOARD_WIDGETS` would make every future widget a failing test in a
 * file that has no opinion about the widget. The real catalogue is checked by `check-surfaces.mjs`
 * (D-DW4) and rendered by `dashboardEquivalence.test.ts`.
 *
 * ⚠ It is deliberately MIXED: two widgets everyone gets by default and one that names a role. A
 * fixture where every widget defaulted the same way would pass whether or not `inDefaultLayout` were
 * consulted at all — the failure this repo has measured more than once.
 */
const w = (key: string, defaultFor?: readonly UserRole[]): DashboardWidget => ({
  key,
  label: key,
  tab: "fleet",
  gate: section("fuel"),
  span: "full",
  ...(defaultFor ? { defaultFor } : {}),
});

const ALPHA = w("fleet.alpha");
const BETA = w("fleet.beta");
const MAP = w("dispatch.map", ["dispatcher"]);
const ALLOWED = [ALPHA, BETA, MAP] as const;

const keys = (out: DashboardWidget[]) => out.map((x) => x.key);
const stored = (over: Partial<StoredDashboardLayout> = {}): StoredDashboardLayout => ({
  widgetKeys: [],
  hiddenKeys: [],
  ...over,
});

describe("inDefaultLayout", () => {
  it("includes a widget with no defaultFor for every role, and for none", () => {
    expect(inDefaultLayout(ALPHA, "dispatcher")).toBe(true);
    expect(inDefaultLayout(ALPHA, "admin")).toBe(true);
    expect(inDefaultLayout(ALPHA, null)).toBe(true);
  });

  it("includes a widget that names a role only for that role", () => {
    expect(inDefaultLayout(MAP, "dispatcher")).toBe(true);
    expect(inDefaultLayout(MAP, "admin")).toBe(false);
    expect(inDefaultLayout(MAP, null)).toBe(false);
  });
});

describe("resolveDashboardLayout — no row (D-DW3's first state)", () => {
  it("gives a dispatcher the map without any configuration", () => {
    expect(keys(resolveDashboardLayout(ALLOWED, "dispatcher", null))).toEqual([
      "fleet.alpha",
      "fleet.beta",
      "dispatch.map",
    ]);
  });

  it("withholds a role-defaulted widget from everyone else, who may still grant it themselves", () => {
    expect(keys(resolveDashboardLayout(ALLOWED, "admin", null))).toEqual(["fleet.alpha", "fleet.beta"]);
    // D-DW2's "an admin who wants the map gets it by granting themselves the widget". Naming it
    // FIRST is the arrangement; the two they never ruled on still follow, on their own default.
    expect(
      keys(resolveDashboardLayout(ALLOWED, "admin", stored({ widgetKeys: ["dispatch.map"] }))),
    ).toEqual(["dispatch.map", "fleet.alpha", "fleet.beta"]);
  });
});

describe("resolveDashboardLayout — a stored row", () => {
  it("renders the kept widgets in the order they were kept, not catalogue order", () => {
    const out = resolveDashboardLayout(
      ALLOWED,
      "dispatcher",
      stored({ widgetKeys: ["dispatch.map", "fleet.alpha"], hiddenKeys: ["fleet.beta"] }),
    );
    expect(keys(out)).toEqual(["dispatch.map", "fleet.alpha"]);
  });

  it("treats an empty kept list as 'show me nothing' rather than as no choice at all", () => {
    const out = resolveDashboardLayout(
      ALLOWED,
      "dispatcher",
      stored({ hiddenKeys: ["fleet.alpha", "fleet.beta", "dispatch.map"] }),
    );
    expect(out).toEqual([]);
    // The distinction the whole third-state argument rests on: the same caller with no row gets three.
    expect(resolveDashboardLayout(ALLOWED, "dispatcher", null)).toHaveLength(3);
  });

  /**
   * LM10's Done-when, and the reason `hidden_keys` exists at all: `fleet.beta` stands for a widget
   * added to the catalogue after this person last saved. They hid `fleet.alpha` and ruled on nothing
   * else, so the new widget arrives on its default.
   */
  it("still inherits a later default change for a widget the user never ruled on", () => {
    const out = resolveDashboardLayout(
      ALLOWED,
      "dispatcher",
      stored({ widgetKeys: ["dispatch.map"], hiddenKeys: ["fleet.alpha"] }),
    );
    expect(keys(out)).toEqual(["dispatch.map", "fleet.beta"]);
  });

  it("appends an untouched widget after the arrangement rather than into it", () => {
    const out = resolveDashboardLayout(
      ALLOWED,
      "dispatcher",
      stored({ widgetKeys: ["dispatch.map", "fleet.alpha"] }),
    );
    expect(keys(out)).toEqual(["dispatch.map", "fleet.alpha", "fleet.beta"]);
  });

  it("does not inherit a role-defaulted widget the role has no claim on", () => {
    const out = resolveDashboardLayout(ALLOWED, "admin", stored({ widgetKeys: ["fleet.beta"] }));
    expect(keys(out)).toEqual(["fleet.beta", "fleet.alpha"]);
  });

  it("drops a stored key the caller's gates do not admit, and does not let it hide anything", () => {
    // `dispatch.map` is absent from `allowed` here — the caller lost the section.
    const out = resolveDashboardLayout(
      [ALPHA, BETA],
      "dispatcher",
      stored({ widgetKeys: ["dispatch.map", "fleet.alpha"] }),
    );
    expect(keys(out)).toEqual(["fleet.alpha", "fleet.beta"]);
  });

  it("ignores a key repeated in the stored order rather than rendering it twice", () => {
    const out = resolveDashboardLayout(
      ALLOWED,
      "dispatcher",
      stored({ widgetKeys: ["fleet.alpha", "fleet.alpha", "fleet.beta"], hiddenKeys: ["dispatch.map"] }),
    );
    expect(keys(out)).toEqual(["fleet.alpha", "fleet.beta"]);
  });
});

describe("mergeTabLayout — rearranging one tab must not erase another", () => {
  const OFFERED = ["fleet.alpha", "fleet.beta"];

  it("keeps the other tab's decisions verbatim, in their own order", () => {
    const out = mergeTabLayout(
      { widgetKeys: ["dispatch.map", "fleet.alpha"], hiddenKeys: ["fleet.beta"] },
      OFFERED,
      ["fleet.beta"],
      ["fleet.alpha"],
    );
    expect(out.widgetKeys).toEqual(["dispatch.map", "fleet.beta"]);
    expect(out.hiddenKeys).toEqual(["fleet.alpha"]);
  });

  /**
   * The case the `offered` argument exists for: `fleet.beta` is on this tab but the caller lost its
   * gate, so the editor never showed it and cannot have a decision about it. Dropping it would
   * delete one they had already made.
   */
  it("preserves a decision about a widget the editor could not offer", () => {
    const out = mergeTabLayout(
      { widgetKeys: [], hiddenKeys: ["fleet.beta"] },
      ["fleet.alpha"],
      ["fleet.alpha"],
      [],
    );
    expect(out.hiddenKeys).toEqual(["fleet.beta"]);
  });

  it("builds a first row for somebody who had none", () => {
    expect(mergeTabLayout(null, OFFERED, ["fleet.beta", "fleet.alpha"], [])).toEqual({
      widgetKeys: ["fleet.beta", "fleet.alpha"],
      hiddenKeys: [],
    });
  });

  it("round-trips through the resolver, so what was saved is what renders", () => {
    const saved = mergeTabLayout(null, OFFERED, ["fleet.beta"], ["fleet.alpha"]);
    expect(keys(resolveDashboardLayout(ALLOWED, "dispatcher", saved))).toEqual([
      "fleet.beta",
      "dispatch.map",
    ]);
  });

  it("produces a body the schema accepts", () => {
    const saved = mergeTabLayout(null, OFFERED, ["fleet.alpha"], ["fleet.beta"]);
    expect(dashboardLayoutSetSchema.safeParse(saved).success).toBe(true);
  });
});

describe("dashboardLayoutSetSchema", () => {
  it("accepts both arrays empty — a person who hid everything they had been offered", () => {
    expect(dashboardLayoutSetSchema.safeParse({ widgetKeys: [], hiddenKeys: [] }).success).toBe(true);
  });

  it("requires both arrays, so 'hid everything' cannot arrive as 'kept everything'", () => {
    expect(dashboardLayoutSetSchema.safeParse({ widgetKeys: ["fleet.alpha"] }).success).toBe(false);
  });

  it("refuses a key that is both kept and hidden, as 0343's CHECK does", () => {
    const parsed = dashboardLayoutSetSchema.safeParse({
      widgetKeys: ["fleet.alpha"],
      hiddenKeys: ["fleet.alpha"],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an empty key and a request long enough to be storage", () => {
    expect(dashboardLayoutSetSchema.safeParse({ widgetKeys: [""], hiddenKeys: [] }).success).toBe(false);
    expect(
      dashboardLayoutSetSchema.safeParse({
        widgetKeys: Array.from({ length: 65 }, (_, i) => `fleet.w${i}`),
        hiddenKeys: [],
      }).success,
    ).toBe(false);
  });
});
