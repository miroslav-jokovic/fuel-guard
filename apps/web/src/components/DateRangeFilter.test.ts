import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueDatePicker } from "@vuepic/vue-datepicker";
import { windowDays } from "@silvicom/shared";
import DateRangeFilter from "./DateRangeFilter.vue";

/**
 * The quick presets, as the picker is handed them. Both ends of a picked range are included, so "Last 7
 * days" must be seven calendar dates — `windowDays` (spendWindow.ts) counts inclusively and `defaultWindow`
 * starts at `today - (N - 1)`. The presets once subtracted N, which made 7 → 8, 30 → 31, 90 → 91 on every
 * page that uses this filter (design verdict 2026-10-03, E8).
 */
afterEach(() => vi.useRealTimers());

const localYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const presets = () => {
  const w = mount(DateRangeFilter, { props: { from: undefined, to: undefined } });
  return w.findComponent(VueDatePicker).props("presetDates") as { label: string; value: [Date, Date] }[];
};

describe("DateRangeFilter presets", () => {
  it.each([[7], [30], [90]])("Last %i days is %i calendar dates ending today", (n) => {
    // The Monday after US daylight saving ended (2026-11-01): a day count taken in milliseconds is an
    // hour short across the change, so this is the date that catches that form of the same defect.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 15, 30));
    const p = presets().find((x) => x.label === `Last ${n} days`);
    expect(p, `no "Last ${n} days" preset`).toBeTruthy();
    const [from, to] = p!.value;
    expect(localYmd(to)).toBe("2026-11-02");
    expect(windowDays(localYmd(from), localYmd(to))).toBe(n);
  });
});
