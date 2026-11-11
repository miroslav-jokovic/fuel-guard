import { describe, expect, it } from "vitest";
import { REFRESH_ATTEMPTS, isReplacement, nextRefreshOption, refreshOptions, type RefreshInput } from "./creativeRefresh.js";

const P = (key: string, enabled = true) => ({ key, version_id: `v-${key}`, enabled });
const base: RefreshInput = {
  campaign_id: "c-1", retired_creative_id: "cr-9",
  presets: [P("P1"), P("P2"), P("P3"), P("P4"), P("P5")],
  approved_keys: ["P1", "P2", "P3"], live_keys_for_brief: [], retired_key: "P2",
};

describe("which concept replaces a retired ad (Q-AD68)", () => {
  it("an enabled preset the campaign never ran enters first, then the retired ad's own preset made fresh", () => {
    const o = refreshOptions(base);
    expect(o.filter((x) => x.kind === "unrun").map((x) => x.key).sort()).toEqual(["P4", "P5"]);
    expect(o.at(-1)).toEqual({ kind: "fresh", key: "P2", version_id: "v-P2" });
  });

  it("with every preset already run — the five starters on one campaign — the only option is the retired one made fresh", () => {
    expect(refreshOptions({ ...base, approved_keys: ["P1", "P2", "P3", "P4", "P5"] })).toEqual([{ kind: "fresh", key: "P2", version_id: "v-P2" }]);
  });

  it("a disabled preset never enters, and a disabled retired preset is not made again", () => {
    const o = refreshOptions({ ...base, presets: [P("P1"), P("P2", false), P("P3"), P("P4", false), P("P5")] });
    expect(o).toEqual([{ kind: "unrun", key: "P5", version_id: "v-P5" }]);
  });

  it("a preset another live campaign for the brief runs is not drawn", () => {
    expect(refreshOptions({ ...base, live_keys_for_brief: ["P4"] }).map((x) => x.key)).toEqual(["P5", "P2"]);
  });

  it("the order is the seed's: the same campaign and retired ad give the same order, another retired ad may not", () => {
    const wide = { ...base, presets: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"].map((k) => P(k)) };
    expect(refreshOptions(wide)).toEqual(refreshOptions(wide));
    const orders = new Set(["a", "b", "c", "d", "e", "f"].map((r) => refreshOptions({ ...wide, retired_creative_id: r }).map((x) => x.key).join(",")));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("the attempts (Q-AD68: one replacement, at most two tries)", () => {
  const options = refreshOptions(base);

  it("the first attempt takes the first option; the second skips the unrun preset the first tried", () => {
    const first = nextRefreshOption(options, []);
    expect(first.ok && first.option).toEqual(options[0]);
    const second = nextRefreshOption(options, [options[0]!.version_id]);
    expect(second.ok && second.option).toEqual(options[1]);
  });

  it("a fresh execution may be tried twice: two different makings of the same concept", () => {
    const fresh = refreshOptions({ ...base, approved_keys: ["P1", "P2", "P3", "P4", "P5"] });
    const again = nextRefreshOption(fresh, ["v-P2"]);
    expect(again.ok && again.option.kind).toBe("fresh");
  });

  it(`after ${REFRESH_ATTEMPTS} attempts nothing more is made, whatever is left`, () => {
    expect(nextRefreshOption(options, ["x", "y"])).toEqual({ ok: false, why: "attempts_spent" });
  });

  it("with no option at all it says so instead of inventing one", () => {
    expect(nextRefreshOption([], [])).toEqual({ ok: false, why: "nothing_to_enter" });
  });
});

describe("which creatives are replacements", () => {
  const all = [{ id: "old", platform_status: "retired" }, { id: "bad", platform_status: null }];

  it("one that names a retired creative is a replacement; one that names a rejected creative (Regenerate) is not", () => {
    expect(isReplacement({ supersedes_id: "old" }, all)).toBe(true);
    expect(isReplacement({ supersedes_id: "bad" }, all)).toBe(false);
    expect(isReplacement({ supersedes_id: null }, all)).toBe(false);
    expect(isReplacement({ supersedes_id: "elsewhere" }, all)).toBe(false);
  });
});
