import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { describeRowCoverage } from "@silvicom/shared";
import RowCoverageLine from "./RowCoverageLine.vue";

/**
 * FUEL-T5 — the attribution line's two rules, which live here and nowhere else.
 *
 * The sentence is `describeRowCoverage`'s and is tested in `packages/shared`. What this component
 * decides is when it appears at all, and that it never spends the caution colour — `FeedFreshnessLine`
 * reserves that for a feed that has stopped, and the reservation only works if nothing else takes it.
 */

const line = (c: ReturnType<typeof describeRowCoverage> | null) => mount(RowCoverageLine, { props: { coverage: c } });

describe("RowCoverageLine", () => {
  it("renders nothing at all while the count is still loading", () => {
    expect(line(null).html()).toBe("<!--v-if-->");
  });

  // An empty list is explained better by the table's own empty state, which names the filters. A
  // second sentence above it saying nothing happened is noise over a blank table.
  it("renders nothing for an empty list, leaving the table's empty state to explain it", () => {
    expect(line(describeRowCoverage("transactions", 0, 0)).html()).toBe("<!--v-if-->");
  });

  it("prints the shared sentence verbatim rather than composing one of its own", () => {
    const c = describeRowCoverage("rejections", 3445, 2749);
    expect(line(c).text()).toBe(c.lead);
  });

  // 339 of 28,620 lines and 696 of 3,445 declines is the NORMAL state of this carrier's data
  // (measured 2026-09-02). A caution tone here would be permanently lit, which is how a caution
  // colour stops meaning anything — and `FeedFreshnessLine` needs it to still mean something.
  it("never takes the caution colour, however incomplete the attribution is", () => {
    for (const c of [describeRowCoverage("rejections", 100, 1), describeRowCoverage("transactions", 100, 0)]) {
      const html = line(c).html();
      expect(html).not.toContain("caution");
      expect(html).not.toContain("danger");
      expect(html).toContain("text-ink-tertiary");
    }
  });
});
