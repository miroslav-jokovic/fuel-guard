import { describe, expect, it } from "vitest";
import type { FmcsaDataset } from "@silvicom/shared";
import { datasetsPublishedSince } from "./published.js";

/**
 * The hourly "has FMCSA republished?" comparison (IC1d). It must fire on a later publication and on a
 * dataset never fetched, and stay quiet when either side has no time — a missing timestamp may not
 * turn into a run every hour.
 */
const INSP = "fx4q-ay7w" as FmcsaDataset;
const VIOL = "876r-jsdb" as FmcsaDataset;
const at = (iso: string) => new Date(iso);

describe("datasetsPublishedSince", () => {
  it("names a dataset FMCSA published after our last run read it (10-16: run 15:40, publish 15:55)", () => {
    const moved = datasetsPublishedSince(
      new Map([[INSP, "2026-10-15T10:52:02+00:00"], [VIOL, "2026-10-16T13:56:59+00:00"]]),
      new Map([[INSP, at("2026-10-16T15:55:46Z")], [VIOL, at("2026-10-16T13:56:59Z")]]),
    );
    expect(moved).toEqual([INSP]);
  });

  it("names nothing when every dataset is where our last run left it", () => {
    expect(datasetsPublishedSince(new Map([[INSP, "2026-10-16T15:55:46Z"]]), new Map([[INSP, at("2026-10-16T15:55:46Z")]]))).toEqual([]);
  });

  it("names a dataset that has never been fetched", () => {
    expect(datasetsPublishedSince(new Map(), new Map([[VIOL, at("2026-10-16T13:56:59Z")]]))).toEqual([VIOL]);
  });

  it("stays quiet when Socrata states no time, or our last run read none", () => {
    expect(datasetsPublishedSince(new Map([[INSP, "2026-10-15T10:52:02Z"]]), new Map([[INSP, null]]))).toEqual([]);
    expect(datasetsPublishedSince(new Map([[INSP, null]]), new Map([[INSP, at("2026-10-16T15:55:46Z")]]))).toEqual([]);
  });
});
