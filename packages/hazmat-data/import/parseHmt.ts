/**
 * §172.101 HMT parser (Phase H1, deliverable 2 — the parse half) — NOT YET IMPLEMENTED.
 *
 * Turns the raw §172.101 XML (fetched by `EcfrClient.getFullXml`) into `HmtEntry[]`. This is
 * deliberately its own file and its own step, because the HMT is the single hardest table to parse
 * in the whole regulation: multi-row entries (one PSN spanning several packing-group sub-rows),
 * a symbols column (+, A, D, G, I, W …), 'or'-alternate legal names, UN/NA and D/I duplicates, and
 * footnotes. Guessing that structure is exactly the "don't assume — verify against reality" failure
 * this project has already been bitten by.
 *
 * THE RULE: build this against a CAPTURED REAL FIXTURE, not from memory of the GPO CFR XML DTD.
 *   1. Run `import/captureFixtures.ts` on a machine that can reach ecfr.gov — it saves the real
 *      §172.101 XML to `import/fixtures/section-172-101.xml`.
 *   2. Inspect that XML; write `parseHmtSection` against its actual element/attribute shape.
 *   3. Freeze a small slice as a parser fixture with a hand-typed expected `HmtEntry[]`, and assert
 *      it in `parseHmt.test.ts` (RELEASING.md step 2 — "parser fixtures must pass").
 *   4. The parser output then becomes Source A of the two-source diff (D5 v5), checked against the
 *      human transcription (Source B) before any release.
 */

import type { HmtEntry } from "../src/schema.js";

export function parseHmtSection(_xml: string): HmtEntry[] {
  throw new Error(
    "parseHmtSection is not implemented yet — HazmatGuard Phase H1 (the §172.101 HMT parser). " +
      "Capture a real fixture with import/captureFixtures.ts and build the parser against it; " +
      "do NOT hand-write it against a guessed XML structure. See parseHmt.ts header + RELEASING.md.",
  );
}
