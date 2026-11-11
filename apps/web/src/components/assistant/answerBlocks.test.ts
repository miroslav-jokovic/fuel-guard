import { describe, expect, it } from "vitest";
import { parseAnswer, parseInlines, tableCsv } from "./answerBlocks";

const text = (b: { inlines: { text: string }[] }) => b.inlines.map((i) => i.text).join("");

describe("parseAnswer", () => {
  it("reads a pipe table into head, rows and per-column alignment", () => {
    const blocks = parseAnswer(
      "Worst MPG this quarter:\n\n| Driver | MPG | Spend |\n|---|---:|---:|\n| Ana Ruiz | 5.8 | $4,210 |\n| **Bo Lee** | 6.1 | $3,980 |\n\nBoth are below the fleet.",
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    const table = blocks[1]!;
    if (table.type !== "table") throw new Error("not a table");
    expect(table.head.map((c) => c.map((i) => i.text).join(""))).toEqual(["Driver", "MPG", "Spend"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]![0]).toEqual([{ kind: "strong", text: "Bo Lee" }]);
    expect(table.numeric).toEqual([false, true, true]);
  });

  it("keeps a column holding one name among numbers left-aligned", () => {
    const [table] = parseAnswer("| Unit | Fills |\n|---|---|\n| 718 | 12 |\n| Unattributed | 3 |");
    if (table?.type !== "table") throw new Error("not a table");
    expect(table.numeric).toEqual([false, true]);
  });

  it("does not read a lone pipe line as a table", () => {
    expect(parseAnswer("| not a table |").map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("groups consecutive bullets and numbers into separate lists, and reads headings", () => {
    const blocks = parseAnswer("## Summary\n- one\n- two\n1. first\n2. second");
    expect(blocks.map((b) => (b.type === "list" ? `list:${b.ordered}:${b.items.length}` : b.type))).toEqual([
      "heading",
      "list:false:2",
      "list:true:2",
    ]);
  });

  it("joins wrapped lines into one paragraph and splits on blank lines", () => {
    const blocks = parseAnswer("Spend was\n$41,200 last month.\n\nMPG held.");
    expect(blocks).toHaveLength(2);
    expect(text(blocks[0] as { inlines: { text: string }[] })).toBe("Spend was $41,200 last month.");
  });

  it("keeps markup-looking text as text — nothing becomes HTML", () => {
    const [p] = parseAnswer('Station <img src=x onerror="alert(1)"> [link](https://evil.example)');
    expect(p).toEqual({
      type: "paragraph",
      inlines: [{ kind: "text", text: 'Station <img src=x onerror="alert(1)"> [link](https://evil.example)' }],
    });
  });
});

describe("parseInlines", () => {
  it("reads bold and code, and leaves an unclosed mark as text", () => {
    expect(parseInlines("a **b** `c` **d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " **d" },
    ]);
  });
});

describe("tableCsv (F21 R4a)", () => {
  it("is the words on screen, with a numeric column made summable and a text column left as written", () => {
    const [table] = parseAnswer("| Unit | Spend | MPG | Note |\n|---|---:|---:|---|\n| **748** | $12,345.60 | 6.4 mpg | -SUM(A1) |\n| 751 | −$1,200 | 7.1 mpg | $1,000 limit |");
    if (table?.type !== "table") throw new Error("not a table");
    expect(tableCsv(table)).toEqual({
      headers: ["Unit", "Spend", "MPG", "Note"],
      rows: [
        ["748", "12345.60", "6.4 mpg", "-SUM(A1)"],
        // A text column keeps "$1,000" as the reader saw it: only a numeric column is made summable.
        ["751", "-1200", "7.1 mpg", "$1,000 limit"],
      ],
    });
  });
});
