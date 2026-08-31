import { describe, expect, it } from "vitest";
import {
  BUILT_IN_VIEWS,
  builtInViewsFor,
  DQ_DUE_FILTERS,
  DQ_STATE_FILTERS,
  dqSoonest,
  matchesDqFilters,
  matchesDqRequirement,
  type DriverOverviewRow,
} from "./index.js";

/**
 * The fleet filter vocabulary (R4b), shared so the compliance page and the roster cannot answer
 * "is this driver behind on their §391.51 file" differently. `QualificationFleetTable.test.ts`
 * pins the same semantics through the component that used to own them.
 *
 * ⚠ The query strings are parsed by hand rather than with `URLSearchParams`. This package compiles
 * for React Native as well as the browser and its tsconfig carries no DOM lib, so a web global here
 * is a build error in `@silvicom/shared` — the rule working, not the test being awkward.
 */
const parseQuery = (query: string): [string, string][] =>
  query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      return (i === -1 ? [pair, ""] : [pair.slice(0, i), pair.slice(i + 1)]) as [string, string];
    });
const attention = (over: Record<string, unknown> = {}) =>
  ({
    key: "cdl", label: "CDL", citation: "§391.11", group: "licence",
    state: "expiring", goodUntil: null, evidenceDate: null, daysRemaining: 10, ...over,
  }) as DriverOverviewRow["attention"][number];

const req = (over: Record<string, unknown> = {}) =>
  ({ key: "cdl", state: "current", goodUntil: "2030-01-01", daysRemaining: 1000, expiryUnknown: false, ...over }) as
    DriverOverviewRow["requirements"][number];

const row = (over: Partial<DriverOverviewRow> = {}): DriverOverviewRow => ({
  driver_id: "d", driver_name: "N", driver_status: "active",
  state: "incomplete",
  counts: { current: 5, expiring: 0, expired: 0, missing: 0 },
  groups: [], attention: [], requirements: [], ...over,
});

describe("dqSoonest", () => {
  it("is null for a driver with nothing wrong, not a large number", () => {
    // A file in order has no `attention` entries at all. "Nothing to report" and "due in 9999 days"
    // are different answers, and a horizon filter must not admit the first.
    expect(dqSoonest(row())).toBeNull();
  });

  it("ignores undated items rather than treating them as due today", () => {
    expect(dqSoonest(row({ attention: [attention({ daysRemaining: null }), attention({ daysRemaining: 5 })] }))).toBe(5);
    expect(dqSoonest(row({ attention: [attention({ daysRemaining: null })] }))).toBeNull();
  });

  it("takes the most urgent, including an overdue one", () => {
    expect(dqSoonest(row({ attention: [attention({ daysRemaining: 5 }), attention({ daysRemaining: -3 })] }))).toBe(-3);
  });
});

describe("matchesDqFilters — an unrecognised value is NO filter", () => {
  it("admits everyone for a word that is not in the vocabulary", () => {
    // These reach the predicate from a query string a person can type into. A typo must not empty a
    // fleet, which reads exactly like a carrier with no drivers.
    expect(matchesDqFilters(row(), { state: "banana" })).toBe(true);
    expect(matchesDqFilters(row(), { due: "banana" })).toBe(true);
    expect(matchesDqFilters(row(), { req: "unicorn", due: "30" })).toBe(true);
  });

  it("admits everyone when nothing is set", () => {
    expect(matchesDqFilters(row(), {})).toBe(true);
  });
});

describe("matchesDqRequirement — one requirement, not the whole file", () => {
  const withCdl = (over: Record<string, unknown>) => row({ requirements: [req(over)] });

  it("matches a requirement inside the horizon", () => {
    expect(matchesDqRequirement(withCdl({ daysRemaining: 12 }), { req: "cdl", due: "30" })).toBe(true);
    expect(matchesDqRequirement(withCdl({ daysRemaining: 45 }), { req: "cdl", due: "30" })).toBe(false);
  });

  it("treats an already-lapsed requirement as inside every horizon", () => {
    expect(matchesDqRequirement(withCdl({ daysRemaining: -9, state: "expired" }), { req: "cdl", due: "30" })).toBe(true);
    expect(matchesDqRequirement(withCdl({ daysRemaining: -9, state: "expired" }), { req: "cdl", due: "overdue" })).toBe(true);
  });

  it("does not match a driver the requirement is not asked of", () => {
    // Hazmat at a carrier without the module: absent, not "behind".
    expect(matchesDqRequirement(row({ requirements: [] }), { req: "endorsement_hazmat", due: "30" })).toBe(false);
  });

  it("without a horizon, means the requirement is simply not current", () => {
    expect(matchesDqRequirement(withCdl({ state: "current" }), { req: "cdl" })).toBe(false);
    expect(matchesDqRequirement(withCdl({ state: "missing", daysRemaining: null }), { req: "cdl" })).toBe(true);
  });

  it("asks about THAT requirement, not about any other one being due", () => {
    // The distinction the built-in views depend on: this driver's medical is fine and their CDL is
    // not, so "medical expiring in 30 days" must not list them.
    const driver = row({
      requirements: [req({ key: "cdl", daysRemaining: 3, state: "expiring" }), req({ key: "medical_card", daysRemaining: 900 })],
      attention: [attention({ daysRemaining: 3 })],
    });
    expect(matchesDqFilters(driver, { req: "medical_card", due: "30" })).toBe(false);
    expect(matchesDqFilters(driver, { req: "cdl", due: "30" })).toBe(true);
    // …whereas the whole-file horizon does list them, which is a different question.
    expect(matchesDqFilters(driver, { due: "30" })).toBe(true);
  });
});

/**
 * The built-in views (D-ROS16). Held back at R3c-2 because none was expressible; these assertions
 * are what "expressible" has to mean — every one of them must be a query the roster's own filters
 * can read, and must actually narrow something.
 */
describe("BUILT_IN_VIEWS", () => {
  const views = builtInViewsFor("roster.drivers");

  it("ships at least one, since an empty registry is what R3c-2 refused", () => {
    expect(views.length).toBeGreaterThan(0);
  });

  it("every built-in is a query string this product's filters can read", () => {
    const known = new Set(["dq", "due", "req", "sort", "dir", "q", "status", "show", "hide", "page"]);
    for (const view of views) {
      for (const [key, value] of parseQuery(view.query)) {
        expect(known, `${view.name} uses an unknown parameter ${key}`).toContain(key);
        if (key === "dq") expect(DQ_STATE_FILTERS).toContain(value);
        if (key === "due") expect(DQ_DUE_FILTERS).toContain(value);
      }
    }
  });

  it("every built-in actually narrows the roster — none is a link to everybody", () => {
    const everyone = row({ state: "complete", requirements: [req({ key: "medical_card" }), req()] });
    for (const view of views) {
      const p = new Map(parseQuery(view.query));
      const filters = { state: p.get("dq") ?? "", due: p.get("due") ?? "", req: p.get("req") ?? "" };
      expect(matchesDqFilters(everyone, filters), `${view.name} matches a driver with nothing wrong`).toBe(false);
    }
  });

  it("names each one once, so the menu cannot show two rows that look identical", () => {
    const names = views.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares a table that saved views also accept", () => {
    expect(Object.keys(BUILT_IN_VIEWS)).toEqual(["roster.drivers"]);
  });
});
