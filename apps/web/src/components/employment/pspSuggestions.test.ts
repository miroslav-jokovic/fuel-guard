import { describe, expect, it } from "vitest";
import type { UnlistedCarrier } from "@silvicom/shared";
import { PSP_SUGGESTION_COPY, corroboratedJobKeys } from "./pspSuggestions";

/** HW6b's words and keys, the cases the two section tests do not reach. */
const carrier = (over: Partial<UnlistedCarrier> = {}): UnlistedCarrier => ({
  usdotNumber: "113529", carrierName: "ACME", firstSeen: "2024-10-06", lastSeen: "2025-04-03",
  inspections: 1, crashes: 1, owedTo: "b10", ...over,
});

describe("the suggestion's sentence", () => {
  it("counts both kinds of sighting, in the singular when there is one", () => {
    expect(PSP_SUGGESTION_COPY.unlisted(carrier(), "10/06/2024", "04/03/2025")).toBe(
      "PSP shows 1 inspection and 1 crash under ACME, DOT 113529, between 10/06/2024 and 04/03/2025 — not on their list.",
    );
  });

  it("says 'on' a day when PSP saw the truck once", () => {
    expect(PSP_SUGGESTION_COPY.unlisted(carrier({ crashes: 0 }), "10/06/2024", "10/06/2024")).toBe(
      "PSP shows 1 inspection under ACME, DOT 113529, on 10/06/2024 — not on their list.",
    );
  });
});

describe("which jobs PSP backs up", () => {
  it("only the corroborated ones — 'no activity' is not a finding either way (D-PSP5)", () => {
    const keys = corroboratedJobKeys({
      report: { requestId: "r", pulledOn: "2026-08-20" },
      unlisted: [],
      employers: [
        { key: "a", index: 0, match: "corroborated", inspections: 1, crashes: 0 },
        { key: "b", index: 1, match: "no_psp_activity", inspections: 0, crashes: 0 },
        { key: "c", index: 2, match: "outside_psp_window", inspections: 0, crashes: 0 },
        { key: null, index: 3, match: "corroborated", inspections: 0, crashes: 1 },
      ],
      inspectionWindowStart: null,
      crashWindowStart: null,
    });
    expect([...keys]).toEqual(["a", "row-3"]);
  });

  it("is empty with no answer yet", () => {
    expect(corroboratedJobKeys(undefined).size).toBe(0);
  });
});
