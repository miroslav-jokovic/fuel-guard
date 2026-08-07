import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What this build IS — the code half of deploy truth (ship-pipeline plan D0.2).
 *
 * Railway injects its git metadata into the runtime environment of every deploy, so the running
 * process can name its own commit without us baking anything at build time. Locally there is no
 * Railway, so we fall back to reading `.git` directly; if that fails too the fields are null and
 * the version endpoint says "unknown" rather than lying.
 *
 * `expectedSchemaVersion` is the highest migration version present in THIS checkout. The API deploys
 * from source (`tsx src/index.ts`), so `supabase/migrations` is on disk at runtime and reading it is
 * exact — there is no generated constant that can silently drift from the directory it describes.
 */
export interface BuildInfo {
  /** Full commit SHA of the deployed code, or null when it cannot be determined. */
  commit: string | null;
  /** First 7 characters of `commit`, for humans. */
  commitShort: string | null;
  branch: string | null;
  /** Railway's id for this deploy — the thing to quote in a support thread. */
  deploymentId: string | null;
  /** When this process started, not when the code was written. */
  startedAt: string;
  /** Highest migration version in this checkout, e.g. "0140". */
  expectedSchemaVersion: string | null;
}

/** Numeric-then-lexicographic so "0099" sorts before "0140" and a longer timestamp id sorts last. */
function compareVersions(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

function readExpectedSchemaVersion(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url)); // apps/api/src/lib
  const dir = path.resolve(here, "../../../../supabase/migrations");
  try {
    const versions = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => /^(\d+)_/.exec(name)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort(compareVersions);
    return versions.at(-1) ?? null;
  } catch {
    return null; // not a source checkout (packaged build, or migrations pruned) — report unknown
  }
}

/** Local-dev fallback: resolve HEAD out of the .git directory without shelling out. */
function readGitHead(): { commit: string | null; branch: string | null } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const gitDir = path.resolve(here, "../../../../.git");
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return { commit: head || null, branch: null };
    const branch = ref.replace(/^refs\/heads\//, "");
    const sha = fs.readFileSync(path.join(gitDir, ref), "utf8").trim();
    return { commit: sha || null, branch };
  } catch {
    return { commit: null, branch: null };
  }
}

function resolveBuildInfo(): BuildInfo {
  const env = process.env;
  const fallback =
    env.RAILWAY_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA ? { commit: null, branch: null } : readGitHead();
  const commit = env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? fallback.commit;
  return {
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch: env.RAILWAY_GIT_BRANCH ?? env.GIT_BRANCH ?? fallback.branch,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? null,
    startedAt: new Date().toISOString(),
    expectedSchemaVersion: readExpectedSchemaVersion(),
  };
}

/** Resolved once per process: none of these can change without a restart. */
const buildInfo: BuildInfo = resolveBuildInfo();

export function getBuildInfo(): BuildInfo {
  return buildInfo;
}

export { compareVersions };
