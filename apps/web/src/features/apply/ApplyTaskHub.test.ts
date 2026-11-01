import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { emptyDraft } from "./draft";
import ApplyTaskHub from "./ApplyTaskHub.vue";
import { APPLY_COPY, APPLY_SECTION_TITLES } from "./strings";

/** The list itself (C3c2a): a row per task, its status in words, 44 px rows, a shut last row that says why. */
const copy = APPLY_COPY.hub;
const mountHub = () =>
  mount(ApplyTaskHub, { props: { draft: emptyDraft(), v2AsOf: "2026-09-26", captures: [], saveStatus: null } });

describe("the task list", () => {
  it("names every task with its status, and every row is a 44 px target", () => {
    const rows = mountHub().findAll("li button");
    expect(rows).toHaveLength(8);
    expect(rows[0]!.text()).toContain("About you");
    expect(rows[0]!.text()).toContain(copy.status.not_started);
    for (const row of rows) expect(row.classes()).toContain("min-h-11");
  });

  it("shuts Before you send while tasks are unfinished, and says why on the row", () => {
    const last = mountHub().findAll("li button").at(-1)!;
    expect(last.text()).toContain(copy.beforeYouSend);
    expect(last.text()).toContain(copy.finishFirst);
    expect(last.attributes("disabled")).toBeDefined();
  });

  it("marks only the photographs optional, and says how many carrier questions are answered (§9 P8, AF-2)", () => {
    const text = mountHub().findAll("li button").map((b) => b.text());
    expect(text.filter((t) => t.includes(copy.optional))).toHaveLength(1);
    expect(text.find((t) => t.includes(APPLY_SECTION_TITLES.questions))).toContain(copy.answered(0, 4));
  });

  it("opens the task pressed", async () => {
    const w = mountHub();
    await w.findAll("li button")[1]!.trigger("click");
    expect(w.emitted("open")).toEqual([["addresses"]]);
  });
});
