import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redactCardXml } from "../lib/efsCardXml.js";
import { movedPaths } from "./movedFields.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const SINGLE = redactCardXml(fixture("getCardV2.single.xml"));

describe("a card_state_changed refusal names what moved (2026-10-08)", () => {
  it("names the one field that moved and nothing else", () => {
    const live = SINGLE.replace("<status>Active</status>", "<status>Hold</status>");
    expect(movedPaths(SINGLE, live)).toEqual([expect.stringMatching(/\/status$/)]);
  });

  it("ignores what the version ignores — a fill in progress is not a move", () => {
    const live = SINGLE.replace("<status>Active</status>", "<status>Active</status><lastUsedDate>2026-10-08T09:00:00</lastUsedDate>");
    expect(movedPaths(SINGLE, live)).toEqual([]);
  });

  it("names a report-only value by its path, never by its value", () => {
    const live = SINGLE.replace("<reportValue></reportValue>", "<reportValue>T-42</reportValue>");
    const paths = movedPaths(SINGLE, live);
    expect(paths).toEqual([expect.stringMatching(/\/infos/)]);
    expect(paths.join(" ")).not.toContain("T-42");
  });
});
