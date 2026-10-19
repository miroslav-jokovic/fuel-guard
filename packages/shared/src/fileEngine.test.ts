import { describe, expect, it } from "vitest";
import {
  buildFile,
  fileAttention,
  fileGroups,
  worstFileState,
  type FileEvidence,
  type FileItemSpecBase,
} from "./fileEngine.js";

/**
 * The engine on its own, with no driver anywhere in sight (UNIT-FILES-PLAN D-UF1). `dqFile.test.ts`
 * proves the driver file still reads the same through it; this proves the engine is a thing a truck
 * file can stand on without inheriting a single §391.51 assumption.
 */

const TODAY = "2026-10-19";

const spec = (key: string, recurrence: FileItemSpecBase["recurrence"], extra: Partial<FileItemSpecBase> = {}): FileItemSpecBase => ({
  key,
  label: key,
  citation: "§0",
  recurrence,
  group: "papers",
  ...extra,
});

const none: FileEvidence = { expiresAt: null, issuedAt: null, occurredOn: null, coversUntil: null, documentId: null };

function one(s: FileItemSpecBase, e: FileEvidence | undefined, documentIds: string[] = []) {
  return buildFile({
    today: TODAY,
    specs: [s],
    evidenceFor: () => e,
    documentIds: new Set(documentIds),
    nothingFiled: e === undefined,
  }).items[0];
}

describe("buildFile — state boundaries", () => {
  it("reads an item with no evidence as missing", () => {
    expect(one(spec("registration", "expiry"), undefined)?.state).toBe("missing");
  });

  it("reads an expiry of yesterday as expired and of today as expiring", () => {
    expect(one(spec("r", "expiry"), { ...none, expiresAt: "2026-10-18" })?.state).toBe("expired");
    expect(one(spec("r", "expiry"), { ...none, expiresAt: "2026-10-19" })?.state).toBe("expiring");
  });

  it("puts the expiring edge at exactly thirty days unless the caller widens it", () => {
    expect(one(spec("r", "expiry"), { ...none, expiresAt: "2026-11-18" })?.state).toBe("expiring");
    expect(one(spec("r", "expiry"), { ...none, expiresAt: "2026-11-19" })?.state).toBe("current");
    const wide = buildFile({
      today: TODAY,
      specs: [spec("r", "expiry")],
      evidenceFor: () => ({ ...none, expiresAt: "2026-11-19" }),
      documentIds: new Set(),
      nothingFiled: false,
      expiringWithinDays: 91,
    });
    expect(wide.items[0]?.state).toBe("expiring");
  });

  it("treats evidence with no expiry as current but flags the expiry as unknown", () => {
    const item = one(spec("r", "expiry"), { ...none, issuedAt: "2026-01-02" });
    expect(item?.state).toBe("current");
    expect(item?.expiryUnknown).toBe(true);
    expect(item?.evidenceDate).toBe("2026-01-02");
  });

  it("dates an annual item a year from when it happened, unless covers-until says otherwise", () => {
    expect(one(spec("annual", "annual"), { ...none, occurredOn: "2025-11-01" })?.goodUntil).toBe("2026-11-01");
    expect(one(spec("annual", "annual"), { ...none, occurredOn: "2025-11-01", coversUntil: "2026-03-01" })?.goodUntil).toBe("2026-03-01");
  });

  it("dates a triennial item three years from issue and never expires a one-time item", () => {
    expect(one(spec("t", "triennial"), { ...none, issuedAt: "2024-05-05" })?.goodUntil).toBe("2027-05-05");
    const title = one(spec("title", "one_time"), { ...none, occurredOn: "2019-01-01" });
    expect(title?.goodUntil).toBeNull();
    expect(title?.state).toBe("current");
  });

  it("drops a cited document that does not exist rather than report a scan nobody can open", () => {
    expect(one(spec("r", "expiry"), { ...none, expiresAt: "2027-01-01", documentId: "gone" })?.documentId).toBeNull();
    expect(one(spec("r", "expiry"), { ...none, expiresAt: "2027-01-01", documentId: "doc" }, ["doc"])?.documentId).toBe("doc");
  });

  it("leaves a missing advisory item out of the file entirely", () => {
    const file = buildFile({
      today: TODAY,
      specs: [spec("permit", "expiry", { advisory: true }), spec("registration", "expiry")],
      evidenceFor: () => undefined,
      documentIds: new Set(),
      nothingFiled: true,
    });
    expect(file.items.map((i) => i.spec.key)).toEqual(["registration"]);
  });
});

describe("buildFile — the file's own state", () => {
  const specs = [spec("a", "expiry"), spec("b", "expiry")];

  it("is not_started when nothing at all is filed, incomplete with a gap, complete with none", () => {
    const build = (ev: Record<string, FileEvidence | undefined>, nothingFiled: boolean) =>
      buildFile({ today: TODAY, specs, evidenceFor: (s) => ev[s.key], documentIds: new Set(), nothingFiled }).state;
    expect(build({}, true)).toBe("not_started");
    expect(build({ a: { ...none, expiresAt: "2027-01-01" } }, false)).toBe("incomplete");
    expect(build({ a: { ...none, expiresAt: "2027-01-01" }, b: { ...none, expiresAt: "2026-10-25" } }, false)).toBe("complete");
  });
});

describe("projections", () => {
  const file = buildFile({
    today: TODAY,
    specs: [spec("ok", "expiry"), spec("soon", "expiry"), spec("gone", "expiry"), spec("absent", "expiry", { group: "other" })],
    evidenceFor: (s) =>
      ({
        ok: { ...none, expiresAt: "2027-06-01" },
        soon: { ...none, expiresAt: "2026-10-29" },
        gone: { ...none, expiresAt: "2026-09-01" },
      })[s.key],
    documentIds: new Set(),
    nothingFiled: false,
  });

  it("ranks attention expired, then missing, then soonest — and leaves current items out", () => {
    expect(fileAttention(file, TODAY).map((a) => [a.key, a.daysRemaining])).toEqual([
      ["gone", -48],
      ["absent", null],
      ["soon", 10],
    ]);
  });

  it("names a group by its worst state and skips a group with nothing in it", () => {
    const groups = fileGroups(file, ["papers", "other", "empty"], { papers: "Papers", other: "Other", empty: "Empty" });
    expect(groups.map((g) => [g.group, g.state])).toEqual([
      ["papers", "expired"],
      ["other", "missing"],
    ]);
  });

  it("says the worst state of a set of counts in one word", () => {
    expect(worstFileState({ current: 3, expiring: 1, expired: 0, missing: 0 })).toBe("expiring");
    expect(worstFileState({ current: 0, expiring: 1, expired: 0, missing: 2 })).toBe("missing");
    expect(worstFileState({ current: 1, expiring: 0, expired: 0, missing: 0 })).toBe("current");
  });
});
