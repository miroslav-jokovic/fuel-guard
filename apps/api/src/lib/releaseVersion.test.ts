import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// @ts-expect-error — a plain .mjs script with no types; only its pure `releaseTag` is used.
import { releaseTag } from "../../../../scripts/release-train.mjs";

/**
 * R6 (D-REL10) — the release tag on `GET /api/version`, read from the repository's tags. These cases
 * pin the three bounds that keep an unauthenticated GitHub call cheap (production only, kept once
 * found, at most one retry per five minutes) and that every failure reads as null, never an error.
 */
const build = vi.hoisted(() => ({ commit: "c".repeat(40), branch: "production" as string | null }));
vi.mock("./buildInfo.js", () => ({ getBuildInfo: () => build }));

const { RELEASE_TAG, compareReleaseTags, releaseTagFor, getReleaseVersion, resetReleaseVersionCache } = await import(
  "./releaseVersion.js"
);

const ENV = { RAILWAY_GIT_REPO_OWNER: "o", RAILWAY_GIT_REPO_NAME: "r" } as NodeJS.ProcessEnv;
const ref = (tag: string, sha: string, type = "commit") => ({ ref: `refs/tags/${tag}`, object: { sha, type } });
const C = "c".repeat(40);

describe("release tag shape", () => {
  it("accepts every tag release-train.mjs mints, hotfix counters included", () => {
    const now = new Date("2026-10-05T06:07:00Z");
    expect(releaseTag(now, [])).toMatch(RELEASE_TAG);
    expect(releaseTag(now, ["v2026.10.05"])).toMatch(RELEASE_TAG);
    expect(releaseTag(now, ["v2026.10.05", "v2026.10.05.1"])).toMatch(RELEASE_TAG);
  });

  it("orders a same-day hotfix after the night's release, and a later day after both", () => {
    expect(["v2026.10.05", "v2026.10.06", "v2026.10.05.1", "v2026.10.05.10", "v2026.10.05.2"].sort(compareReleaseTags))
      .toEqual(["v2026.10.06", "v2026.10.05.10", "v2026.10.05.2", "v2026.10.05.1", "v2026.10.05"]);
  });
});

describe("releaseTagFor", () => {
  it("finds the release tag on this commit and ignores other commits and other tags", () => {
    const refs = [ref("v2026.10.05", "d".repeat(40)), ref("archive/efs-phase9-handoff", C), ref("v2026.10.06", C)];
    expect(releaseTagFor(C, refs)).toBe("v2026.10.06");
  });

  it("ignores an annotated tag, whose sha is the tag object's", () => {
    expect(releaseTagFor(C, [ref("v2026.10.06", C, "tag")])).toBeNull();
  });

  it("reports the later of two release tags on one commit", () => {
    expect(releaseTagFor(C, [ref("v2026.10.05", C), ref("v2026.10.05.1", C)])).toBe("v2026.10.05.1");
  });
});

describe("getReleaseVersion", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetReleaseVersionCache();
    build.branch = "production";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const answer = (refs: unknown[]) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(refs)));

  it("never asks off production — staging is never tagged and would ask for ever", async () => {
    build.branch = "main";
    expect(await getReleaseVersion(ENV, 1_000_000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the deployed repository's tags and keeps a found version for the life of the process", async () => {
    answer([ref("v2026.10.06", C)]);
    expect(await getReleaseVersion(ENV, 1_000_000)).toBe("v2026.10.06");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/o/r/git/matching-refs/tags/v");
    expect(await getReleaseVersion(ENV, 9_000_000_000)).toBe("v2026.10.06");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("while untagged, asks again only after five minutes", async () => {
    answer([]);
    expect(await getReleaseVersion(ENV, 1_000_000)).toBeNull();
    expect(await getReleaseVersion(ENV, 1_000_000 + 299_999)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer([ref("v2026.10.06", C)]);
    expect(await getReleaseVersion(ENV, 1_000_000 + 300_000)).toBe("v2026.10.06");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads a refusal or a network failure as null, never an error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 403 }));
    expect(await getReleaseVersion(ENV, 1_000_000)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await getReleaseVersion(ENV, 2_000_000)).toBeNull();
  });

  it("does not ask without Railway's repository name", async () => {
    expect(await getReleaseVersion({} as NodeJS.ProcessEnv, 1_000_000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
