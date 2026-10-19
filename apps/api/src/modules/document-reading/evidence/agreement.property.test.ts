import { describe, expect, it } from "vitest";
import { loadDataset } from "@hazmat/data";
import { valuesAgree } from "@silvicom/shared";

/**
 * `valuesAgree` (@silvicom/shared, fieldEvidenceContract.ts) over every proper shipping name in the shipped
 * table (READER-CORRECTNESS-PLAN, D-RC1), both halves: a reader's FORMATTING of a name — case, spacing around
 * punctuation, a line break for ", " — never makes two readers disagree, and every one-character change of a
 * letter, digit or punctuation mark always does. Production read 76979453 (2026-10-19) is the first half's
 * case: "CORROSIVE LIQUID , N.O.S." against "CORROSIVE LIQUID, N.O.S." stopped three lines of the audit.
 */
const NAMES = [...new Set(loadDataset().entries.flatMap((e) => [e.psnPrinted, ...e.psnAlternates]))];
const ADDRESSES = ["1025 Raco Ct, Suite A, LAWRENCEVILLE, GA 30046", "P.O. Box 441326, KENNESAW, GA 30160"];
const TEXTS = [...NAMES, ...ADDRESSES];

/** How a reader may write the same characters. */
const formattings = (t: string): string[] => [
  t.toUpperCase(),
  t.toLowerCase(),
  t.replace(/,/g, " ,"),
  t.replace(/\(/g, "( ").replace(/\)/g, " )"),
  t.replace(/, /g, "\n"),
  t.replace(/, /g, ",\n"),
  `  ${t.replace(/ /g, "  ")}  `,
];

const ALNUM = /[A-Za-z0-9]/;
/** Every one-character change that changes what is printed: a letter, digit or mark replaced, or dropped. */
function changes(t: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === " ") continue;
    out.push(t.slice(0, i) + t.slice(i + 1));
    const other = ALNUM.test(c) ? (/[0-9]/.test(c) ? (c === "1" ? "7" : "1") : c.toUpperCase() === "X" ? "Y" : "X") : c === "," ? "." : ",";
    out.push(t.slice(0, i) + other + t.slice(i + 1));
  }
  return out;
}

describe("valuesAgree over every table name (formatting agrees, a changed character never does)", () => {
  it("covers the table", () => expect(NAMES.length).toBeGreaterThan(2000));

  it("never makes two readers disagree over formatting", () => {
    const split = TEXTS.flatMap((t) => formattings(t).filter((f) => !valuesAgree(t, f)).map((f) => `${t} ≠ ${JSON.stringify(f)}`));
    expect(split.slice(0, 10)).toEqual([]);
  });

  it("always makes them disagree over a changed letter, digit or mark", () => {
    const joined: string[] = [];
    for (const t of TEXTS) for (const c of changes(t)) if (valuesAgree(t, c)) joined.push(`${t} = ${c}`);
    // A dropped mark beside a space ("a , b" → "a  b") or a dropped space-adjacent comma is still a change; the
    // only joins allowed are none.
    expect(joined.slice(0, 10)).toEqual([]);
  });
});
