import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) =>
  readFileSync(path.join(process.cwd(), `src/features/fuel/${name}.vue`), "utf8");

describe("Fuel Log list workspaces", () => {
  it.each(["DeclinesTab", "FillsTab"])("keeps %s's toolbar, context, and table in one workspace", (name) => {
    const template = source(name).split("<template>")[1] ?? "";
    expect(template.match(/<DataWorkspace>/g)).toHaveLength(1);
    expect(template).toMatch(/<DataWorkspace>[\s\S]*<FilterBar[\s\S]*\bembedded\b[\s\S]*<DataTable[\s\S]*\bembedded\b[\s\S]*<\/DataWorkspace>/);
  });

  it("renders the fills summary as a divided workspace section, not a nested card", () => {
    const template = source("FillsTab").split("<template>")[1] ?? "";
    const workspace = template.slice(template.indexOf("<DataWorkspace>"), template.indexOf("</DataWorkspace>"));
    expect(workspace).toContain('<section v-if="!isLoading && !isError && total > 0"');
    expect(workspace).not.toContain("<BaseCard");
  });
});
