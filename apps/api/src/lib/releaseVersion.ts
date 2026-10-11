import { getBuildInfo } from "./buildInfo.js";

/**
 * Which release this process is — the CalVer half of deploy truth (RELEASE-TRAIN-PLAN R6, D-REL10).
 *
 * The release tag (`v2026.10.05`, `.N` for a same-day hotfix) is minted by release.yml AFTER the
 * code it names is deployed and verified, so no build can carry it: the process that serves a
 * release starts before its tag exists. It is therefore read, not baked — from the repository's own
 * tags, the one place release.yml records it. The repository is public, so the read needs no
 * credential, and a copy of the tag in our database (a `releases` table written by the workflow)
 * would have been a second record of a fact git already holds.
 *
 * Bounded on purpose. GitHub allows an unauthenticated caller 60 requests an hour per IP, and
 * Railway's egress IPs are shared, so:
 *   - only a process deployed from the `production` branch asks. Staging (main) is never tagged,
 *     so it would ask for ever and find nothing;
 *   - a found version is kept for the life of the process — a commit's tag does not change;
 *   - while not found, it asks at most once per RETRY_MS. After a release that is a handful of
 *     calls in the ~15 minutes between deploy and tag, then none.
 * Any failure — GitHub down, rate-limited, a slow answer — reads as `null`, and every caller shows
 * the commit instead. A version endpoint must never wait on, or fail because of, a third party.
 */

/** The tag shape `scripts/release-train.mjs` mints (`releaseTag`); releaseVersion.test.ts holds the two together. */
export const RELEASE_TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;

const RETRY_MS = 5 * 60_000;
const TIMEOUT_MS = 3_000;

/** Later release first: by date, then by the same-day hotfix counter. Pure. */
export function compareReleaseTags(a: string, b: string): number {
  const pa = RELEASE_TAG.exec(a);
  const pb = RELEASE_TAG.exec(b);
  if (!pa || !pb) return 0;
  const key = (m: RegExpExecArray) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0)];
  const ka = key(pa);
  const kb = key(pb);
  return kb.reduce((d, v, i) => d || v - (ka[i] ?? 0), 0);
}

interface TagRef {
  ref: string;
  object: { sha: string; type: string };
}

/**
 * The release tag naming `commit`, from GitHub's `matching-refs/tags/v` answer. Pure.
 *
 * Only lightweight tags (`type: "commit"`) count: `gh release create --target` makes those, and an
 * annotated tag's sha is the tag object's, not the commit's. A rollback re-serves an existing tag's
 * commit, so it finds that tag; a commit somehow tagged twice reports the later release.
 */
export function releaseTagFor(commit: string, refs: TagRef[]): string | null {
  const tags = refs
    .filter((r) => r.object?.type === "commit" && r.object.sha === commit)
    .map((r) => r.ref.replace(/^refs\/tags\//, ""))
    .filter((t) => RELEASE_TAG.test(t))
    .sort(compareReleaseTags);
  return tags[0] ?? null;
}

let found: string | null = null;
let lastAskedAt = 0;
let inFlight: Promise<string | null> | null = null;

export function resetReleaseVersionCache(): void {
  found = null;
  lastAskedAt = 0;
  inFlight = null;
}

async function ask(owner: string, repo: string, commit: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/matching-refs/tags/v`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return releaseTagFor(commit, (await res.json()) as TagRef[]);
  } catch {
    return null;
  }
}

/** The release tag of the running code, or null: not production, not tagged yet, or not knowable. */
export async function getReleaseVersion(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<string | null> {
  if (found) return found;
  const { commit, branch } = getBuildInfo();
  const owner = env.RAILWAY_GIT_REPO_OWNER;
  const repo = env.RAILWAY_GIT_REPO_NAME;
  if (branch !== "production" || !commit || !owner || !repo) return null;
  if (inFlight) return inFlight;
  if (now - lastAskedAt < RETRY_MS) return null;
  lastAskedAt = now;
  inFlight = ask(owner, repo, commit).then((tag) => {
    found = tag;
    inFlight = null;
    return tag;
  });
  return inFlight;
}
