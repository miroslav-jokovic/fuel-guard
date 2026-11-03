import { describe, expect, it } from "vitest";
import { mvrReportReadGate } from "./mvrReadGate.js";

describe("mvrReportReadGate (§14 OF6)", () => {
  it("opens on the operator's switch and closes when it is off, with no monthly budget", () => {
    expect(mvrReportReadGate({ MVR_REPORT_READING: "on" })).toEqual({ open: true, monthlyTokenBudget: null });
    expect(mvrReportReadGate({ MVR_REPORT_READING: "off" }).open).toBe(false);
  });
});
