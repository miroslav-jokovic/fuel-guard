import { createHash } from "node:crypto";
import { pageText, readPacketTemplate, type TemplatePage } from "./packetTemplate.js";

/**
 * Which text of the carrier's packet a mark was made under (A-5, C2c).
 *
 * ── WHY A HASH OF THE PRINTED WORDS AND NOT `PACKET_VERSION` ──────────────────────────────────
 * A-5's finding was that `PACKET_VERSION` did not move when #1059 changed the fines on page 7: it is
 * the version of the four INSTRUMENT pages' wording (`defaultWording.ts`), bumped by hand when the
 * spelling register touches one of them, and nothing obliges anybody to bump it for a figure on a
 * policy page. A version somebody must remember to change is a copy with a delay fuse. This one is
 * derived from what prints — every run of every page of `correctedPacketTemplate()`, the one source
 * the filed overlay is drawn on — so an owner-ruled figure, a spelling entry or a new template file
 * moves it without anybody being asked. `HANDBOOK_VERSION` is the same idea for the handbook (A-6).
 *
 * ⚠ Built once per process, like the corrected template it reads.
 */
export const packetTextVersionOf = (pages: readonly TemplatePage[]): string =>
  `pk-${createHash("sha256").update(pages.map(pageText).join("\n\f\n")).digest("hex").slice(0, 16)}`;

let current: Promise<string> | null = null;

/** The version of the packet text that would print now. */
export function packetTextVersion(): Promise<string> {
  current ??= readPacketTemplate().then(packetTextVersionOf);
  return current;
}
