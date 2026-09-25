import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKET_WITHDRAWALS, formatDisplayDate, type DriverApplication } from "@silvicom/shared";
import { renderPacketDocument } from "../packetDocument.js";
import { pageText, readPacketTemplate } from "./packetTemplate.js";

/**
 * Page 4 prints unsigned, and says why (L-1, owner 2026-09-24; memorandum Q1).
 *
 * Rendered through `renderPacketDocument` — the path filing and the office preview both take —
 * because the withdrawal has three halves there and each alone leaves page 4 half-signed: the mark
 * (overlay), the date beside it (`markedAt`), and the name in the block (`packetSigningFields`).
 * ⚠ The fixture carries a p04 mark, which is production's shape: a walk from before the withdrawal.
 */

const ADOPTED = "Susan Godfrey";
const P04_AT = "2026-09-17T15:00:00Z";
const APPLICATION = { first_name: "Susan", last_name: "Godfrey" } as unknown as DriverApplication;

async function pages(marks: Array<{ placement_id: string; signed_name: string; signed_at: string }>) {
  const pdf = await renderPacketDocument({ marks, application: APPLICATION, certifiedAt: "", signedName: ADOPTED });
  const dir = await mkdtemp(join(tmpdir(), "packet-withdrawn-"));
  const path = join(dir, "packet.pdf");
  await writeFile(path, pdf);
  return readPacketTemplate(path);
}

describe("a line withdrawn from signing", () => {
  it("prints page 4 without the mark, the date or the name — even when a mark was recorded there", async () => {
    const read = await pages([
      { placement_id: "p03", signed_name: ADOPTED, signed_at: "2026-09-17T14:00:00Z" },
      { placement_id: "p04", signed_name: ADOPTED, signed_at: P04_AT },
    ]);
    const page4 = pageText(read[3]!);
    expect(page4).not.toContain(ADOPTED);
    expect(page4).not.toContain("SUSAN GODFREY");
    expect(page4).not.toContain(formatDisplayDate(P04_AT, ""));
    // Guards the guard: the same fixture DOES sign page 3, so an empty page 4 means something.
    expect(pageText(read[2]!)).toContain(ADOPTED);
  });

  it("says on the blank line why it is blank, on every render", async () => {
    const read = await pages([]);
    // The notice may be set smaller to fit, never cut: every word of it is on page 4.
    expect(pageText(read[3]!).replace(/\s+/g, " ")).toContain(PACKET_WITHDRAWALS.p04!.notice);
    expect(pageText(read[2]!)).not.toContain("Withdrawn from signing");
  });
});
