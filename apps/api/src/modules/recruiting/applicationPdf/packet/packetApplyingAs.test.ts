import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDisplayDate, type ApplyingAs, type DriverApplication } from "@silvicom/shared";
import { renderPacketDocument } from "../packetDocument.js";
import { pageText, readPacketTemplate } from "./packetTemplate.js";

/**
 * Page 31's owner-operator half and page 22's reason, as a RENDERED packet shows them (Q-HM14).
 *
 * Rendered through `renderPacketDocument` — the path filing, the office preview and the applicant's
 * reading copy all take — because the owner-operator half has three pieces and they are decided in
 * two modules: the `p31b` mark and its date (this function's walk filter) and the two names
 * (`packetSigningFields`). A unit test of either alone cannot see them disagree.
 *
 * ⚠ The fixture carries a `p31b` mark for the company driver on purpose: a walk served while their
 * answer still said owner-operator, then changed. The row stays (evidence, append-only); the filed
 * page must not show a signature "as the owner-operator" under an owner-operator block it leaves blank.
 */

/**
 * ⚠ The adopted signature and the printed name are the same string here on purpose, so one count
 * covers both kinds of line: page 31 carries two marks (`p31a`, `p31b`) and three name blanks
 * (`Driver name:`, `Owner Operator Name:`, `I ____ aka (OP)`).
 */
const ADOPTED = "Susan Godfrey";
const P31A_AT = "2026-09-17T15:00:00Z";
const P31B_AT = "2026-09-18T16:00:00Z";

async function render(applyingAs: ApplyingAs | null) {
  const application = {
    first_name: "Susan",
    last_name: "Godfrey",
    questionnaire_answers: applyingAs ? { applying_as: applyingAs } : {},
  } as unknown as DriverApplication;
  const pdf = await renderPacketDocument({
    marks: [
      { placement_id: "p31a", signed_name: ADOPTED, signed_at: P31A_AT },
      { placement_id: "p31b", signed_name: ADOPTED, signed_at: P31B_AT },
    ],
    application,
    certifiedAt: "",
    signedName: ADOPTED,
  });
  const dir = await mkdtemp(join(tmpdir(), "packet-applying-as-"));
  const path = join(dir, "packet.pdf");
  await writeFile(path, pdf);
  const read = await readPacketTemplate(path);
  return { page22: pageText(read[21]!), page31: pageText(read[30]!) };
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("a company driver's packet", () => {
  it("prints page 31's driver half and nothing of the owner-operator's, even with a p31b on record", async () => {
    const { page31 } = await render("company_driver");
    expect(count(page31, ADOPTED), "p31a and `Driver name:` only").toBe(2);
    expect(page31).toContain(formatDisplayDate(P31A_AT, ""));
    expect(page31).not.toContain(formatDisplayDate(P31B_AT, ""));
  });

  it("adds nothing to page 22's reason box — the carrier's own yes already answers it", async () => {
    const { page22 } = await render("company_driver");
    expect(count(page22.replace(/\s+/g, " "), " yes")).toBe(1);
  });
});

describe("an owner-operator's packet", () => {
  it("prints both halves of page 31, signed and named", async () => {
    const { page31 } = await render("owner_operator");
    expect(count(page31, ADOPTED), "two marks and three names").toBe(5);
    expect(page31).toContain(formatDisplayDate(P31B_AT, ""));
  });

  it("ticks the contracting reason beside the carrier's printed one", async () => {
    const { page22 } = await render("owner_operator");
    expect(count(page22.replace(/\s+/g, " "), " yes")).toBe(2);
  });
});

/** ⚠ Every packet filed before the question existed: what the paper printed before Q-HM14, exactly. */
describe("a packet with no answer", () => {
  it("prints page 31 as the paper always did, and ticks no reason", async () => {
    const { page22, page31 } = await render(null);
    expect(count(page31, ADOPTED)).toBe(5);
    expect(page31).toContain(formatDisplayDate(P31B_AT, ""));
    expect(count(page22.replace(/\s+/g, " "), " yes")).toBe(1);
  });
});
