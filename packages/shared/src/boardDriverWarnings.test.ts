import { describe, expect, it } from "vitest";
import { credentialWarnings, randomTestVisible } from "./boardDriverWarnings.js";
import { canReadTestingRecords, canViewSection } from "./auth.js";
import { USER_ROLES } from "./constants.js";
import type { DqRosterCell } from "./dqFile.js";

const cell = (key: DqRosterCell["key"], state: DqRosterCell["state"], goodUntil: string | null = "2026-11-01"): DqRosterCell =>
  ({ key, state, goodUntil, daysRemaining: null, expiryUnknown: false });

describe("credentialWarnings — the medical card and the CDL off the driver's DQ file", () => {
  it("is overdue once expired and due inside the file's window", () => {
    expect(credentialWarnings([cell("medical_card", "expired", "2026-10-01"), cell("cdl", "expiring", "2026-10-30")])).toEqual([
      { unit: "driver", kind: "medical_card", verdict: "overdue", dueOn: "2026-10-01", milesLeft: null },
      { unit: "driver", kind: "cdl", verdict: "due", dueOn: "2026-10-30", milesLeft: null },
    ]);
  });

  it("says nothing for a current item, a MISSING one (the qualification queue's work), or the hazmat endorsement", () => {
    expect(credentialWarnings([cell("medical_card", "current"), cell("cdl", "missing", null), cell("endorsement_hazmat", "expired")])).toEqual([]);
  });
});

describe("randomTestVisible — who may learn a driver is drawn (Q-DBV3)", () => {
  // Every role that sees the board, split by the testing-record rule — derived, never typed out.
  const boardRoles = USER_ROLES.filter((r) => canViewSection(r, "dispatch"));
  const testing = boardRoles.filter((r) => canReadTestingRecords(r));
  const others = boardRoles.filter((r) => !canReadTestingRecords(r));

  it("shows a testing-record reader every drawn driver, on any truck", () => {
    expect(testing.length).toBeGreaterThan(0);
    for (const r of testing) expect(randomTestVisible(true, r, false)).toBe(true);
  });

  it("⚠ shows anybody else only the drivers on their own trucks", () => {
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) {
      expect(randomTestVisible(true, r, true)).toBe(true);
      expect(randomTestVisible(true, r, false)).toBe(false);
    }
  });

  it("shows nobody a driver who is not drawn", () => {
    for (const r of boardRoles) expect(randomTestVisible(false, r, true)).toBe(false);
  });
});
