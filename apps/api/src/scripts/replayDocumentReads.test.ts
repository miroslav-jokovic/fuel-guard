import { describe as group, expect, it } from "vitest";
import { describe, summarise } from "./replayDocumentReads.js";
import type { ReplayResult } from "../modules/document-reading/read/replay.js";

/** The summary a reader PR quotes (RC2): what was judged, what moved, and what stopped asking a person. */
const moved = (before: string, after: string): ReplayResult => ({
  id: "r2", replayable: true, evidence: [], audit: null, ruleChanged: true,
  fields: [{ path: "hazmat.lines[0].packageCount", before: { status: before, value: 6 }, after: { status: after, value: 6 } }],
  findings: [{ ruleId: "paper_quantity_present", lineIndex: 0, before: { outcome: "cannot_tell", reason: "field_unconfirmed" }, after: { outcome: "pass", reason: "present" } }],
});

group("doc:replay's summary", () => {
  it("counts reads, the unreplayable, the moved fields and findings, and every field that stopped asking a person", () => {
    const results: ReplayResult[] = [
      { id: "r1", replayable: false, why: "finished before replay inputs were stored (0487), or a cache hit" },
      moved("check", "read"),
      { id: "r3", replayable: true, evidence: [], audit: null, ruleChanged: false, fields: [], findings: [] },
    ];
    expect(summarise("org", results)).toEqual({
      org: "org", reads: 3, replayed: 2, notReplayable: 1, readsWithChanges: 1, fieldsChanged: 1, relaxed: 1, findingsChanged: 1,
    });
    expect(summarise("org", [moved("read", "check")]).relaxed).toBe(0);
  });

  it("names each moved field and finding, before → after", () => {
    expect(describe(moved("check", "read"))).toBe([
      "r2  1 field(s), 1 finding(s) moved",
      "    field hazmat.lines[0].packageCount: check → read",
      "    finding paper_quantity_present[0]: cannot_tell/field_unconfirmed → pass/present",
    ].join("\n"));
  });
});
