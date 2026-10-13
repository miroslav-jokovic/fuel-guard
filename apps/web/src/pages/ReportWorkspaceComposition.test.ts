import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const template = (name: string) => {
  const source = readFileSync(path.join(process.cwd(), `src/pages/${name}.vue`), "utf8");
  return source.split("<template>")[1] ?? "";
};

describe("report and list scope composition", () => {
  it("keeps Driver Performance's week outside the driver-list workspace", () => {
    const source = template("DriverPerformancePage");
    const workspaceAt = source.indexOf("<DataWorkspace>");
    expect(source.match(/<ReportScopeBar/g)).toHaveLength(1);
    expect(source.indexOf('label="Week"')).toBeLessThan(workspaceAt);
    expect(source.indexOf('label="Status"')).toBeGreaterThan(workspaceAt);
    expect(source.slice(workspaceAt)).toMatch(/<FilterBar[\s\S]*\bembedded\b[\s\S]*<DataTable[\s\S]*\bembedded\b/);
  });

  it("keeps IFTA jurisdiction quarter scope outside its truck-list workspace", () => {
    const source = template("IftaJurisdictionPage");
    const workspaceAt = source.indexOf("<DataWorkspace>");
    expect(source.match(/<ReportScopeBar/g)).toHaveLength(1);
    expect(source.indexOf('label="Quarter"')).toBeLessThan(workspaceAt);
    expect(source.indexOf('label="Show"')).toBeGreaterThan(workspaceAt);
    expect(source.slice(workspaceAt).match(/<DataTable/g)).toHaveLength(2);
    expect(source.slice(workspaceAt).match(/\bembedded\b/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the IFTA ledger report-oriented without a list FilterBar or table wrapper card", () => {
    const source = template("IftaLedgerPage");
    expect(source).not.toContain("<FilterBar");
    expect(source.match(/<ReportScopeBar/g)).toHaveLength(1);
    expect(source).toContain('count-label="jurisdictions"');
    expect(source).toContain("Reporting quarter");
    expect(source).not.toMatch(/<BaseCard[^>]*>[\s\S]*<DataTable[\s\S]*<\/BaseCard>/);
  });
});
