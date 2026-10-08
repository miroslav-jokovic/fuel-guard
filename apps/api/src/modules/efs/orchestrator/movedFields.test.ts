import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redactCardXml } from "../lib/efsCardXml.js";
import { movedPaths } from "./movedFields.js";
import { rebasable } from "./plan.js";
import { promptsSetBehaviour } from "../capabilities/promptsSet.behaviour.js";

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

describe("rebasable — when a stale screen may proceed against the fresh card (2026-10-08)", () => {
  const known = (paths: string[] | null) => ({ paths, mirrorWasExpected: true });

  it("proceeds when every moved path is inside a declared part", () => {
    expect(rebasable(known(["/infos/reportValue", "/infos"]), ["infos"])).toBe(true);
  });

  it("refuses when any path outside the declared parts moved", () => {
    expect(rebasable(known(["/infos/reportValue", "/header/status"]), ["infos"])).toBe(false);
  });

  it("refuses on a prefix that only LOOKS like the part", () => {
    expect(rebasable(known(["/infosExtra/x"]), ["infos"])).toBe(false);
  });

  it("fails closed when it cannot know what moved or what the operator saw", () => {
    expect(rebasable(known(null), ["infos"])).toBe(false);
    expect(rebasable(known([]), ["infos"])).toBe(false);
    expect(rebasable({ paths: ["/infos/reportValue"], mirrorWasExpected: false }, ["infos"])).toBe(false);
  });

  it("never proceeds for a capability that declared nothing", () => {
    expect(rebasable(known(["/infos/reportValue"]), [])).toBe(false);
  });

  it("is never declared over the prompts by the capability whose decision IS the prompts", () => {
    // A prompt edit authorised against prompts the operator never saw is the overwrite
    // `expectedVersion` exists to stop.
    expect(promptsSetBehaviour.rebasesOver ?? []).not.toContain("infos");
  });
});
