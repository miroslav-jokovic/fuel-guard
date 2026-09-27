import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PACKET_FINES, PACKET_ROW_REMOVALS } from "./packetFines.js";
import { packetClipReport } from "./applicationPdf/packet/packetSpellingPatch.js";
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

/**
 * D-HB7 (owner, 2026-09-25): receipts are no longer sent in, so page 7's `MISSING FUEL RECEIPTS`
 * fine is taken off the page and the rows below close up, rather than leaving a hole in a numbered
 * list.
 */
describe("the missing-receipts row (D-HB7)", () => {
  it("is gone from page 7, and the logs penalties read 1 to 4 with nothing between", async () => {
    const lines = (await printed()).get(7)!.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines.join("\n")).not.toMatch(/RECEIPT/i);
    const numbered = lines.filter((l) => /^\d\. (LATE RECORDS|HOURS OF SERVICE)/.test(l)).map((l) => l.slice(0, 2));
    expect(numbered).toEqual(["1.", "2.", "3.", "4."]);
  });

  it("moves the rows below up by one row and keeps them clear of every other line", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const before = packetClipReport(doc, 7);
    applyPacketSpelling(doc);
    const after = packetClipReport(doc, 7);
    expect(after.overlaps).toBe(before.overlaps);
    expect(after.overruns.length).toBe(before.overruns.length);
    expect(after.hidden).toEqual(before.hidden);
    // Each moved row sits exactly where the one above it was: row 3 where row 2 (receipts) stood, and
    // so on down to the TERMINATION beside the last.
    const was = (t: string): number => before.baselines.get(t)!;
    const now = (t: string): number => after.baselines.get(t)!;
    expect(now("2. HOURS OF SERVICE 1ST OOS VIOLATION                                                                $............500.00".trim()))
      .toBeCloseTo(was("2. MISSING FUEL RECEIPTS                                                                                                $...........20.00 EACH".trim()), 3);
    expect(now("4. HOURS OF SERVICE 3RD OOS VIOLATION")).toBeCloseTo(was("4. HOURS OF SERVICE 2ND OOS VIOLATION                                                              $............700.00".trim()), 3);
    expect(now("TICKET PENALTIES")).toBeCloseTo(was("TICKET PENALTIES"), 3);
  });

  it("refuses a removal whose row it cannot find exactly once", async () => {
    const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
    const ghost = { ...PACKET_ROW_REMOVALS[0]!, row: "9. NO SUCH ROW" };
    expect(() => applyPacketSpelling(doc, [], [ghost])).toThrow(/NO SUCH ROW/);
  });
});

