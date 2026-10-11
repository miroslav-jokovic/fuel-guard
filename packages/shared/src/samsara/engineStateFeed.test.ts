import { describe, it, expect } from "vitest";
import { accumulateEngineStateFeedPage, type EngineStateEvent } from "./core.js";
import type { StatsFeedPage } from "./statsFeed.js";

const at = (min: number) => new Date(Date.UTC(2026, 8, 30, 14, min, 0)).toISOString();

const page = (rows: unknown[]): StatsFeedPage => ({
  data: rows,
  pagination: { endCursor: "c", hasNextPage: true },
});

const gather = (...pages: StatsFeedPage[]): Map<string, EngineStateEvent> => {
  const into = new Map<string, EngineStateEvent>();
  for (const p of pages) accumulateEngineStateFeedPage(p, into);
  return into;
};

describe("reading engine states off the Samsara delta feed (D-LM29)", () => {
  it("keeps the newest event per truck within a page, whatever order they arrive in", () => {
    const got = gather(page([{ id: "sv-1", engineStates: [
      { time: at(5), value: "Off" }, { time: at(1), value: "On" }, { time: at(3), value: "Idle" },
    ] }]));
    expect(got.get("sv-1")).toEqual({ time: at(5), value: "Off" });
  });

  it("keeps the newest across pages, where it can sit on the EARLIER page", () => {
    const got = gather(
      page([{ id: "sv-1", engineStates: [{ time: at(9), value: "Idle" }] }]),
      page([{ id: "sv-1", engineStates: [{ time: at(2), value: "Off" }] }]),
    );
    expect(got.get("sv-1")?.value).toBe("Idle");
  });

  it("drops a value outside Samsara's enum rather than guessing what it meant", () => {
    const got = gather(page([{ id: "sv-1", engineStates: [
      { time: at(1), value: "Off" }, { time: at(9), value: "Running" }, { time: at(8), value: "idle" },
    ] }]));
    expect(got.get("sv-1")).toEqual({ time: at(1), value: "Off" });
  });

  it("drops an event without a parseable time — it cannot be ordered against the stored one", () => {
    const got = gather(page([{ id: "sv-1", engineStates: [{ time: "yesterday", value: "On" }, { value: "On" }] }]));
    expect(got.has("sv-1")).toBe(false);
  });

  it("says nothing about a truck the page carried only GPS for — absence is not Off", () => {
    const got = gather(page([{ id: "sv-1", gps: [{ time: at(1), latitude: 44, longitude: -88 }] }]));
    expect(got.size).toBe(0);
  });

  it("tolerates a page with no data at all", () => {
    expect(gather({ data: null } as unknown as StatsFeedPage).size).toBe(0);
  });
});
