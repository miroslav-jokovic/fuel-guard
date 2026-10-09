import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import MoneyExportActions from "./MoneyExportActions.vue";

/**
 * F02-F04 chunk 14c (AUDIT.md W6). The export's scope line sat beside the Findings date picker and
 * printed `2026-07-09 → 2026-10-06` while the picker said `07/09/2026 – 10/06/2026`. One page, two
 * ways of writing the same window (D-DS18). The file name keeps the ISO dates: a file name sorts, a
 * reader does not.
 */
vi.mock("@/lib/api", () => ({ apiDownload: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const ExportStub = { props: ["href", "filename", "scope", "disabled"], template: "<div />" };

describe("the Findings export says its window the way the picker does (W6)", () => {
  const mountWith = (vehicleIds: string[]) =>
    mount(MoneyExportActions, {
      props: { states: [], kinds: [], vehicleIds, assignedTo: null, from: "2026-07-09", to: "2026-10-06", moneyIds: ["m1"] },
      global: { stubs: { ExportButton: ExportStub } },
    }).findComponent(ExportStub);

  it("prints MM/DD/YYYY in the scope line, and keeps ISO in the file name", () => {
    const button = mountWith([]);
    expect(button.props("scope")).toBe("07/09/2026 – 10/06/2026 · all trucks · money findings only");
    expect(button.props("filename")).toBe("fuel-findings-2026-07-09-to-2026-10-06.csv");
  });

  it("counts the trucks it is narrowed to", () => {
    expect(mountWith(["a", "b"]).props("scope")).toContain("· 2 trucks ·");
  });
});
