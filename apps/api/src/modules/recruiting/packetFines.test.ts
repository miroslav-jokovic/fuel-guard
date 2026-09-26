import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PACKET_FINES } from "./packetFines.js";
import { applyPacketSpelling, packetLineTexts } from "./applicationPdf/packet/packetSpellingPatch.js";
import { PACKET_TEMPLATE_PATH } from "./applicationPdf/packet/packetTemplate.js";

/**
 * D-PKT21 — the packet's fines agree with the handbook's (owner, 2026-09-25: *"the handbook should
 * win on the fines, fix the packet"*). Read back from the produced pages, never from the register.
 */

const printed = async (): Promise<Map<number, string>> => {
  const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
  applyPacketSpelling(doc);
  return new Map([7, 9, 10].map((p) => [p, packetLineTexts(doc, p - 1).join("\n")]));
};

describe("the packet's fines, as printed", () => {
  it("states the handbook's figure for every offence both documents price", async () => {
    const pages = await printed();
    const p7 = pages.get(7)!.split("\n").map((l) => l.trim());
    expect(pages.get(7)).toContain("( MISSING FOR OVER 15 DAYS)");
    expect(pages.get(7)).toContain("$...........5.00 PER DAY");
    expect(pages.get(7)).toContain("$...........25.00 EACH");
    expect(p7).toContain("$.....50.00");
    expect(pages.get(9)).toContain("$500 fee and immediate termination");
    expect(pages.get(9)).toContain("$500 fined and termination");
    expect(pages.get(10)).toContain("a $25 fine per day");
    expect(pages.get(10)).toContain("fined $50 per week");
  });

  /**
   * ⚠ Page 7 prints `$..1,500.00` three times, beside three different offences, and the handbook
   * prices only two of them. `nth` picks the rows; asserted by position, because "contains" cannot
   * tell row 2's figure from row 4's.
   */
  it("changes page 7's rows 2 and 3 and leaves row 4's $1,500.00 alone", async () => {
    const lines = (await printed()).get(7)!.split("\n").map((l) => l.trim());
    const after = (label: string): string => lines[lines.findIndex((l) => l.startsWith(label)) + 1]!;
    expect(after("2. FAILURE TO NOTIFY THE COMPANY OF A CDL SUSPENSION")).toBe("$..100.00 & TERMINATION");
    expect(after("3. ALLOWING A NOT-QUALIFIED OR UNAUTHORIZED PERSON TO DRIVE")).toBe("$..500.00 & TERMINATION");
    expect(after("4. FAILURE TO REPORT AN ACCIDENT IMMEDIATELY")).toBe("$..1,500.00");
  });

  it("prints none of the packet's old conflicting figures", async () => {
    const pages = await printed();
    for (const e of PACKET_FINES.filter((x) => !x.nth)) {
      expect(pages.get(e.page), `p${e.page} ${e.wrong}`).not.toContain(e.wrong);
    }
  });

  it("gives every change its reason, since none of them is spelling", () => {
    expect(PACKET_FINES.every((e) => e.kind === "ruling" && (e.why ?? "").length > 20)).toBe(true);
  });
});
