import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) =>
  readFileSync(path.join(process.cwd(), `src/features/compliance/${name}.vue`), "utf8");

describe("QualificationSection list composition", () => {
  it("keeps the requirement filters and table in one embedded data workspace", () => {
    const template = source("QualificationSection").split("<template>")[1] ?? "";
    const workspace = template.slice(
      template.indexOf("<DataWorkspace>"),
      template.indexOf("</DataWorkspace>") + "</DataWorkspace>".length,
    );

    expect(template.match(/<DataWorkspace>/g)).toHaveLength(1);
    expect(workspace).toMatch(
      /<FilterBar[\s\S]*\bembedded\b[\s\S]*<RequirementTable[\s\S]*\bembedded\b/,
    );
  });

  it("forwards RequirementTable's embedded mode to its DataTable", () => {
    const component = source("RequirementTable");

    expect(component).toContain("embedded?: boolean;");
    expect(component).toMatch(/<DataTable[\s\S]*:embedded="embedded"/);
  });
});
