import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_VIEW_BATCH_MAX } from "@silvicom/shared";

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { recordPageView, flushPageViews, resetPageViewsForTest } = await import("./pageViews");

beforeEach(() => {
  resetPageViewsForTest();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, status: 204, data: undefined });
});

const sentKeys = () => apiFetch.mock.calls.map((c) => (c[1] as { body: { keys: string[] } }).body.keys);

describe("page-view queue (X1)", () => {
  it("sends the catalogue key of each screen opened, repeats kept, in one batch", async () => {
    recordPageView("/fuel-log");
    recordPageView("/fuel-cards");
    recordPageView("/fuel-log");
    await flushPageViews();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]![0]).toBe("/api/page-views");
    expect(sentKeys()).toEqual([["fuel.log", "fuel.cards", "fuel.log"]]);
  });

  it("never sends a path, a query string or anything about the person", async () => {
    recordPageView("/fuel-cards/:id");
    await flushPageViews();
    const body = JSON.stringify(apiFetch.mock.calls[0]![1]);
    expect(body).not.toContain("/");
    expect(Object.keys((apiFetch.mock.calls[0]![1] as { body: object }).body)).toEqual(["keys"]);
  });

  it("counts nothing for a route that is not a screen", async () => {
    recordPageView("/login");
    await flushPageViews();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sends a full batch at once and keeps the rest for the next flush", async () => {
    for (let i = 0; i < PAGE_VIEW_BATCH_MAX + 3; i++) recordPageView("/fuel-log");
    await flushPageViews(); // the full batch was already in flight; this waits for it
    await flushPageViews();
    expect(sentKeys().map((k) => k.length)).toEqual([PAGE_VIEW_BATCH_MAX, 3]);
  });

  it("drops a batch the API refused or could not reach, and never throws", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    recordPageView("/fuel-log");
    await expect(flushPageViews()).resolves.toBeUndefined();
    await flushPageViews();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
