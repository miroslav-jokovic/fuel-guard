import { describe, it, expect } from "vitest";
import { LicenseIcon, UserListIcon } from "@fuelguard/ui/icons";
import { buildComplianceRow } from "./complianceRow";

/**
 * The §391 dashboard row (UI plan U2).
 *
 * The distinction under test is `null` vs `0`, because it is the one a refactor collapses without
 * noticing and the one that leaks quietly: `null` is "your role may not view this section", `0` is
 * "counted, none". Rendering nulls as zeros would show a driver a row about a fleet they may not
 * read; dropping zeros would tell a recruiter with a clean queue nothing, and "nothing outstanding"
 * is one of the more useful things this row says.
 */
const ALL = { driversWithoutQualificationFile: 204, overdueInvestigations: 3, applicants: 7 };

describe("buildComplianceRow", () => {
  it("renders nothing at all before the counts arrive", () => {
    expect(buildComplianceRow(undefined)).toEqual([]);
  });

  it("drops a tile whose count is null — the role may not see that section", () => {
    const driver = buildComplianceRow({
      driversWithoutQualificationFile: null,
      overdueInvestigations: null,
      applicants: null,
    });
    expect(driver).toEqual([]);

    const dispatcher = buildComplianceRow({ ...ALL, overdueInvestigations: null, applicants: null });
    expect(dispatcher.map((t) => t.label)).toEqual(["No qualification file"]);
  });

  /** ⚠ The inverse of the rule above, and the half a "falsy" refactor would break. */
  it("RENDERS a tile whose count is zero", () => {
    const clean = buildComplianceRow({
      driversWithoutQualificationFile: 0,
      overdueInvestigations: 0,
      applicants: 0,
    });
    expect(clean).toHaveLength(3);
    expect(clean.map((t) => t.value)).toEqual(["0", "0", "0"]);
  });

  it("gives every tile a routed destination and its own glyph", () => {
    const tiles = buildComplianceRow(ALL);
    expect(tiles.map((t) => t.to)).toEqual(["/compliance", "/recruitment/inquiries", "/recruitment"]);
    expect(new Set(tiles.map((t) => t.icon)).size).toBe(3);
    // The same glyphs their nav items wear (U5/D-UI6), so the tile and the sidebar entry read as
    // one destination rather than two.
    expect(tiles[0]!.icon).toBe(LicenseIcon);
    expect(tiles[2]!.icon).toBe(UserListIcon);
  });

  /** Overdue is a live regulatory breach, not a backlog — the only one that goes danger-red. */
  it("reserves the danger tone for an investigation that is actually late", () => {
    expect(buildComplianceRow(ALL)[1]!.tone).toContain("danger");
    expect(buildComplianceRow({ ...ALL, overdueInvestigations: 0 })[1]!.tone).not.toContain("danger");
    // A backlog of unstarted files is caution, and a fleet with none is a success, not a danger.
    expect(buildComplianceRow(ALL)[0]!.tone).toContain("caution");
    expect(buildComplianceRow({ ...ALL, driversWithoutQualificationFile: 0 })[0]!.tone).toContain("success");
  });
});
