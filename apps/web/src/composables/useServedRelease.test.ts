import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { useServedRelease, resetServedRelease } from "./useServedRelease";

/** R6 (D-REL10): the account menu's version line — the release tag, else the commit, else nothing. */
describe("useServedRelease", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetServedRelease();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  it("asks this page's own origin, not the split-off API host", async () => {
    answer({ version: "v2026.10.06", commitShort: "c9048c9" });
    const release = useServedRelease();
    await flushPromises();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/version");
    expect(release.value).toBe("v2026.10.06");
  });

  it("shows the commit when there is no release tag (staging, or before the tag)", async () => {
    answer({ version: null, commitShort: "c9048c9" });
    const release = useServedRelease();
    await flushPromises();
    expect(release.value).toBe("c9048c9");
  });

  it("shows nothing when the endpoint fails", async () => {
    answer({}, 503);
    const release = useServedRelease();
    await flushPromises();
    expect(release.value).toBeNull();
  });

  it("asks once per page load, however many menus mount", async () => {
    answer({ version: "v2026.10.06" });
    const a = useServedRelease();
    const b = useServedRelease();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([a.value, b.value]).toEqual(["v2026.10.06", "v2026.10.06"]);
  });
});
