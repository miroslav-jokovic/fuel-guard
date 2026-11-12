import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SevenDayFields from "./SevenDayFields.vue";
import { emptyDraft, fromDraftPayload, toApplication, toDraftPayload } from "./draft";
import { correctionFor } from "./factCorrection";
import type { FactRow } from "./applicantFactRows";

/**
 * Page 21 at signing (Q-AM4). Pinned: each box is named by the day the packet prints under it (the seven
 * before the carrier's day, oldest first); a week is saved and filed only once all seven are hours; the
 * office's correction files numbers, all seven or none.
 */
const mountWith = (over: Partial<ReturnType<typeof emptyDraft>> = {}) =>
  mount(SevenDayFields, { props: { today: "2026-11-12", modelValue: { ...emptyDraft(), ...over }, "onUpdate:modelValue": () => {} } });

describe("page 21 on the sign-off screen", () => {
  it("names each box by its day, oldest first, and totals a whole week", async () => {
    const w = mountWith({ seven_day_hours: ["0", "8", "10.5", "0", "0", "6", "4"] });
    const labels = w.findAll("input[inputmode='decimal']").map((i) => i.attributes("aria-label"));
    expect(labels[0]).toContain("11/05");
    expect(labels[6]).toContain("11/11");
    expect(w.find("[data-seven-day-total]").text()).toContain("28.5");
  });

  it("says no total while a day is empty", () => {
    expect(mountWith().find("[data-seven-day-total]").exists()).toBe(false);
  });
});

describe("page 21 in the draft", () => {
  it("saves and files a whole week only, and reads one back", () => {
    const d = emptyDraft();
    d.seven_day_hours = ["0", "8", "", "0", "0", "6", "4"];
    d.last_relieved_at = "2026-11-11T17:30";
    expect(toDraftPayload(d)).not.toHaveProperty("seven_day_hours");
    expect((toApplication(d) as { seven_day_hours?: unknown }).seven_day_hours).toBeNull();
    d.seven_day_hours.splice(2, 1, "10.5");
    expect(toDraftPayload(d).seven_day_hours).toEqual([0, 8, 10.5, 0, 0, 6, 4]);
    expect(toApplication(d)).toMatchObject({ seven_day_hours: [0, 8, 10.5, 0, 0, 6, 4], last_relieved_at: "2026-11-11T17:30" });
    expect(fromDraftPayload(toDraftPayload(d)).seven_day_hours).toEqual(["0", "8", "10.5", "0", "0", "6", "4"]);
  });

  it("refuses an hour count outside 0 to 24", () => {
    const d = emptyDraft();
    d.seven_day_hours = ["0", "0", "0", "0", "0", "0", "25"] as string[];
    expect((toApplication(d) as { seven_day_hours?: unknown }).seven_day_hours).toBeNull();
  });
});

describe("the office's correction of page 21", () => {
  const row = { key: "seven_day_hours", path: ["seven_day_hours"], input: "seven_days", door: "draft" } as unknown as FactRow;
  const ctx = { revision: 4, partOne: null, rows: [], addresses: [] };

  it("files all seven as numbers through the draft — usually all zeros", () => {
    expect(correctionFor(row, ["0", "0", "0", "0", "0", "0", "0"], ctx)).toEqual({
      door: "draft", edit: { path: ["seven_day_hours"], value: [0, 0, 0, 0, 0, 0, 0], revision: 4 },
    });
  });

  it("refuses a week with a day left empty", () => {
    expect(correctionFor(row, ["0", "", "0", "0", "0", "0", "0"], ctx)).toHaveProperty("problem");
  });
});
