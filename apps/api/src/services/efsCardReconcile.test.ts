import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CardEdit } from "../lib/efsCardEcho.js";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { intentLanded } from "./efsCardReconcile.js";

/**
 * "Did the change take?" — asked of both response shapes.
 *
 * `intentLanded` decides whether a mutation row is written `succeeded` or `failed`, whether the audit
 * log says `card.mutation_applied` or `card.mutation_failed`, and which sentence the operator reads.
 * It works by asking which CANONICAL PATHS moved, and on the nested shape a scalar field lives at
 * `/header/status` rather than `/status`.
 *
 * That difference has already produced one production-grade bug in this feature (the vendor returning
 * `HOLD` for the `Hold` we sent, recorded as a failure). The structural version fails the other way,
 * which is worse: if no differing path is recognised as one we moved, nothing can contradict the
 * write, and every mutation reports as landed — including one EFS accepted and silently did not
 * apply. An operator would be told a stolen card was locked when it still buys fuel.
 *
 * The two "NOT land" cases below are the load-bearing ones. Reverting `editPath` to a hand-built
 * `/${name}` turns both red and leaves the rest green.
 */

const FIXTURES = fileURLToPath(new URL("../lib/__fixtures__/efs/", import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, "utf8");

const SHAPES = [
  { name: "flat (the guide's examples)", file: "getCardV2.full.xml", from: "Active", to: "Hold" },
  { name: "nested <header> (production)", file: "getCardV2.nestedHeader.xml", from: "HOLD", to: "ACTIVE" },
] as const;

describe("intentLanded", () => {
  it.each(SHAPES)("sees a status change land on the $name shape", ({ file, from, to }) => {
    const before = parseCardDocument(fixture(file));
    const after = parseCardDocument(fixture(file).replace(`<status>${from}</status>`, `<status>${to}</status>`));
    const edits: CardEdit[] = [{ op: "setField", name: "status", value: to }];
    expect(intentLanded(before, after, edits)).toBe(true);
  });

  it.each(SHAPES)("sees a status change NOT land on the $name shape", ({ file, to }) => {
    // EFS answered without a fault but the card never moved. This is the outcome the whole
    // read-back-and-compare step exists to catch, and it must be caught on both shapes.
    const doc = parseCardDocument(fixture(file));
    const edits: CardEdit[] = [{ op: "setField", name: "status", value: to === "Hold" ? "Hold" : "Active" }];
    expect(intentLanded(doc, parseCardDocument(fixture(file)), edits)).toBe(false);
  });

  it("tolerates the vendor's own casing on the nested shape too", () => {
    // We send the guide's `Active`; this account stores and returns `ACTIVE`. Same value, and the
    // path it differs at is `/header/status` here rather than `/status`.
    const before = parseCardDocument(fixture("getCardV2.nestedHeader.xml"));
    const after = parseCardDocument(
      fixture("getCardV2.nestedHeader.xml").replace("<status>HOLD</status>", "<status>ACTIVE</status>"),
    );
    expect(intentLanded(before, after, [{ op: "setField", name: "status", value: "Active" }])).toBe(true);
  });

  it("does not accept a different value as the vendor's casing", () => {
    const before = parseCardDocument(fixture("getCardV2.nestedHeader.xml"));
    const after = parseCardDocument(
      fixture("getCardV2.nestedHeader.xml").replace("<status>HOLD</status>", "<status>INACTIVE</status>"),
    );
    expect(intentLanded(before, after, [{ op: "setField", name: "status", value: "Active" }])).toBe(false);
  });

  it("ignores a fill that happened while we were writing", () => {
    // `lastUsedDate` is volatile by design (VOLATILE_FIELDS) — a truck fuelling mid-write must not
    // turn a successful lock into a failure. It sits inside <header> on this shape.
    const before = parseCardDocument(fixture("getCardV2.nestedHeader.xml"));
    const after = parseCardDocument(
      fixture("getCardV2.nestedHeader.xml")
        .replace("<status>HOLD</status>", "<status>ACTIVE</status>")
        .replace("2026-08-04T05:59:00.000-05:00", "2026-08-11T09:14:00.000-05:00"),
    );
    expect(intentLanded(before, after, [{ op: "setField", name: "status", value: "Active" }])).toBe(true);
  });

  it("sees a prompts replacement land on the nested shape", () => {
    // A collection edit addresses `/infos` on BOTH shapes — the prefix applies to scalars only, and
    // getting that backwards would be just as wrong in the other direction.
    const before = parseCardDocument(fixture("getCardV2.nestedHeader.xml"));
    const after = parseCardDocument(
      fixture("getCardV2.nestedHeader.xml").replace("<matchValue>0225</matchValue>", "<matchValue>0311</matchValue>"),
    );
    const records = before.card.infos.map((info) => ({
      infoId: info.infoId,
      lengthCheck: String(info.lengthCheck ?? false),
      matchValue: info.infoId === "DRID" ? "0311" : (info.matchValue ?? ""),
      maximum: String(info.maximum ?? 0),
      minimum: String(info.minimum ?? 0),
      reportValue: info.reportValue ?? "",
      validationType: info.validationType ?? "REPORT_ONLY",
      value: info.value ?? "0",
    }));
    expect(intentLanded(before, after, [{ op: "replaceAll", name: "infos", records }])).toBe(true);
  });
});
